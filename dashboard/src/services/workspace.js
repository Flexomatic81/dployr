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
const fs = require('fs');
const https = require('https');
const http = require('http');
const { pool } = require('../config/database');
const { logger } = require('../config/logger');
const portManager = require('./portManager');
const encryption = require('./encryption');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Cache for public IP (refreshed every hour)
let cachedPublicIp = null;
let publicIpCacheTime = 0;
const PUBLIC_IP_CACHE_TTL = 60 * 60 * 1000; // 1 hour

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
 * Fetches the server's public IP address from external services
 * Uses caching to avoid excessive API calls
 * @returns {Promise<string|null>} Public IP or null if detection fails
 */
async function getPublicIp() {
    // Return cached value if still valid
    if (cachedPublicIp && (Date.now() - publicIpCacheTime) < PUBLIC_IP_CACHE_TTL) {
        return cachedPublicIp;
    }

    // List of IP detection services (fallback chain)
    const services = [
        { url: 'https://api.ipify.org', protocol: https },
        { url: 'https://ifconfig.me/ip', protocol: https },
        { url: 'https://icanhazip.com', protocol: https },
        { url: 'http://checkip.amazonaws.com', protocol: http }
    ];

    for (const service of services) {
        try {
            const ip = await new Promise((resolve, reject) => {
                const req = service.protocol.get(service.url, { timeout: 5000 }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(data.trim()));
                });
                req.on('error', reject);
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Timeout'));
                });
            });

            // Validate IP format
            if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
                cachedPublicIp = ip;
                publicIpCacheTime = Date.now();
                logger.info('Detected public IP', { ip, source: service.url });
                return ip;
            }
        } catch (error) {
            logger.debug('IP detection failed for service', { service: service.url, error: error.message });
        }
    }

    logger.warn('Could not detect public IP from any service');
    return null;
}

/**
 * Gets the workspace host address (IP for direct port access)
 * Priority: WORKSPACE_HOST env > SERVER_IP env > auto-detected public IP
 * @returns {Promise<string|null>} Host address or null
 */
async function getWorkspaceHost() {
    // First check explicit configuration
    if (process.env.WORKSPACE_HOST && process.env.WORKSPACE_HOST !== 'localhost') {
        return process.env.WORKSPACE_HOST;
    }

    if (process.env.SERVER_IP && process.env.SERVER_IP !== 'localhost') {
        return process.env.SERVER_IP;
    }

    // Auto-detect public IP
    return await getPublicIp();
}

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

/**
 * Generates CLAUDE.md file for a project if it doesn't exist
 * Provides Claude Code with project-specific context
 * @param {string} htmlPath - Path to project's html folder
 * @param {string} projectName - Project name
 * @param {string} systemUsername - User's system username
 */
