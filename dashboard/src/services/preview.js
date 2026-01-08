/**
 * Preview Service
 *
 * Verantwortlich für:
 * - Temporäre Preview-Deployments aus Workspaces
 * - URL-Generierung
 * - Auto-Cleanup nach Ablauf
 * - Preview-Container Management
 */

const Docker = require('dockerode');
const crypto = require('crypto');
const { pool } = require('../config/database');
const { logger } = require('../config/logger');
const portManager = require('./portManager');

const docker = new Docker();

// ============================================================
// CONSTANTS
// ============================================================

const PREVIEW_STATUS = {
    CREATING: 'creating',
    RUNNING: 'running',
    STOPPING: 'stopping',
    STOPPED: 'stopped',
    EXPIRED: 'expired',
    ERROR: 'error'
};

const CONTAINER_PREFIX = 'dployr-preview-';
const DEFAULT_LIFETIME_HOURS = 24;
const MAX_PREVIEWS_PER_WORKSPACE = 3;

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Erstellt ein Preview Environment aus einem Workspace
 *
 * @param {number} workspaceId - ID des Workspaces
 * @param {number} userId - ID des Users
 * @param {object} options - Optionen { lifetimeHours, password }
 * @returns {Promise<object>} Preview-Objekt
 */
async function createPreview(workspaceId, userId, options = {}) {
    const { lifetimeHours = DEFAULT_LIFETIME_HOURS, password = null } = options;

    try {
        // 1. Workspace laden
        const [workspaces] = await pool.query(
            'SELECT * FROM workspaces WHERE id = ? AND user_id = ?',
            [workspaceId, userId]
        );

        if (workspaces.length === 0) {
            throw new Error('Workspace not found');
        }

        const workspace = workspaces[0];

        // 2. Prüfen ob Max-Previews erreicht
        const [existingPreviews] = await pool.query(
            `SELECT COUNT(*) as count FROM preview_environments
             WHERE workspace_id = ? AND status IN ('creating', 'running')`,
            [workspaceId]
        );

        if (existingPreviews[0].count >= MAX_PREVIEWS_PER_WORKSPACE) {
            throw new Error(`Maximum ${MAX_PREVIEWS_PER_WORKSPACE} previews per workspace reached`);
        }

        // 3. Preview Hash generieren
        const previewHash = crypto.randomBytes(16).toString('hex');

        // 4. Expires berechnen
        const expiresAt = new Date(Date.now() + lifetimeHours * 60 * 60 * 1000);

        // 5. Password hashen (wenn vorhanden)
        let passwordHash = null;
        if (password) {
            const bcrypt = require('bcrypt');
            passwordHash = await bcrypt.hash(password, 10);
        }

        // 6. Preview in DB erstellen
        const [result] = await pool.query(
            `INSERT INTO preview_environments
             (workspace_id, user_id, project_name, preview_hash, status, expires_at, password_hash)
             VALUES (?, ?, ?, ?, 'creating', ?, ?)`,
            [workspaceId, userId, workspace.project_name, previewHash, expiresAt, passwordHash]
        );

        const previewId = result.insertId;

        // 7. Port allokieren
        const assignedPort = await portManager.allocatePort();

        // 8. Container Name
        const containerName = `${CONTAINER_PREFIX}${previewHash}`;

        // 9. Preview URL generieren
        const previewUrl = generatePreviewUrl(previewHash);

        // 10. Container erstellen (basierend auf Workspace-Files)
        const projectPath = `/var/www/projects/${workspace.project_name}`;

        // Container Config basierend auf Projekt-Typ
        const containerConfig = {
            name: containerName,
            Image: getPreviewImage(workspace.project_name),
            Env: [
                'NODE_ENV=production',
                `PORT=${workspace.internal_port || 3000}`
            ],
            ExposedPorts: {
                [`${workspace.internal_port || 3000}/tcp`]: {}
            },
            HostConfig: {
                PortBindings: {
                    [`${workspace.internal_port || 3000}/tcp`]: [{ HostPort: String(assignedPort) }]
                },
                Binds: [
                    `${projectPath}:/app:ro` // Read-only mount
                ],
                RestartPolicy: { Name: 'no' },
                NetworkMode: 'dployr-network',
                // Security
                SecurityOpt: ['no-new-privileges:true'],
                CapDrop: ['ALL'],
                ReadonlyRootfs: false,
                Memory: 512 * 1024 * 1024, // 512 MB
                NanoCpus: 0.5 * 1e9 // 0.5 CPU
            },
            Labels: {
                'dployr.type': 'preview',
                'dployr.preview_id': String(previewId),
                'dployr.preview_hash': previewHash,
                'dployr.workspace_id': String(workspaceId),
                'dployr.user_id': String(userId)
            }
        };

        const container = await docker.createContainer(containerConfig);
        await container.start();

        // 11. DB Update mit Container-Info
        await pool.query(
            `UPDATE preview_environments
             SET container_id = ?, container_name = ?, assigned_port = ?,
                 preview_url = ?, status = 'running'
             WHERE id = ?`,
            [container.id, containerName, assignedPort, previewUrl, previewId]
        );

        logger.info(`Preview created: ${previewHash} for workspace ${workspaceId}`);

        // 12. Preview-Objekt zurückgeben
        const [previews] = await pool.query(
            'SELECT * FROM preview_environments WHERE id = ?',
            [previewId]
        );

        return previews[0];

    } catch (error) {
        logger.error('Failed to create preview:', error);

        // Cleanup bei Fehler
        if (error.previewId) {
            await pool.query(
                `UPDATE preview_environments
                 SET status = 'error', error_message = ?
                 WHERE id = ?`,
                [error.message, error.previewId]
            );
        }

        throw error;
    }
}

