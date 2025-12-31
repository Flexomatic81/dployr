const { pool } = require('../config/database');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const gitService = require('./git');
const dockerService = require('./docker');
const { VALID_INTERVALS } = require('../config/constants');
const { logger } = require('../config/logger');
const { generateWebhookSecret } = require('./utils/webhook');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

// Lock to prevent parallel deployments
const deploymentLocks = new Set();

/**
 * Enables auto-deploy for a project
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
 * Disables auto-deploy for a project
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
 * Updates the polling interval for a project
 */
async function updateInterval(userId, projectName, intervalMinutes) {
    // Validation: only allowed values
    const interval = VALID_INTERVALS.includes(intervalMinutes) ? intervalMinutes : 5;

    const [result] = await pool.execute(
        `UPDATE project_autodeploy SET interval_minutes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND project_name = ?`,
        [interval, userId, projectName]
    );
    return result;
}

/**
 * Deletes auto-deploy configuration for a project
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
 * Gets the auto-deploy configuration for a project
 */
async function getAutoDeployConfig(userId, projectName) {
    const [rows] = await pool.execute(
        `SELECT * FROM project_autodeploy WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );
    return rows[0] || null;
}

/**
 * Gets all active auto-deploy configurations
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
 * Checks if there are new commits on the remote
 */
async function checkForUpdates(systemUsername, projectName, branch = 'main') {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    if (!gitService.isGitRepository(projectPath)) {
        return { hasUpdates: false, error: 'Not a Git repository' };
    }

    const gitPath = gitService.getGitPath(projectPath);

    try {
        // Fetch from remote
        execSync('git fetch origin', {
            cwd: gitPath,
            timeout: 30000,
            encoding: 'utf-8'
        });

        // Get local HEAD commit
        const localHead = execSync('git rev-parse HEAD', {
            cwd: gitPath,
            encoding: 'utf-8',
            timeout: 5000
        }).trim();

        // Get remote HEAD commit
        let remoteHead;
        try {
            remoteHead = execSync(`git rev-parse origin/${branch}`, {
                cwd: gitPath,
                encoding: 'utf-8',
                timeout: 5000
            }).trim();
        } catch (e) {
            // Branch doesn't exist on remote, try with current branch
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
        logger.error('[AutoDeploy] Error during update check', { systemUsername, projectName, error: error.message });
        return { hasUpdates: false, error: error.message };
    }
}

/**
 * Executes a deployment (Pull + Restart)
 */
async function executeDeploy(userId, systemUsername, projectName, triggerType = 'auto') {
    const lockKey = `${userId}-${projectName}`;

    // Check if a deployment is already running
    if (deploymentLocks.has(lockKey)) {
        logger.debug('[AutoDeploy] Deployment already running, skipping', { projectName });
        return { success: false, skipped: true };
    }

    deploymentLocks.add(lockKey);
    const startTime = Date.now();
    let logId;

    try {
        const projectPath = path.join(USERS_PATH, systemUsername, projectName);
        const gitPath = gitService.getGitPath(projectPath);

        // Save old commit hash
        let oldCommitHash = null;
        try {
            oldCommitHash = execSync('git rev-parse HEAD', {
                cwd: gitPath,
                encoding: 'utf-8',
                timeout: 5000
            }).trim().substring(0, 40);
        } catch (e) {}

        // Create deployment log (Status: pending)
        const [insertResult] = await pool.execute(
            `INSERT INTO deployment_logs (user_id, project_name, trigger_type, old_commit_hash, status)
             VALUES (?, ?, ?, ?, 'pending')`,
            [userId, projectName, triggerType, oldCommitHash]
        );
        logId = insertResult.insertId;

        // Set status to "pulling"
        await updateDeploymentLog(logId, { status: 'pulling' });

        // Execute Git Pull
        const pullResult = await gitService.pullChanges(projectPath);

        if (!pullResult.hasChanges) {
            await updateDeploymentLog(logId, {
                status: 'success',
                new_commit_hash: oldCommitHash,
                commit_message: 'No changes',
                duration_ms: Date.now() - startTime
            });
            return { success: true, hasChanges: false };
        }

        // Get new commit hash and message
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

        // Set status to "restarting"
        await updateDeploymentLog(logId, {
            status: 'restarting',
            new_commit_hash: newCommitHash,
            commit_message: commitMessage
        });

        // Restart container
        await dockerService.restartProject(projectPath);

        // Update auto-deploy table
        await pool.execute(
            `UPDATE project_autodeploy
             SET last_check = CURRENT_TIMESTAMP, last_commit_hash = ?
             WHERE user_id = ? AND project_name = ?`,
            [newCommitHash, userId, projectName]
        );

        // Log success
        await updateDeploymentLog(logId, {
            status: 'success',
            duration_ms: Date.now() - startTime
        });

        logger.info('[AutoDeploy] Successful deployment', { systemUsername, projectName, oldCommit: oldCommitHash?.substring(0,7), newCommit: newCommitHash?.substring(0,7) });

        return {
            success: true,
            hasChanges: true,
            oldCommit: oldCommitHash?.substring(0, 7),
            newCommit: newCommitHash?.substring(0, 7),
            message: commitMessage
        };

    } catch (error) {
        logger.error('[AutoDeploy] Deployment error', { projectName, error: error.message });

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
 * Updates a deployment log entry
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
 * Logs a deployment (for Clone, Pull, etc.)
 */
async function logDeployment(userId, projectName, triggerType, data = {}) {
    const {
        status = 'success',
        oldCommitHash = null,
        newCommitHash = null,
        commitMessage = null,
        errorMessage = null,
        durationMs = null
    } = data;

    await pool.execute(
        `INSERT INTO deployment_logs
         (user_id, project_name, trigger_type, old_commit_hash, new_commit_hash, commit_message, status, error_message, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, projectName, triggerType, oldCommitHash, newCommitHash, commitMessage, status, errorMessage, durationMs]
    );
}