async function generateClaudeMd(htmlPath, projectName, systemUsername) {
    const claudeMdPath = path.join(htmlPath, 'CLAUDE.md');

    // Don't overwrite existing CLAUDE.md
    if (fs.existsSync(claudeMdPath)) {
        logger.debug('CLAUDE.md already exists, skipping generation', { projectName });
        return;
    }

    try {
        // Detect project type from docker-compose.yml
        const projectPath = path.join(USERS_PATH, systemUsername, projectName);
        let projectType = 'unknown';
        try {
            const composePath = path.join(projectPath, 'docker-compose.yml');
            const content = fs.readFileSync(composePath, 'utf8');

            if (content.includes('composer install') || content.includes('APACHE_DOCUMENT_ROOT')) {
                projectType = 'laravel';
            } else if (content.includes('next') || (content.includes('npm run build') && content.includes('npm start') && content.includes('3000'))) {
                projectType = 'nextjs';
            } else if (content.includes('nuxt')) {
                projectType = 'nuxtjs';
            } else if (content.includes('npm run build') && content.includes('FROM nginx:alpine')) {
                projectType = 'nodejs-static';
            } else if (content.includes('gunicorn') && content.includes('django')) {
                projectType = 'python-django';
            } else if (content.includes('gunicorn') || content.includes('flask')) {
                projectType = 'python-flask';
            } else if (content.includes('php-fpm') || content.includes('php:')) {
                projectType = 'php-website';
            } else if (content.includes('node:') || content.includes('npm')) {
                projectType = 'nodejs-app';
            } else {
                projectType = 'static-website';
            }
        } catch (e) {
            // Couldn't read docker-compose.yml
        }

        // Check for database credentials
        let dbInfo = null;
        const credentialsPath = path.join(USERS_PATH, systemUsername, '.db-credentials');
        try {
            const credContent = fs.readFileSync(credentialsPath, 'utf8');
            // Look for any database entry
            const dbMatch = credContent.match(/DB_TYPE=(\w+)/);
            const hostMatch = credContent.match(/DB_HOST=([^\n]+)/);
            if (dbMatch) {
                dbInfo = {
                    type: dbMatch[1],
                    host: hostMatch ? hostMatch[1] : 'unknown'
                };
            }
        } catch (e) {
            // No credentials file
        }

        // Build project type specific info
        let typeInfo = '';
        switch (projectType) {
            case 'nodejs-app':
            case 'nextjs':
            case 'nuxtjs':
            case 'nodejs-static':
                typeInfo = `
## Project Type: ${projectType}

- **Runtime:** Node.js 20 LTS
- **Package Manager:** npm (also yarn and pnpm available)
- **Start Command:** Check package.json scripts`;
                break;
            case 'php-website':
            case 'laravel':
                typeInfo = `
## Project Type: ${projectType}

- **Runtime:** PHP 8.2 with Apache
- **Package Manager:** Composer
- **Extensions:** PDO, MySQL, PostgreSQL, cURL, mbstring, XML`;
                break;
            case 'python-flask':
            case 'python-django':
                typeInfo = `
## Project Type: ${projectType}

- **Runtime:** Python 3.12
- **Package Manager:** pip (venv available)
- **Server:** Gunicorn`;
                break;
            default:
                typeInfo = `
## Project Type: ${projectType}

- **Server:** Nginx (for static files)`;
        }

        // Build database info
        let dbSection = '';
        if (dbInfo) {
            dbSection = `
## Database

- **Type:** ${dbInfo.type === 'mariadb' ? 'MariaDB' : 'PostgreSQL'}
- **Host:** ${dbInfo.host}
- **Credentials:** See \`.env\` file or \`~/.db-credentials\`
- **Client:** ${dbInfo.type === 'mariadb' ? 'mysql' : 'psql'} command available`;
        }

        // Generate CLAUDE.md content
        const claudeMdContent = `# CLAUDE.md

This project runs in a dployr workspace container.

## Environment

- **Working Directory:** \`/workspace\` (project files)
- **User:** coder (non-root)
- **Shell:** bash
${typeInfo}
${dbSection}
## Important Notes

- All changes in \`/workspace\` are persisted and synced to the project
- Don't modify files outside \`/workspace\` (system files)
- Environment variables are in \`.env\` file
- Use the integrated terminal or VS Code for development

## Available Tools

- Git (configured with user credentials)
- Node.js 20, npm, yarn, pnpm
- PHP 8.2, Composer
- Python 3.12, pip
- Database clients (mysql, psql)
- Common utilities (curl, wget, jq, rsync, zip)

---
*Generated by dployr workspace. You can customize this file.*
`;

        fs.writeFileSync(claudeMdPath, claudeMdContent);
        logger.info('Generated CLAUDE.md for project', { projectName, projectType });

    } catch (error) {
        logger.warn('Failed to generate CLAUDE.md', { projectName, error: error.message });
        // Don't throw - this is not critical
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
 * Gets global resource limits (admin)
 */
async function getGlobalLimits() {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM resource_limits WHERE user_id IS NULL ORDER BY id ASC LIMIT 1'
        );

        return rows[0] || {
            max_workspaces: 2,
            default_cpu: '1',
            default_ram: '2g',
            default_idle_timeout: 30,
            max_previews_per_workspace: 3,
            default_preview_lifetime_hours: 24
        };
    } catch (error) {
        logger.error('Failed to get global limits', { error: error.message });
        throw error;
    }
}

