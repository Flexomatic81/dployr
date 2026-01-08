/**
 * Workspace Service
 *
 * Responsible for:
 * - Workspace lifecycle (create, start, stop, delete)
 * - Resource management
 * - Container orchestration
 * - Sync with projects
 * - Activity logging
 */

const Docker = require('dockerode');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const { pool } = require('../config/database');
const { logger } = require('../config/logger');
const portManager = require('./portManager');
const encryption = require('./encryption');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ============================================================
// CONSTANTS
// ============================================================

const WORKSPACE_IMAGE = process.env.WORKSPACE_IMAGE || 'dployr-workspace:latest';
const WORKSPACE_NETWORK = process.env.DOCKER_NETWORK || 'dployr-network';
const CONTAINER_PREFIX = 'dployr-ws-';
const USERS_PATH = process.env.USERS_PATH || '/app/users';
const HOST_USERS_PATH = process.env.HOST_USERS_PATH || '/opt/dployr/users';

const STATUS = {
    STOPPED: 'stopped',
    STARTING: 'starting',
    RUNNING: 'running',
    STOPPING: 'stopping',
    ERROR: 'error'
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Converts container path to host path for Docker volume mounts
 */
function toHostPath(containerPath) {
    if (containerPath.startsWith(USERS_PATH)) {
        return containerPath.replace(USERS_PATH, HOST_USERS_PATH);
    }
    return containerPath;
}

/**
 * Generates a unique container name for a workspace
 */
function getContainerName(userId, projectName) {
    return `${CONTAINER_PREFIX}${userId}-${projectName}`;
}

/**
 * Sanitizes log details to remove sensitive information
 * @param {object} details - Details object to sanitize
 * @returns {object} Sanitized details
 */
function sanitizeLogDetails(details) {
    const SENSITIVE_KEYS = ['api_key', 'password', 'token', 'secret', 'key', 'credential'];
    const sanitized = { ...details };

    for (const key of Object.keys(sanitized)) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_KEYS.some(sk => lowerKey.includes(sk))) {
            sanitized[key] = '[REDACTED]';
        }
    }

    return sanitized;
}

/**
 * Logs a workspace action to the database
 */
async function logWorkspaceAction(workspaceId, userId, projectName, action, details = {}) {
    try {
        // Sanitize details to prevent logging sensitive data
        const sanitizedDetails = sanitizeLogDetails(details);

        await pool.query(
            `INSERT INTO workspace_logs (workspace_id, user_id, project_name, action, details)
             VALUES (?, ?, ?, ?, ?)`,
            [workspaceId, userId, projectName, action, JSON.stringify(sanitizedDetails)]
        );
    } catch (error) {
        logger.error('Failed to log workspace action', {
            workspaceId, action, error: error.message
        });
    }
}

// ============================================================
// RESOURCE LIMITS
// ============================================================

/**
 * Gets resource limits for a user (user-specific or global defaults)
 */
async function getResourceLimits(userId) {
    try {
        // Try to get user-specific limits
        let [rows] = await pool.query(
            'SELECT * FROM resource_limits WHERE user_id = ?',
            [userId]
        );

        // If no user-specific limits, get global defaults
        if (rows.length === 0) {
            [rows] = await pool.query(
                'SELECT * FROM resource_limits WHERE user_id IS NULL'
            );
        }

        return rows[0] || {
            max_workspaces: 2,
            default_cpu: '1',
            default_ram: '2g',
            default_disk: '10g',
            default_idle_timeout: 30,
            max_previews_per_workspace: 3,
            default_preview_lifetime_hours: 24
        };
    } catch (error) {
        logger.error('Failed to get resource limits', { userId, error: error.message });
        throw error;
    }
}

/**
 * Checks if user can create a new workspace
 */
async function canCreateWorkspace(userId) {
    try {
        const limits = await getResourceLimits(userId);

        const [rows] = await pool.query(
            'SELECT COUNT(*) as count FROM workspaces WHERE user_id = ?',
            [userId]
        );

        return rows[0].count < limits.max_workspaces;
    } catch (error) {
        logger.error('Failed to check workspace creation permission', {
            userId, error: error.message
        });
        return false;
    }
}

// ============================================================
// WORKSPACE CRUD
// ============================================================

/**
 * Creates a new workspace for a project
 */
