const { pool } = require('../config/database');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const gitService = require('./git');
const dockerService = require('./docker');
const { VALID_INTERVALS } = require('../config/constants');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

// Lock um parallele Deployments zu verhindern
const deploymentLocks = new Set();

/**
 * Aktiviert Auto-Deploy für ein Projekt
 */
async function enableAutoDeploy(userId, projectName, branch = 'main') {
    const [result] = await pool.execute(
        `INSERT INTO project_autodeploy (user_id, project_name, branch, enabled)
         VALUES (?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE enabled = TRUE, branch = ?, updated_at = CURRENT_TIMESTAMP`,
        [userId, projectName, branch, branch]
    );
    return result;
}

/**
 * Deaktiviert Auto-Deploy für ein Projekt
 */
async function disableAutoDeploy(userId, projectName) {
    const [result] = await pool.execute(
        `UPDATE project_autodeploy SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );
    return result;
}

/**
 * Aktualisiert das Polling-Intervall für ein Projekt
 */
async function updateInterval(userId, projectName, intervalMinutes) {
    // Validierung: nur erlaubte Werte
    const interval = VALID_INTERVALS.includes(intervalMinutes) ? intervalMinutes : 5;

    const [result] = await pool.execute(
        `UPDATE project_autodeploy SET interval_minutes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND project_name = ?`,
        [interval, userId, projectName]
    );
    return result;
}

/**
 * Löscht Auto-Deploy Konfiguration für ein Projekt
 */
async function deleteAutoDeploy(userId, projectName) {
    await pool.execute(
        `DELETE FROM project_autodeploy WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );
    await pool.execute(
        `DELETE FROM deployment_logs WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );
}

/**
 * Holt die Auto-Deploy Konfiguration für ein Projekt
 */
async function getAutoDeployConfig(userId, projectName) {
    const [rows] = await pool.execute(
        `SELECT * FROM project_autodeploy WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );
    return rows[0] || null;
}

/**
 * Holt alle aktiven Auto-Deploy Konfigurationen
 */
async function getAllActiveAutoDeployConfigs() {
    const [rows] = await pool.execute(
        `SELECT pa.*, du.system_username
         FROM project_autodeploy pa
         JOIN dashboard_users du ON pa.user_id = du.id
         WHERE pa.enabled = TRUE`
    );
    return rows;
}

/**
 * Prüft ob es neue Commits auf dem Remote gibt
 */
async function checkForUpdates(systemUsername, projectName, branch = 'main') {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    if (!gitService.isGitRepository(projectPath)) {
        return { hasUpdates: false, error: 'Kein Git-Repository' };
    }

    const gitPath = gitService.getGitPath(projectPath);

    try {
        // Fetch von Remote
        execSync('git fetch origin', {
            cwd: gitPath,
            timeout: 30000,
            encoding: 'utf-8'
        });

        // Lokalen HEAD-Commit holen
        const localHead = execSync('git rev-parse HEAD', {
            cwd: gitPath,
            encoding: 'utf-8',
            timeout: 5000
        }).trim();

        // Remote HEAD-Commit holen
        let remoteHead;
        try {
            remoteHead = execSync(`git rev-parse origin/${branch}`, {
                cwd: gitPath,
                encoding: 'utf-8',
                timeout: 5000
            }).trim();
        } catch (e) {
            // Branch existiert nicht auf remote, versuche mit aktuellem Branch
            const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
                cwd: gitPath,
                encoding: 'utf-8',
                timeout: 5000
            }).trim();
            remoteHead = execSync(`git rev-parse origin/${currentBranch}`, {
                cwd: gitPath,
                encoding: 'utf-8',
                timeout: 5000
            }).trim();
        }

        const hasUpdates = localHead !== remoteHead;

        return {
            hasUpdates,
            localCommit: localHead.substring(0, 7),
            remoteCommit: remoteHead.substring(0, 7)
        };
    } catch (error) {
        console.error(`[AutoDeploy] Fehler bei Update-Check für ${systemUsername}/${projectName}:`, error.message);
        return { hasUpdates: false, error: error.message };
    }
}