/**
 * Sets global resource limits (admin)
 * Note: We use UPDATE instead of INSERT...ON DUPLICATE KEY because
 * MySQL/MariaDB treats NULL values as unique in UNIQUE constraints,
 * so ON DUPLICATE KEY doesn't work for user_id = NULL
 */
async function setGlobalLimits(limits) {
    try {
        const {
            max_workspaces,
            default_cpu,
            default_ram,
            default_idle_timeout,
            max_previews_per_workspace,
            default_preview_lifetime_hours
        } = limits;

        // Check if global limits row exists
        const [existing] = await pool.query(
            'SELECT id FROM resource_limits WHERE user_id IS NULL LIMIT 1'
        );

        if (existing.length > 0) {
            // Update existing global limits (use ORDER BY id ASC to always update the same row)
            await pool.query(`
                UPDATE resource_limits SET
                    max_workspaces = ?,
                    default_cpu = ?,
                    default_ram = ?,
                    default_idle_timeout = ?,
                    max_previews_per_workspace = ?,
                    default_preview_lifetime_hours = ?,
                    updated_at = NOW()
                WHERE user_id IS NULL
                ORDER BY id ASC
                LIMIT 1
            `, [
                max_workspaces,
                default_cpu,
                default_ram,
                default_idle_timeout,
                max_previews_per_workspace,
                default_preview_lifetime_hours
            ]);
        } else {
            // Insert new global limits
            await pool.query(`
                INSERT INTO resource_limits
                    (user_id, max_workspaces, default_cpu, default_ram,
                     default_idle_timeout, max_previews_per_workspace,
                     default_preview_lifetime_hours)
                VALUES (NULL, ?, ?, ?, ?, ?, ?)
            `, [
                max_workspaces,
                default_cpu,
                default_ram,
                default_idle_timeout,
                max_previews_per_workspace,
                default_preview_lifetime_hours
            ]);
        }

        logger.info('Global limits updated', { limits });
    } catch (error) {
        logger.error('Failed to set global limits', { error: error.message });
        throw error;
    }
}

/**
 * Gets user-specific limits (without fallback to global)
 */
async function getUserLimits(userId) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM resource_limits WHERE user_id = ?',
            [userId]
        );

        return rows[0] || null;
    } catch (error) {
        logger.error('Failed to get user limits', { userId, error: error.message });
        throw error;
    }
}

/**
 * Sets user-specific resource limits (admin)
 */
async function setUserLimits(userId, limits) {
    try {
        const {
            max_workspaces,
            default_cpu,
            default_ram,
            default_idle_timeout,
            max_previews_per_workspace,
            default_preview_lifetime_hours
        } = limits;

        await pool.query(`
            INSERT INTO resource_limits
                (user_id, max_workspaces, default_cpu, default_ram,
                 default_idle_timeout, max_previews_per_workspace,
                 default_preview_lifetime_hours)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                max_workspaces = VALUES(max_workspaces),
                default_cpu = VALUES(default_cpu),
                default_ram = VALUES(default_ram),
                default_idle_timeout = VALUES(default_idle_timeout),
                max_previews_per_workspace = VALUES(max_previews_per_workspace),
                default_preview_lifetime_hours = VALUES(default_preview_lifetime_hours)
        `, [
            userId,
            max_workspaces,
            default_cpu,
            default_ram,
            default_idle_timeout,
            max_previews_per_workspace,
            default_preview_lifetime_hours
        ]);

        logger.info('User limits updated', { userId, limits });
    } catch (error) {
        logger.error('Failed to set user limits', { userId, error: error.message });
        throw error;
    }
}

/**
 * Gets all workspaces with active statuses for admin panel
 */