/**
 * Löscht ein Preview Environment
 *
 * @param {number} previewId - ID des Previews
 * @param {number} userId - ID des Users (für Berechtigung)
 * @returns {Promise<void>}
 */
async function deletePreview(previewId, userId) {
    try {
        // 1. Preview laden
        const [previews] = await pool.query(
            'SELECT * FROM preview_environments WHERE id = ? AND user_id = ?',
            [previewId, userId]
        );

        if (previews.length === 0) {
            throw new Error('Preview not found');
        }

        const preview = previews[0];

        // 2. Status auf 'stopping' setzen
        await pool.query(
            'UPDATE preview_environments SET status = ? WHERE id = ?',
            ['stopping', previewId]
        );

        // 3. Container stoppen und löschen
        if (preview.container_id) {
            try {
                const container = docker.getContainer(preview.container_id);
                await container.stop({ t: 10 });
                await container.remove();
            } catch (err) {
                logger.warn(`Failed to remove preview container ${preview.container_id}:`, err.message);
            }
        }

        // 4. Port freigeben
        if (preview.assigned_port) {
            await portManager.releasePort(preview.assigned_port);
        }

        // 5. Preview aus DB löschen
        await pool.query('DELETE FROM preview_environments WHERE id = ?', [previewId]);

        logger.info(`Preview deleted: ${preview.preview_hash}`);

    } catch (error) {
        logger.error('Failed to delete preview:', error);
        throw error;
    }
}

/**
 * Verlängert die Lebenszeit eines Previews
 *
 * @param {number} previewId - ID des Previews
 * @param {number} userId - ID des Users
 * @param {number} additionalHours - Zusätzliche Stunden
 * @returns {Promise<object>} Aktualisiertes Preview-Objekt
 */
async function extendPreview(previewId, userId, additionalHours = 24) {
    try {
        // Preview laden
        const [previews] = await pool.query(
            'SELECT * FROM preview_environments WHERE id = ? AND user_id = ?',
            [previewId, userId]
        );

        if (previews.length === 0) {
            throw new Error('Preview not found');
        }

        const preview = previews[0];

        // Neue Expires-Zeit berechnen
        const currentExpires = new Date(preview.expires_at);
        const newExpires = new Date(currentExpires.getTime() + additionalHours * 60 * 60 * 1000);

        // DB Update
        await pool.query(
            'UPDATE preview_environments SET expires_at = ? WHERE id = ?',
            [newExpires, previewId]
        );

        logger.info(`Preview ${preview.preview_hash} extended by ${additionalHours} hours`);

        // Aktualisiertes Objekt zurückgeben
        const [updated] = await pool.query(
            'SELECT * FROM preview_environments WHERE id = ?',
            [previewId]
        );

        return updated[0];

    } catch (error) {
        logger.error('Failed to extend preview:', error);
        throw error;
    }
}

/**
 * Bereinigt abgelaufene Previews (Cron Job)
 *
 * @returns {Promise<number>} Anzahl gelöschter Previews
 */