/**
 * Führt ein Deployment aus (Pull + Restart)
 */
async function executeDeploy(userId, systemUsername, projectName, triggerType = 'auto') {
    const lockKey = `${userId}-${projectName}`;

    // Prüfen ob bereits ein Deployment läuft
    if (deploymentLocks.has(lockKey)) {
        console.log(`[AutoDeploy] Deployment für ${projectName} läuft bereits, überspringe`);
        return { success: false, skipped: true };
    }

    deploymentLocks.add(lockKey);
    const startTime = Date.now();
    let logId;

    try {
        const projectPath = path.join(USERS_PATH, systemUsername, projectName);
        const gitPath = gitService.getGitPath(projectPath);

        // Alten Commit-Hash speichern
        let oldCommitHash = null;
        try {
            oldCommitHash = execSync('git rev-parse HEAD', {
                cwd: gitPath,
                encoding: 'utf-8',
                timeout: 5000
            }).trim().substring(0, 40);
        } catch (e) {}

        // Deployment-Log erstellen (Status: pending)
        const [insertResult] = await pool.execute(
            `INSERT INTO deployment_logs (user_id, project_name, trigger_type, old_commit_hash, status)
             VALUES (?, ?, ?, ?, 'pending')`,
            [userId, projectName, triggerType, oldCommitHash]
        );
        logId = insertResult.insertId;

        // Status auf "pulling" setzen
        await updateDeploymentLog(logId, { status: 'pulling' });

        // Git Pull ausführen
        const pullResult = await gitService.pullChanges(projectPath);

        if (!pullResult.hasChanges) {
            await updateDeploymentLog(logId, {
                status: 'success',
                new_commit_hash: oldCommitHash,
                commit_message: 'Keine Änderungen',
                duration_ms: Date.now() - startTime
            });
            return { success: true, hasChanges: false };
        }

        // Neuen Commit-Hash und Message holen
        let newCommitHash = null;
        let commitMessage = null;
        try {
            newCommitHash = execSync('git rev-parse HEAD', {
                cwd: gitPath,
                encoding: 'utf-8',
                timeout: 5000
            }).trim().substring(0, 40);

            commitMessage = execSync('git log -1 --format="%s"', {
                cwd: gitPath,
                encoding: 'utf-8',
                timeout: 5000
            }).trim();
        } catch (e) {}

        // Status auf "restarting" setzen
        await updateDeploymentLog(logId, {
            status: 'restarting',
            new_commit_hash: newCommitHash,
            commit_message: commitMessage
        });

        // Container neustarten
        await dockerService.restartProject(projectPath);

        // Auto-Deploy Tabelle aktualisieren
        await pool.execute(
            `UPDATE project_autodeploy
             SET last_check = CURRENT_TIMESTAMP, last_commit_hash = ?
             WHERE user_id = ? AND project_name = ?`,
            [newCommitHash, userId, projectName]
        );

        // Erfolg loggen
        await updateDeploymentLog(logId, {
            status: 'success',
            duration_ms: Date.now() - startTime
        });

        console.log(`[AutoDeploy] Erfolgreiches Deployment für ${systemUsername}/${projectName}: ${oldCommitHash?.substring(0,7)} -> ${newCommitHash?.substring(0,7)}`);

        return {
            success: true,
            hasChanges: true,
            oldCommit: oldCommitHash?.substring(0, 7),
            newCommit: newCommitHash?.substring(0, 7),
            message: commitMessage
        };

    } catch (error) {
        console.error(`[AutoDeploy] Fehler beim Deployment für ${projectName}:`, error.message);

        if (logId) {
            await updateDeploymentLog(logId, {
                status: 'failed',
                error_message: error.message,
                duration_ms: Date.now() - startTime
            });
        }

        return { success: false, error: error.message };
    } finally {
        deploymentLocks.delete(lockKey);
    }
}