async function getAdminWorkspaces() {
    try {
        const [rows] = await pool.query(`
            SELECT w.*, u.username
            FROM workspaces w
            JOIN dashboard_users u ON w.user_id = u.id
            WHERE w.status IN ('running', 'starting', 'stopping')
            ORDER BY w.started_at DESC
        `);

        return rows;
    } catch (error) {
        logger.error('Failed to get admin workspaces', { error: error.message });
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
 * Prepares workspace paths and ensures directories exist
 * @private
 */
function prepareWorkspacePaths(systemUsername, projectName) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);
    const htmlPath = path.join(projectPath, 'html');
    const hostHtmlPath = toHostPath(htmlPath);
    const claudeConfigPath = path.join(USERS_PATH, systemUsername, '.claude-config');
    const hostClaudeConfigPath = toHostPath(claudeConfigPath);

    // Ensure directories exist
    if (!fs.existsSync(htmlPath)) {
        fs.mkdirSync(htmlPath, { recursive: true });
    }
    if (!fs.existsSync(claudeConfigPath)) {
        fs.mkdirSync(claudeConfigPath, { recursive: true });
    }

    return { projectPath, htmlPath, hostHtmlPath, claudeConfigPath, hostClaudeConfigPath };
}

/**
 * Builds environment variables for workspace container
 * @private
 */
async function buildWorkspaceEnv(userId, apiKey, codeServerPassword) {
    const env = [
        'CLAUDE_AUTO_UPDATE=false',
        `CODE_SERVER_PASSWORD=${codeServerPassword}`
    ];

    if (apiKey) {
        env.push(`ANTHROPIC_API_KEY=${apiKey}`);
    }

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

    return env;
}

/**
 * Creates Docker container configuration for workspace
 * @private
 */