async function createWorkspace(userId, projectName, options = {}) {
    try {
        // Check if workspace already exists
        const existing = await getWorkspace(userId, projectName);
        if (existing) {
            throw new Error('Workspace already exists for this project');
        }

        // Check workspace limit
        const canCreate = await canCreateWorkspace(userId);
        if (!canCreate) {
            throw new Error('Maximum number of workspaces reached');
        }

        // Get resource limits
        const limits = await getResourceLimits(userId);

        // Create workspace record
        const [result] = await pool.query(
            `INSERT INTO workspaces (
                user_id, project_name,
                cpu_limit, ram_limit, disk_limit,
                idle_timeout_minutes, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                projectName,
                options.cpu_limit || limits.default_cpu,
                options.ram_limit || limits.default_ram,
                options.disk_limit || limits.default_disk,
                options.idle_timeout_minutes || limits.default_idle_timeout,
                STATUS.STOPPED
            ]
        );

        const workspaceId = result.insertId;

        await logWorkspaceAction(workspaceId, userId, projectName, 'create', {
            cpu_limit: options.cpu_limit || limits.default_cpu,
            ram_limit: options.ram_limit || limits.default_ram,
            disk_limit: options.disk_limit || limits.default_disk
        });

        logger.info('Workspace created', { workspaceId, userId, projectName });

        return await getWorkspaceById(workspaceId);
    } catch (error) {
        logger.error('Failed to create workspace', {
            userId, projectName, error: error.message
        });
        throw error;
    }
}

/**
 * Starts a workspace container
 */
async function startWorkspace(userId, projectName, systemUsername) {
    let workspaceId = null;

    try {
        // Get workspace
        const workspace = await getWorkspace(userId, projectName);
        if (!workspace) {
            throw new Error('Workspace not found');
        }

        workspaceId = workspace.id;

        // Check if already running
        if (workspace.status === STATUS.RUNNING) {
            return workspace;
        }

        // Update status to starting
        await pool.query(
            'UPDATE workspaces SET status = ? WHERE id = ?',
            [STATUS.STARTING, workspaceId]
        );

        // Allocate port
        const port = await portManager.allocatePort();

        // Generate container name
        const containerName = getContainerName(userId, projectName);

        // Get project path
        const projectPath = path.join(USERS_PATH, systemUsername, projectName);
        const hostProjectPath = toHostPath(projectPath);

        // Get user's API key if configured
        let apiKey = null;
        try {
            apiKey = await getDecryptedApiKey(userId, 'anthropic');
        } catch (error) {
            logger.debug('No API key configured for user', { userId });
        }

        // Generate secure code-server password
        const codeServerPassword = crypto.randomBytes(32).toString('base64');

        // Build environment variables
        const env = [];

        if (apiKey) {
            env.push(`ANTHROPIC_API_KEY=${apiKey}`);
        }

        // Add code-server password for authentication
        env.push(`CODE_SERVER_PASSWORD=${codeServerPassword}`);

        // Add git configuration
        const [userRows] = await pool.query(
            'SELECT username, email FROM dashboard_users WHERE id = ?',
            [userId]
        );

        if (userRows.length > 0) {
            env.push(`GIT_USER_NAME=${userRows[0].username}`);
            if (userRows[0].email) {
                env.push(`GIT_USER_EMAIL=${userRows[0].email}`);
            }
        }

        // Check if workspace image exists
        try {
            await docker.getImage(WORKSPACE_IMAGE).inspect();
        } catch (error) {
            throw new Error(`Workspace image ${WORKSPACE_IMAGE} not found. Please build it first.`);
        }

        // Create container
        const container = await docker.createContainer({
            name: containerName,
            Image: WORKSPACE_IMAGE,
            Env: env,
            ExposedPorts: {
                '8080/tcp': {}
            },
            HostConfig: {
                Binds: [
                    `${hostProjectPath}:/workspace`
                ],
                PortBindings: {
                    '8080/tcp': [{ HostPort: port.toString() }]
                },
                Memory: parseMemoryLimit(workspace.ram_limit),
                NanoCpus: parseCpuLimit(workspace.cpu_limit),
                RestartPolicy: {
                    Name: 'unless-stopped'
                },
                SecurityOpt: ['no-new-privileges:true'],
                CapDrop: ['ALL'],
                // Only add CHOWN for file ownership changes
                // SETUID and SETGID removed for security (container escape risk)
                CapAdd: ['CHOWN'],
                ReadonlyRootfs: false
            },
            NetworkingConfig: {
                EndpointsConfig: {
                    [WORKSPACE_NETWORK]: {}
                }
            },
            Labels: {
                'com.dployr.type': 'workspace',
                'com.dployr.user': systemUsername,
                'com.dployr.user_id': userId.toString(),
                'com.dployr.project': projectName
            }
        });

        // Start container
        await container.start();

        // Encrypt code-server password for storage
        const secret = process.env.SESSION_SECRET;
        const { encrypted: encryptedPassword, iv: passwordIv } = encryption.encrypt(
            codeServerPassword,
            secret
        );

        // Update workspace with container info
        await pool.query(
            `UPDATE workspaces SET
                container_id = ?,
                container_name = ?,
                assigned_port = ?,
                status = ?,
                code_server_password_encrypted = ?,
                code_server_password_iv = ?,
                started_at = NOW(),
                last_activity = NOW()
            WHERE id = ?`,
            [container.id, containerName, port, STATUS.RUNNING,
             encryptedPassword, passwordIv, workspaceId]
        );

        await logWorkspaceAction(workspaceId, userId, projectName, 'start', {
            container_id: container.id,
            port
        });

        logger.info('Workspace started', {
            workspaceId, userId, projectName, containerName, port
        });

        return await getWorkspaceById(workspaceId);
    } catch (error) {
        logger.error('Failed to start workspace', {
            userId, projectName, error: error.message
        });

        // Update status to error
        if (workspaceId) {
            await pool.query(
                'UPDATE workspaces SET status = ?, error_message = ? WHERE id = ?',
                [STATUS.ERROR, error.message, workspaceId]
            );

            await logWorkspaceAction(workspaceId, userId, projectName, 'error', {
                operation: 'start',
                error: error.message
            });
        }

        throw error;
    }
}

/**
 * Stops a running workspace container
 */
async function stopWorkspace(userId, projectName) {
    try {
        const workspace = await getWorkspace(userId, projectName);
        if (!workspace) {
            throw new Error('Workspace not found');
        }

        if (workspace.status === STATUS.STOPPED) {
            return workspace;
        }

        // Update status
        await pool.query(
            'UPDATE workspaces SET status = ? WHERE id = ?',
            [STATUS.STOPPING, workspace.id]
        );

        // Stop container if exists
        if (workspace.container_id) {
            try {
                const container = docker.getContainer(workspace.container_id);
                await container.stop({ t: 10 });
                await container.remove();
            } catch (error) {
                logger.warn('Container stop/remove failed (might already be stopped)', {
                    error: error.message
                });
            }
        }

        // Update workspace status
        await pool.query(
            `UPDATE workspaces SET
                status = ?,
                container_id = NULL,
                assigned_port = NULL,
                started_at = NULL
            WHERE id = ?`,
            [STATUS.STOPPED, workspace.id]
        );

        await logWorkspaceAction(workspace.id, userId, projectName, 'stop');

        logger.info('Workspace stopped', { workspaceId: workspace.id, userId, projectName });

        return await getWorkspaceById(workspace.id);
    } catch (error) {
        logger.error('Failed to stop workspace', {
            userId, projectName, error: error.message
        });
        throw error;
    }
}

/**
 * Deletes a workspace completely
 */
async function deleteWorkspace(userId, projectName) {
    try {
        const workspace = await getWorkspace(userId, projectName);
        if (!workspace) {
            throw new Error('Workspace not found');
        }

        // Stop workspace if running
        if (workspace.status !== STATUS.STOPPED) {
            await stopWorkspace(userId, projectName);
        }

        // Delete workspace record (cascade will delete logs and previews)
        await pool.query('DELETE FROM workspaces WHERE id = ?', [workspace.id]);

        await logWorkspaceAction(null, userId, projectName, 'delete', {
            workspace_id: workspace.id
        });

        logger.info('Workspace deleted', { workspaceId: workspace.id, userId, projectName });

        return { success: true };
    } catch (error) {
        logger.error('Failed to delete workspace', {
            userId, projectName, error: error.message
        });
        throw error;
    }
}

// ============================================================
// WORKSPACE QUERIES
// ============================================================

/**
 * Gets a workspace by user and project
 */
async function getWorkspace(userId, projectName) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM workspaces WHERE user_id = ? AND project_name = ?',
            [userId, projectName]
        );

        return rows[0] || null;
    } catch (error) {
        logger.error('Failed to get workspace', {
            userId, projectName, error: error.message
        });
        throw error;
    }
}

/**
 * Gets a workspace by ID
 */
async function getWorkspaceById(workspaceId) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM workspaces WHERE id = ?',
            [workspaceId]
        );

        return rows[0] || null;
    } catch (error) {
        logger.error('Failed to get workspace by ID', {
            workspaceId, error: error.message
        });
        throw error;
    }
}

/**
 * Gets all workspaces for a user
 */
async function getUserWorkspaces(userId) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM workspaces WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );

        return rows;
    } catch (error) {
        logger.error('Failed to get user workspaces', {
            userId, error: error.message
        });
        throw error;
    }
}

/**
 * Gets all active (running) workspaces
 */
async function getActiveWorkspaces() {
    try {
        const [rows] = await pool.query(
            `SELECT w.*, u.username, u.system_username
             FROM workspaces w
             JOIN dashboard_users u ON w.user_id = u.id
             WHERE w.status = ?
             ORDER BY w.started_at DESC`,
            [STATUS.RUNNING]
        );

        return rows;
    } catch (error) {
        logger.error('Failed to get active workspaces', { error: error.message });
        throw error;
    }
}

// ============================================================
// ACTIVITY MANAGEMENT
// ============================================================

/**
 * Updates the last activity timestamp for a workspace
 */
async function updateActivity(workspaceId, userId = null) {
    try {
        const updates = ['last_activity = NOW()'];
        const params = [];

        if (userId) {
            updates.push('last_accessed_by = ?');
            params.push(userId);
        }

        params.push(workspaceId);

        await pool.query(
            `UPDATE workspaces SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        logger.debug('Workspace activity updated', { workspaceId, userId });
    } catch (error) {
        logger.error('Failed to update workspace activity', {
            workspaceId, error: error.message
        });
    }
}

/**
 * Checks for idle workspaces and stops them (cron job)
 */
async function checkIdleWorkspaces() {
    try {
        // Get all running workspaces
        const [workspaces] = await pool.query(
            `SELECT w.*, u.system_username
             FROM workspaces w
             JOIN dashboard_users u ON w.user_id = u.id
             WHERE w.status = ?`,
            [STATUS.RUNNING]
        );

        let stoppedCount = 0;

        for (const workspace of workspaces) {
            const idleMinutes = workspace.idle_timeout_minutes || 30;
            const lastActivity = workspace.last_activity || workspace.started_at;

            if (!lastActivity) continue;

            const idleTime = (Date.now() - new Date(lastActivity).getTime()) / 1000 / 60;

            if (idleTime >= idleMinutes) {
                logger.info('Stopping idle workspace', {
                    workspaceId: workspace.id,
                    projectName: workspace.project_name,
                    idleMinutes: Math.floor(idleTime)
                });

                try {
                    await stopWorkspace(workspace.user_id, workspace.project_name);
                    await logWorkspaceAction(
                        workspace.id,
                        workspace.user_id,
                        workspace.project_name,
                        'timeout',
                        { idle_minutes: Math.floor(idleTime) }
                    );
                    stoppedCount++;
                } catch (error) {
                    logger.error('Failed to stop idle workspace', {
                        workspaceId: workspace.id,
                        error: error.message
                    });
                }
            }
        }

        if (stoppedCount > 0) {
            logger.info('Idle workspace check completed', { stoppedCount });
        }

        return stoppedCount;
    } catch (error) {
        logger.error('Failed to check idle workspaces', { error: error.message });
        return 0;
    }
}

/**
 * Cleanup orphaned workspaces (containers gone but DB says running)
 */
async function cleanupOrphanedWorkspaces() {
    try {
        const [workspaces] = await pool.query(
            "SELECT * FROM workspaces WHERE status IN ('running', 'starting')"
        );

        let cleanedCount = 0;

        for (const workspace of workspaces) {
            if (!workspace.container_id) {
                // No container ID but status is running - fix it
                await pool.query(
                    'UPDATE workspaces SET status = ?, assigned_port = NULL WHERE id = ?',
                    [STATUS.STOPPED, workspace.id]
                );
                cleanedCount++;
                continue;
            }

            try {
                const container = docker.getContainer(workspace.container_id);
                const info = await container.inspect();

                if (!info.State.Running) {
                    // Container exists but not running
                    await pool.query(
                        `UPDATE workspaces SET
                            status = ?,
                            container_id = NULL,
                            assigned_port = NULL
                        WHERE id = ?`,
                        [STATUS.STOPPED, workspace.id]
                    );
                    cleanedCount++;
                }
            } catch (error) {
                // Container doesn't exist
                await pool.query(
                    `UPDATE workspaces SET
                        status = ?,
                        container_id = NULL,
                        assigned_port = NULL
                    WHERE id = ?`,
                    [STATUS.STOPPED, workspace.id]
                );
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            logger.info('Orphaned workspace cleanup completed', { cleanedCount });
        }

        return cleanedCount;
    } catch (error) {
        logger.error('Failed to cleanup orphaned workspaces', { error: error.message });
        return 0;
    }
}

// ============================================================
// CODE-SERVER PASSWORD
// ============================================================

/**
 * Gets the decrypted code-server password for a workspace
 * @param {number} workspaceId - Workspace ID
 * @returns {Promise<string|null>} Decrypted password or null
 */
async function getCodeServerPassword(workspaceId) {
    try {
        const [rows] = await pool.query(
            `SELECT code_server_password_encrypted, code_server_password_iv
             FROM workspaces WHERE id = ?`,
            [workspaceId]
        );

        if (rows.length === 0 || !rows[0].code_server_password_encrypted) {
            return null;
        }

        const secret = process.env.SESSION_SECRET;
        const encrypted = rows[0].code_server_password_encrypted;
        const iv = rows[0].code_server_password_iv;

        return encryption.decrypt(encrypted, iv, secret);
    } catch (error) {
        logger.error('Failed to get code-server password', {
            workspaceId, error: error.message
        });
        return null;
    }
}

// ============================================================
// API KEY MANAGEMENT
// ============================================================

/**
 * Validates API provider name against whitelist
 * @param {string} provider - Provider name to validate
 * @returns {string} Validated provider name
 * @throws {Error} If provider is invalid
 */
function validateProvider(provider) {
    const VALID_PROVIDERS = ['anthropic', 'openai'];
    if (!VALID_PROVIDERS.includes(provider)) {
        throw new Error('Invalid API provider');
    }
    return provider;
}

/**
 * Sets an encrypted API key for a user
 */
async function setApiKey(userId, provider, apiKey) {
    try {
        // Validate provider to prevent SQL injection
        provider = validateProvider(provider);

        const secret = process.env.SESSION_SECRET;
        if (!secret) {
            throw new Error('SESSION_SECRET not configured');
        }

        const { encrypted, iv } = encryption.encrypt(apiKey, secret);

        // Check if user has api_keys record
        const [existing] = await pool.query(
            'SELECT id FROM user_api_keys WHERE user_id = ?',
            [userId]
        );

        if (existing.length > 0) {
            // Update existing
            await pool.query(
                `UPDATE user_api_keys SET
                    ${provider}_key_encrypted = ?,
                    ${provider}_key_iv = ?,
                    updated_at = NOW()
                WHERE user_id = ?`,
                [encrypted, iv, userId]
            );
        } else {
            // Insert new
            await pool.query(
                `INSERT INTO user_api_keys (
                    user_id,
                    ${provider}_key_encrypted,
                    ${provider}_key_iv
                ) VALUES (?, ?, ?)`,
                [userId, encrypted, iv]
            );
        }

        logger.info('API key set for user', { userId, provider });
    } catch (error) {
        logger.error('Failed to set API key', {
            userId, provider, error: error.message
        });
        throw error;
    }
}

/**
 * Gets a decrypted API key for a user
 */
async function getDecryptedApiKey(userId, provider) {
    try {
        // Validate provider to prevent SQL injection
        provider = validateProvider(provider);

        const [rows] = await pool.query(
            `SELECT ${provider}_key_encrypted, ${provider}_key_iv
             FROM user_api_keys WHERE user_id = ?`,
            [userId]
        );

        if (rows.length === 0 || !rows[0][`${provider}_key_encrypted`]) {
            return null;
        }

        const secret = process.env.SESSION_SECRET;
        const encrypted = rows[0][`${provider}_key_encrypted`];
        const iv = rows[0][`${provider}_key_iv`];

        return encryption.decrypt(encrypted, iv, secret);
    } catch (error) {
        logger.error('Failed to get API key', {
            userId, provider, error: error.message
        });
        throw error;
    }
}

/**
 * Deletes an API key for a user
 */
async function deleteApiKey(userId, provider) {
    try {
        // Validate provider to prevent SQL injection
        provider = validateProvider(provider);

        await pool.query(
            `UPDATE user_api_keys SET
                ${provider}_key_encrypted = NULL,
                ${provider}_key_iv = NULL,
                updated_at = NOW()
            WHERE user_id = ?`,
            [userId]
        );

        logger.info('API key deleted for user', { userId, provider });
    } catch (error) {
        logger.error('Failed to delete API key', {
            userId, provider, error: error.message
        });
        throw error;
    }
}

/**
 * Checks if user has an API key configured
 */
async function hasApiKey(userId, provider) {
    try {
        // Validate provider to prevent SQL injection
        provider = validateProvider(provider);

        const [rows] = await pool.query(
            `SELECT ${provider}_key_encrypted
             FROM user_api_keys WHERE user_id = ?`,
            [userId]
        );

        return rows.length > 0 && rows[0][`${provider}_key_encrypted`] !== null;
    } catch (error) {
        logger.error('Failed to check API key', {
            userId, provider, error: error.message
        });
        return false;
    }
}

// ============================================================
// SYNC OPERATIONS (Project <-> Workspace)
// ============================================================

/**
 * Syncs workspace changes to the production project
 * Since we use shared volumes, files are already synced
 * This function mainly restarts the project container
 */
async function syncToProject(userId, projectName, systemUsername) {
    try {
        const workspace = await getWorkspace(userId, projectName);
        if (!workspace) {
            throw new Error('Workspace not found');
        }

        // Since workspace and project share the same volume,
        // files are already synced. We just need to restart the project.

        // Import project service to restart
        const projectService = require('./project');

        // Check if project container exists and is running
        const containers = await docker.listContainers({ all: true });
        const projectContainer = containers.find(c =>
            c.Names[0] === `/${projectName}`
        );

        if (projectContainer) {
            logger.info('Restarting project after workspace sync', { projectName });
            const container = docker.getContainer(projectContainer.Id);
            await container.restart();
        }

        await logWorkspaceAction(workspace.id, userId, projectName, 'sync_to_project');

        logger.info('Workspace synced to project', { workspaceId: workspace.id, projectName });

        return { success: true, message: 'Changes synced to project' };
    } catch (error) {
        logger.error('Failed to sync workspace to project', {
            userId, projectName, error: error.message
        });
        throw error;
    }
}

/**
 * Syncs project changes to the workspace
 * Since we use shared volumes, files are already synced
 */
async function syncFromProject(userId, projectName) {
    try {
        const workspace = await getWorkspace(userId, projectName);
        if (!workspace) {
            throw new Error('Workspace not found');
        }

        // Files are already synced via shared volume
        // Just log the action

        await logWorkspaceAction(workspace.id, userId, projectName, 'sync_from_project');

        logger.info('Project synced to workspace', { workspaceId: workspace.id, projectName });

        return { success: true, message: 'Project changes are now in workspace' };
    } catch (error) {
        logger.error('Failed to sync project to workspace', {
            userId, projectName, error: error.message
        });
        throw error;
    }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Parses memory limit string to bytes
 */
function parseMemoryLimit(limit) {
    const match = limit.match(/^(\d+)([mgMG])$/);
    if (!match) return 2 * 1024 * 1024 * 1024; // Default 2GB

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    if (unit === 'g') {
        return value * 1024 * 1024 * 1024;
    } else if (unit === 'm') {
        return value * 1024 * 1024;
    }

    return 2 * 1024 * 1024 * 1024;
}

/**
 * Parses CPU limit string to nano CPUs
 */
function parseCpuLimit(limit) {
    const value = parseFloat(limit);
    return Math.floor(value * 1e9); // 1 CPU = 1e9 nano CPUs
}

/**
 * Marks all workspaces as stopping (for graceful shutdown)
 */
async function markAllAsStopping() {
    try {
        await pool.query(
            "UPDATE workspaces SET status = ? WHERE status IN ('running', 'starting')",
            [STATUS.STOPPING]
        );
        logger.info('All workspaces marked as stopping');
    } catch (error) {
        logger.error('Failed to mark workspaces as stopping', { error: error.message });
    }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    // CRUD
    createWorkspace,
    startWorkspace,
    stopWorkspace,
    deleteWorkspace,

    // Queries
    getWorkspace,
    getWorkspaceById,
    getUserWorkspaces,
    getActiveWorkspaces,

    // Resource limits
    getResourceLimits,
    canCreateWorkspace,

    // Activity
    updateActivity,
    checkIdleWorkspaces,
    cleanupOrphanedWorkspaces,

    // Code-Server Password
    getCodeServerPassword,

    // API Keys
    setApiKey,
    getDecryptedApiKey,
    deleteApiKey,
    hasApiKey,

    // Sync
    syncToProject,
    syncFromProject,

    // Utility
    logWorkspaceAction,
    markAllAsStopping,

    // Constants
    STATUS
};