/**
 * Aktualisiert einen Deployment-Log Eintrag
 */
async function updateDeploymentLog(logId, updates) {
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
        fields.push(`${key} = ?`);
        values.push(value);
    }

    values.push(logId);

    await pool.execute(
        `UPDATE deployment_logs SET ${fields.join(', ')} WHERE id = ?`,
        values
    );
}

/**
 * Holt die Deployment-Historie für ein Projekt
 */
async function getDeploymentHistory(userId, projectName, limit = 10) {
    const [rows] = await pool.execute(
        `SELECT * FROM deployment_logs
         WHERE user_id = ? AND project_name = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [userId, projectName, limit]
    );
    return rows;
}

/**
 * Holt das letzte erfolgreiche Deployment
 */
async function getLastSuccessfulDeployment(userId, projectName) {
    const [rows] = await pool.execute(
        `SELECT * FROM deployment_logs
         WHERE user_id = ? AND project_name = ? AND status = 'success'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, projectName]
    );
    return rows[0] || null;
}

/**
 * Führt einen Polling-Zyklus für alle aktiven Auto-Deploy Projekte aus
 */
async function runPollingCycle() {
    console.log('[AutoDeploy] Starte Polling-Zyklus...');

    try {
        const configs = await getAllActiveAutoDeployConfigs();
        console.log(`[AutoDeploy] ${configs.length} aktive Auto-Deploy Projekte gefunden`);

        for (const config of configs) {
            try {
                const projectPath = path.join(USERS_PATH, config.system_username, config.project_name);

                // Prüfen ob Projekt noch existiert
                if (!fs.existsSync(projectPath)) {
                    console.log(`[AutoDeploy] Projekt ${config.project_name} existiert nicht mehr, deaktiviere`);
                    await disableAutoDeploy(config.user_id, config.project_name);
                    continue;
                }

                // Prüfen ob das Intervall abgelaufen ist
                const intervalMinutes = config.interval_minutes || 5;
                if (config.last_check) {
                    const lastCheck = new Date(config.last_check);
                    const nextCheck = new Date(lastCheck.getTime() + intervalMinutes * 60 * 1000);
                    if (new Date() < nextCheck) {
                        // Noch nicht Zeit für dieses Projekt
                        continue;
                    }
                }

                // Prüfen ob es Updates gibt
                const updateCheck = await checkForUpdates(
                    config.system_username,
                    config.project_name,
                    config.branch
                );

                // last_check aktualisieren
                await pool.execute(
                    `UPDATE project_autodeploy SET last_check = CURRENT_TIMESTAMP WHERE id = ?`,
                    [config.id]
                );

                if (updateCheck.error) {
                    console.log(`[AutoDeploy] Fehler bei ${config.project_name}: ${updateCheck.error}`);
                    continue;
                }

                if (updateCheck.hasUpdates) {
                    console.log(`[AutoDeploy] Updates gefunden für ${config.project_name}, starte Deployment...`);
                    await executeDeploy(config.user_id, config.system_username, config.project_name, 'auto');
                }
            } catch (error) {
                console.error(`[AutoDeploy] Fehler bei Projekt ${config.project_name}:`, error.message);
            }
        }

        console.log('[AutoDeploy] Polling-Zyklus abgeschlossen');
    } catch (error) {
        console.error('[AutoDeploy] Fehler im Polling-Zyklus:', error.message);
    }
}

module.exports = {
    enableAutoDeploy,
    disableAutoDeploy,
    updateInterval,
    deleteAutoDeploy,
    getAutoDeployConfig,
    getAllActiveAutoDeployConfigs,
    checkForUpdates,
    executeDeploy,
    getDeploymentHistory,
    getLastSuccessfulDeployment,
    runPollingCycle,
    VALID_INTERVALS
};