function buildContainerConfig(containerName, env, hostHtmlPath, hostClaudeConfigPath, workspace, userId, systemUsername, projectName) {
    return {
        name: containerName,
        Image: WORKSPACE_IMAGE,
        Env: env,
        ExposedPorts: {
            '8080/tcp': {}
        },
        HostConfig: {
            Binds: [
                `${hostHtmlPath}:/workspace`,
                `${hostClaudeConfigPath}:/claude-config`
            ],
            Memory: parseMemoryLimit(workspace.ram_limit),
            NanoCpus: parseCpuLimit(workspace.cpu_limit),
            RestartPolicy: { Name: 'unless-stopped' },
            SecurityOpt: ['no-new-privileges:true'],
            CapDrop: ['ALL'],
            CapAdd: ['CHOWN', 'SETUID', 'SETGID', 'DAC_OVERRIDE'],
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
    };
}

/**
 * Starts a workspace container
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @param {string} systemUsername - System username for file paths
 */
async function startWorkspace(userId, projectName, systemUsername) {
    let workspaceId = null;

    try {
        // Get and validate workspace
        const workspace = await getWorkspace(userId, projectName);
        if (!workspace) {
            throw new Error('Workspace not found');
        }

        workspaceId = workspace.id;

        if (workspace.status === STATUS.RUNNING) {
            return workspace;
        }

        // Update status to starting
        await pool.query(
            'UPDATE workspaces SET status = ? WHERE id = ?',
            [STATUS.STARTING, workspaceId]
        );

        // Verify workspace image exists
        try {
            await docker.getImage(WORKSPACE_IMAGE).inspect();
        } catch (error) {
            throw new Error(`Workspace image ${WORKSPACE_IMAGE} not found. Please build it first.`);
        }

        // Prepare paths and directories
        const { htmlPath, hostHtmlPath, hostClaudeConfigPath } = prepareWorkspacePaths(
            systemUsername, projectName
        );

        // Generate CLAUDE.md if needed
        await generateClaudeMd(htmlPath, projectName, systemUsername);

        // Get API key if configured
        let apiKey = null;
        try {
            apiKey = await getDecryptedApiKey(userId, 'anthropic');
        } catch (error) {
            logger.debug('No API key configured for user', { userId });
        }

        // Generate credentials
        const port = await portManager.allocatePort();
        const containerName = getContainerName(userId, projectName);
        const codeServerPassword = crypto.randomBytes(32).toString('base64');

        // Build environment and container config
        const env = await buildWorkspaceEnv(userId, apiKey, codeServerPassword);
        const containerConfig = buildContainerConfig(
            containerName, env, hostHtmlPath, hostClaudeConfigPath,
            workspace, userId, systemUsername, projectName
        );

        // Create and start container
        const container = await docker.createContainer(containerConfig);
        await container.start();

        // Encrypt password for storage
        const secret = process.env.SESSION_SECRET;
        const { encrypted: encryptedPassword, iv: passwordIv } = encryption.encrypt(
            codeServerPassword, secret
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
            container_id: container.id, port
        });

        logger.info('Workspace started', {
            workspaceId, userId, projectName, containerName, port
        });

        return await getWorkspaceById(workspaceId);
    } catch (error) {
        logger.error('Failed to start workspace', {
            userId, projectName, error: error.message
        });

        if (workspaceId) {
            await pool.query(
                'UPDATE workspaces SET status = ?, error_message = ? WHERE id = ?',
                [STATUS.ERROR, error.message, workspaceId]
            );

            await logWorkspaceAction(workspaceId, userId, projectName, 'error', {
                operation: 'start', error: error.message
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
 *
 * Since we use shared volumes, files are already synced.
 * This function rebuilds/restarts the project container to apply changes.
 *
 * For different project types:
 * - nodejs-app, nextjs, nuxtjs: Rebuild to run npm install + build
 * - laravel, php-website: Rebuild to run composer install
 * - python-flask, python-django: Rebuild to run pip install
 * - static-website, nodejs-static: Simple restart (no dependencies)
 */
async function syncToProject(userId, projectName, systemUsername) {
    try {
        const workspace = await getWorkspace(userId, projectName);
        if (!workspace) {
            throw new Error('Workspace not found');
        }

        const projectService = require('./project');
        const dockerService = require('./docker');

        // Get project path and info
        const projectPath = path.join(USERS_PATH, systemUsername, projectName);
        const projectInfo = await projectService.getProjectInfo(systemUsername, projectName);

        if (!projectInfo) {
            throw new Error('Project not found');
        }

        const projectType = projectInfo.templateType;
        const actions = [];

        // Determine if we need a full rebuild or just a restart
        // Rebuild is needed for projects with dependencies (npm, composer, pip)
        // Custom projects always rebuild since they may have custom Dockerfiles
        const needsRebuild = [
            'nodejs-app',
            'nextjs',
            'nuxtjs',
            'laravel',
            'php-website',
            'python-flask',
            'python-django',
            'custom'
        ].includes(projectType);

        logger.info('Starting workspace sync to project', {
            projectName,
            projectType,
            needsRebuild,
            containerStatus: projectInfo.status
        });

        if (needsRebuild) {
            // Full rebuild: down + up --build
            // This ensures npm install, composer install, pip install etc. run
            actions.push('rebuild');

            try {
                await rebuildProject(projectPath);
                logger.info('Project rebuilt after workspace sync', { projectName, projectType });
            } catch (error) {
                logger.error('Rebuild failed, trying simple restart', {
                    projectName,
                    error: error.message
                });
                // Fallback to restart if rebuild fails
                await dockerService.restartProject(projectPath);
                actions.push('restart-fallback');
            }
        } else {
            // Simple restart for static projects
            actions.push('restart');

            if (projectInfo.status === 'stopped') {
                // Start if not running
                await dockerService.startProject(projectPath);
                actions.push('started');
                logger.info('Project started after workspace sync', { projectName });
            } else {
                // Restart if already running
                await dockerService.restartProject(projectPath);
                logger.info('Project restarted after workspace sync', { projectName });
            }
        }

        await logWorkspaceAction(workspace.id, userId, projectName, 'sync_to_project', {
            projectType,
            actions
        });

        logger.info('Workspace synced to project', {
            workspaceId: workspace.id,
            projectName,
            projectType,
            actions
        });

        return {
            success: true,
            message: needsRebuild
                ? 'Project rebuilt with latest changes'
                : 'Project restarted with latest changes',
            projectType,
            actions
        };
    } catch (error) {
        logger.error('Failed to sync workspace to project', {
            userId, projectName, error: error.message
        });
        throw error;
    }
}

/**
 * Rebuilds a project container (down + up --build)
 * This runs dependency installation and build steps defined in docker-compose.yml
 */
async function rebuildProject(projectPath) {
    const { exec } = require('child_process');
    const hostPath = toHostPath(projectPath);

    return new Promise((resolve, reject) => {
        // First stop, then rebuild with --build flag
        const command = `docker compose -f "${hostPath}/docker-compose.yml" --project-directory "${hostPath}" up -d --build --force-recreate`;

        exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
            } else {
                resolve(stdout);
            }
        });
    });
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

/**
 * Gets the IP address of a container for internal proxying
 * @param {string} containerId - Docker container ID
 * @returns {Promise<string|null>} Container IP address or null
 */
async function getContainerIp(containerId) {
    try {
        const container = docker.getContainer(containerId);
        const info = await container.inspect();

        // Get IP from the dployr-network
        const networks = info.NetworkSettings.Networks;
        if (networks[WORKSPACE_NETWORK]) {
            return networks[WORKSPACE_NETWORK].IPAddress;
        }

        // Fallback: try to get any available IP
        for (const network of Object.values(networks)) {
            if (network.IPAddress) {
                return network.IPAddress;
            }
        }

        return null;
    } catch (error) {
        logger.error('Failed to get container IP', {
            containerId, error: error.message
        });
        return null;
    }
}

// ============================================================
// CLAUDE CODE INTEGRATION
// ============================================================

/**
 * Checks if Claude Code is authenticated in a workspace container
 * by checking for the existence of credentials in ~/.claude
 *
 * @param {string} containerId - Docker container ID
 * @returns {Promise<boolean>} True if authenticated
 */
async function getClaudeAuthStatus(containerId) {
    try {
        const container = docker.getContainer(containerId);

        // Check if credentials file exists
        const exec = await container.exec({
            Cmd: ['sh', '-c', 'test -f /home/coder/.claude/credentials.json && cat /home/coder/.claude/credentials.json'],
            AttachStdout: true,
            AttachStderr: true,
            User: 'coder'
        });

        const stream = await exec.start({ hijack: true });

        return new Promise((resolve) => {
            let output = '';
            stream.on('data', (chunk) => {
                output += chunk.toString();
            });
            stream.on('end', () => {
                try {
                    // Try to parse credentials - if it works, we're authenticated
                    if (output.trim()) {
                        // Remove docker stream header bytes if present
                        const jsonStart = output.indexOf('{');
                        if (jsonStart !== -1) {
                            const jsonStr = output.substring(jsonStart);
                            const credentials = JSON.parse(jsonStr);
                            // Check if token exists and is not expired
                            if (credentials.claudeAiOauth || credentials.accessToken) {
                                resolve(true);
                                return;
                            }
                        }
                    }
                    resolve(false);
                } catch (e) {
                    // Parsing failed, probably not authenticated
                    resolve(false);
                }
            });
            stream.on('error', () => resolve(false));

            // Timeout after 3 seconds
            setTimeout(() => resolve(false), 3000);
        });
    } catch (error) {
        logger.debug('Claude auth status check failed', {
            containerId,
            error: error.message
        });
        return false;
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
    getGlobalLimits,
    setGlobalLimits,
    getUserLimits,
    setUserLimits,
    canCreateWorkspace,

    // Admin
    getAdminWorkspaces,

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
    getContainerIp,
    getWorkspaceHost,

    // Claude Code
    getClaudeAuthStatus,

    // Constants
    STATUS
};