async function cleanupExpiredPreviews() {
    try {
        // Alle abgelaufenen Previews finden
        const [expiredPreviews] = await pool.query(
            `SELECT * FROM preview_environments
             WHERE expires_at < NOW()
             AND status IN ('running', 'creating')
             ORDER BY expires_at ASC`
        );

        if (expiredPreviews.length === 0) {
            return 0;
        }

        logger.info(`Cleaning up ${expiredPreviews.length} expired previews`);

        let cleanedCount = 0;

        for (const preview of expiredPreviews) {
            try {
                // Container stoppen und löschen
                if (preview.container_id) {
                    const container = docker.getContainer(preview.container_id);
                    try {
                        await container.stop({ t: 5 });
                        await container.remove();
                    } catch (err) {
                        logger.warn(`Container ${preview.container_id} already gone`);
                    }
                }

                // Port freigeben
                if (preview.assigned_port) {
                    await portManager.releasePort(preview.assigned_port);
                }

                // Status auf 'expired' setzen (behalten für History)
                await pool.query(
                    `UPDATE preview_environments
                     SET status = 'expired', container_id = NULL, assigned_port = NULL
                     WHERE id = ?`,
                    [preview.id]
                );

                cleanedCount++;

            } catch (err) {
                logger.error(`Failed to cleanup preview ${preview.preview_hash}:`, err);
            }
        }

        logger.info(`Cleaned up ${cleanedCount} expired previews`);
        return cleanedCount;

    } catch (error) {
        logger.error('Failed to cleanup expired previews:', error);
        return 0;
    }
}

/**
 * Holt alle Previews eines Workspaces
 *
 * @param {number} workspaceId - ID des Workspaces
 * @param {number} userId - ID des Users
 * @returns {Promise<Array>} Liste der Previews
 */
async function getWorkspacePreviews(workspaceId, userId) {
    try {
        const [previews] = await pool.query(
            `SELECT * FROM preview_environments
             WHERE workspace_id = ? AND user_id = ?
             ORDER BY created_at DESC`,
            [workspaceId, userId]
        );

        return previews;

    } catch (error) {
        logger.error('Failed to get workspace previews:', error);
        throw error;
    }
}

/**
 * Holt Preview anhand des Hash
 *
 * @param {string} previewHash - Preview Hash
 * @returns {Promise<object|null>} Preview-Objekt oder null
 */
async function getPreviewByHash(previewHash) {
    try {
        const [previews] = await pool.query(
            'SELECT * FROM preview_environments WHERE preview_hash = ?',
            [previewHash]
        );

        return previews.length > 0 ? previews[0] : null;

    } catch (error) {
        logger.error('Failed to get preview by hash:', error);
        return null;
    }
}

/**
 * Validiert Preview-Zugriff (optional mit Passwort)
 *
 * @param {string} previewHash - Preview Hash
 * @param {string|null} password - Passwort (optional)
 * @returns {Promise<boolean>} true wenn Zugriff erlaubt
 */
async function validatePreviewAccess(previewHash, password = null) {
    try {
        const preview = await getPreviewByHash(previewHash);

        if (!preview) {
            return false;
        }

        // Status prüfen
        if (preview.status !== 'running') {
            return false;
        }

        // Expiration prüfen
        if (new Date(preview.expires_at) < new Date()) {
            return false;
        }

        // Passwort prüfen (wenn gesetzt)
        if (preview.password_hash) {
            if (!password) {
                return false; // Passwort erforderlich
            }

            const bcrypt = require('bcrypt');
            const passwordValid = await bcrypt.compare(password, preview.password_hash);

            return passwordValid;
        }

        // Kein Passwort gesetzt - Zugriff erlaubt
        return true;

    } catch (error) {
        logger.error('Failed to validate preview access:', error);
        return false;
    }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Generiert eine Preview-URL
 *
 * @param {string} previewHash - Preview Hash
 * @returns {string} Preview URL
 */
function generatePreviewUrl(previewHash) {
    // Für jetzt: Einfache Hash-basierte URL
    // In Zukunft: Nginx Proxy Manager Integration für custom Subdomains
    const serverIp = process.env.SERVER_IP || 'localhost';
    return `http://${serverIp}/previews/${previewHash}`;
}

/**
 * Ermittelt das passende Docker-Image für Preview
 *
 * @param {string} projectName - Projekt-Name
 * @returns {string} Docker Image Name
 */
function getPreviewImage(projectName) {
    // Basiert auf Projekt-Typ (sollte aus DB kommen in Realität)
    // Für jetzt: Standard nginx Image für static content
    return 'nginx:alpine';
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    createPreview,
    deletePreview,
    extendPreview,
    cleanupExpiredPreviews,
    getWorkspacePreviews,
    getPreviewByHash,
    validatePreviewAccess,
    PREVIEW_STATUS
};
