/**
 * Preview Service
 *
 * Responsible for:
 * - Temporary preview deployments from workspaces
 * - URL generation
 * - Auto-cleanup on expiration
 * - Preview container management
 */

const Docker = require('dockerode');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
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
 * Creates a preview environment from a workspace
 *
 * @param {number} workspaceId - Workspace ID
 * @param {number} userId - User ID
 * @param {object} options - Options { lifetimeHours, password }
 * @returns {Promise<object>} Preview object
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

        // 2. Check if max previews reached
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

        // 5. Hash password if provided
        let passwordHash = null;
        if (password) {
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

        // 12. Return preview object
        const [previews] = await pool.query(
            'SELECT * FROM preview_environments WHERE id = ?',
            [previewId]
        );

        return previews[0];

    } catch (error) {
        logger.error('Failed to create preview:', error);

        // Cleanup on error
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
 * Deletes a preview environment
 *
 * @param {number} previewId - Preview ID
 * @param {number} userId - User ID (for authorization)
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

        // 3. Stop and remove container
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

        // 5. Delete preview from database
        await pool.query('DELETE FROM preview_environments WHERE id = ?', [previewId]);

        logger.info(`Preview deleted: ${preview.preview_hash}`);

    } catch (error) {
        logger.error('Failed to delete preview:', error);
        throw error;
    }
}

/**
 * Extends the lifetime of a preview
 *
 * @param {number} previewId - Preview ID
 * @param {number} userId - User ID
 * @param {number} additionalHours - Additional hours
 * @returns {Promise<object>} Updated preview object
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

        // Return updated object
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
 * Cleans up expired previews (Cron Job)
 *
 * @returns {Promise<number>} Number of deleted previews
 */
async function cleanupExpiredPreviews() {
    try {
        // Find all expired previews
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
                // Stop and remove container
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

                // Set status to 'expired' (keep for history)
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
 * Gets all previews for a workspace
 *
 * @param {number} workspaceId - Workspace ID
 * @param {number} userId - User ID
 * @returns {Promise<Array>} List of previews
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
 * Gets previews for multiple workspaces in a single query (batch loading)
 * Reduces N+1 queries when loading workspace lists
 *
 * @param {number[]} workspaceIds - Array of workspace IDs
 * @param {number} userId - User ID
 * @returns {Promise<Map<number, Array>>} Map of workspaceId -> previews array
 */
async function getPreviewsForWorkspaces(workspaceIds, userId) {
    if (!workspaceIds || workspaceIds.length === 0) {
        return new Map();
    }

    try {
        // Create placeholders for IN clause
        const placeholders = workspaceIds.map(() => '?').join(',');

        const [previews] = await pool.query(
            `SELECT * FROM preview_environments
             WHERE workspace_id IN (${placeholders}) AND user_id = ?
             ORDER BY workspace_id, created_at DESC`,
            [...workspaceIds, userId]
        );

        // Group previews by workspace_id
        const previewMap = new Map();

        // Initialize map with empty arrays for all requested workspaceIds
        for (const id of workspaceIds) {
            previewMap.set(id, []);
        }

        // Populate map with actual previews
        for (const preview of previews) {
            const list = previewMap.get(preview.workspace_id);
            if (list) {
                list.push(preview);
            }
        }

        return previewMap;

    } catch (error) {
        logger.error('Failed to get previews for workspaces:', error);
        // Return empty map on error
        const emptyMap = new Map();
        for (const id of workspaceIds) {
            emptyMap.set(id, []);
        }
        return emptyMap;
    }
}

/**
 * Gets preview counts for multiple workspaces in a single query
 * Useful for displaying preview count badges without loading full preview data
 *
 * @param {number[]} workspaceIds - Array of workspace IDs
 * @param {number} userId - User ID
 * @returns {Promise<Map<number, number>>} Map of workspaceId -> preview count
 */
async function getPreviewCountsForWorkspaces(workspaceIds, userId) {
    if (!workspaceIds || workspaceIds.length === 0) {
        return new Map();
    }

    try {
        const placeholders = workspaceIds.map(() => '?').join(',');

        const [rows] = await pool.query(
            `SELECT workspace_id, COUNT(*) as count
             FROM preview_environments
             WHERE workspace_id IN (${placeholders})
               AND user_id = ?
               AND status IN ('creating', 'running')
             GROUP BY workspace_id`,
            [...workspaceIds, userId]
        );

        // Initialize map with zeros
        const countMap = new Map();
        for (const id of workspaceIds) {
            countMap.set(id, 0);
        }

        // Populate with actual counts
        for (const row of rows) {
            countMap.set(row.workspace_id, row.count);
        }

        return countMap;

    } catch (error) {
        logger.error('Failed to get preview counts:', error);
        const emptyMap = new Map();
        for (const id of workspaceIds) {
            emptyMap.set(id, 0);
        }
        return emptyMap;
    }
}

/**
 * Gets preview by hash
 *
 * @param {string} previewHash - Preview Hash
 * @returns {Promise<object|null>} Preview object or null
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
 * Gets a preview by its ID
 */
async function getPreviewById(previewId) {
    try {
        const [previews] = await pool.query(
            'SELECT * FROM preview_environments WHERE id = ?',
            [previewId]
        );

        return previews.length > 0 ? previews[0] : null;

    } catch (error) {
        logger.error('Failed to get preview by id', { previewId, error: error.message });
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

        // Check status
        if (preview.status !== 'running') {
            return false;
        }

        // Check expiration
        if (new Date(preview.expires_at) < new Date()) {
            return false;
        }

        // Check password (if set)
        if (preview.password_hash) {
            if (!password) {
                return false; // Password required
            }

            const passwordValid = await bcrypt.compare(password, preview.password_hash);
            return passwordValid;
        }

        // No password set - access allowed
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
    // For now: Simple hash-based URL
    // Future: Nginx Proxy Manager integration for custom subdomains
    const serverIp = process.env.SERVER_IP || 'localhost';
    return `http://${serverIp}/previews/${previewHash}`;
}

/**
 * Determines the appropriate Docker image for preview
 *
 * @param {string} projectName - Project name
 * @returns {string} Docker Image Name
 */
function getPreviewImage(projectName) {
    // Based on project type (should come from DB in reality)
    // For now: Standard nginx image for static content
    return 'nginx:alpine';
}

/**
 * Gets all active previews for admin panel
 */
async function getAdminPreviews() {
    try {
        const [rows] = await pool.query(`
            SELECT p.*, u.username
            FROM preview_environments p
            JOIN dashboard_users u ON p.user_id = u.id
            WHERE p.status IN ('creating', 'running')
            ORDER BY p.expires_at ASC
        `);

        return rows;
    } catch (error) {
        logger.error('Failed to get admin previews', { error: error.message });
        throw error;
    }
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
    getPreviewsForWorkspaces,
    getPreviewCountsForWorkspaces,
    getPreviewByHash,
    getPreviewById,
    validatePreviewAccess,
    getAdminPreviews,
    PREVIEW_STATUS
};