/**
 * Gets the deployment history for a project
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
 * Gets the last successful deployment
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
 * Enables webhook for a project and generates a secret
 * Creates a record if it doesn't exist (independent of polling auto-deploy)
 * @returns {Promise<{secret: string, webhookId: number}>}
 */
async function enableWebhook(userId, projectName, branch = 'main') {
    const secret = generateWebhookSecret();

    // Insert or update - webhook works independently of polling (enabled flag)
    await pool.execute(
        `INSERT INTO project_autodeploy (user_id, project_name, branch, enabled, webhook_enabled, webhook_secret)
         VALUES (?, ?, ?, FALSE, TRUE, ?)
         ON DUPLICATE KEY UPDATE webhook_enabled = TRUE, webhook_secret = ?, updated_at = CURRENT_TIMESTAMP`,
        [userId, projectName, branch, secret, secret]
    );

    // Get the autodeploy ID for webhook URL
    const [rows] = await pool.execute(
        `SELECT id FROM project_autodeploy WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );

    return {
        secret,
        webhookId: rows[0]?.id
    };
}

/**
 * Disables webhook for a project (keeps secret for potential re-enable)
 */
async function disableWebhook(userId, projectName) {
    await pool.execute(
        `UPDATE project_autodeploy
         SET webhook_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );
}

/**
 * Regenerates webhook secret for a project
 * @returns {Promise<string>} New secret
 */
async function regenerateWebhookSecret(userId, projectName) {
    const secret = generateWebhookSecret();

    await pool.execute(
        `UPDATE project_autodeploy
         SET webhook_secret = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND project_name = ?`,
        [secret, userId, projectName]
    );

    return secret;
}

/**
 * Gets webhook configuration for a project
 */
async function getWebhookConfig(userId, projectName) {
    const [rows] = await pool.execute(
        `SELECT id, webhook_enabled, webhook_secret, branch
         FROM project_autodeploy
         WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );
    return rows[0] || null;
}

/**
 * Finds project by webhook/autodeploy ID (for webhook endpoint)
 * Returns project with user info for deployment
 */
async function findProjectByWebhook(webhookId) {
    const [rows] = await pool.execute(
        `SELECT pa.*, du.system_username
         FROM project_autodeploy pa
         JOIN dashboard_users du ON pa.user_id = du.id
         WHERE pa.id = ? AND pa.webhook_enabled = TRUE`,
        [webhookId]
    );
    return rows[0] || null;
}

/**
 * Executes a polling cycle for all active auto-deploy projects
 */
async function runPollingCycle() {
    logger.info('[AutoDeploy] Starting polling cycle...');

    try {
        const configs = await getAllActiveAutoDeployConfigs();
        logger.info('[AutoDeploy] Active projects found', { count: configs.length });

        for (const config of configs) {
            try {
                const projectPath = path.join(USERS_PATH, config.system_username, config.project_name);

                // Check if project still exists
                if (!fs.existsSync(projectPath)) {
                    logger.warn('[AutoDeploy] Project no longer exists, disabling', { projectName: config.project_name });
                    await disableAutoDeploy(config.user_id, config.project_name);
                    continue;
                }

                // Check if the interval has elapsed
                const intervalMinutes = config.interval_minutes || 5;
                if (config.last_check) {
                    const lastCheck = new Date(config.last_check);
                    const nextCheck = new Date(lastCheck.getTime() + intervalMinutes * 60 * 1000);
                    if (new Date() < nextCheck) {
                        // Not yet time for this project
                        continue;
                    }
                }

                // Check if there are updates
                const updateCheck = await checkForUpdates(
                    config.system_username,
                    config.project_name,
                    config.branch
                );

                // Update last_check
                await pool.execute(
                    `UPDATE project_autodeploy SET last_check = CURRENT_TIMESTAMP WHERE id = ?`,
                    [config.id]
                );

                if (updateCheck.error) {
                    logger.warn('[AutoDeploy] Error during update check', { projectName: config.project_name, error: updateCheck.error });
                    continue;
                }

                if (updateCheck.hasUpdates) {
                    logger.info('[AutoDeploy] Updates found, starting deployment', { projectName: config.project_name });
                    await executeDeploy(config.user_id, config.system_username, config.project_name, 'auto');
                }
            } catch (error) {
                logger.error('[AutoDeploy] Error with project', { projectName: config.project_name, error: error.message });
            }
        }

        logger.info('[AutoDeploy] Polling cycle completed');
    } catch (error) {
        logger.error('[AutoDeploy] Error in polling cycle', { error: error.message });
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
    logDeployment,
    getDeploymentHistory,
    getLastSuccessfulDeployment,
    runPollingCycle,
    // Webhook functions
    enableWebhook,
    disableWebhook,
    regenerateWebhookSecret,
    getWebhookConfig,
    findProjectByWebhook,
    VALID_INTERVALS
};
