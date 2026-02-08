/**
 * Project Port Service
 * Centralized port tracking for all projects via the project_ports table.
 * Prevents port conflicts by combining database lookups with filesystem scanning.
 */

const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../config/logger');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

/**
 * Get database pool (lazy to avoid circular dependency at import time)
 */
function getPool() {
    return require('../config/database').getPool();
}

/**
 * Register port mappings for a project in the database
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @param {Array<{service: string, internal: number, external: number, protocol?: string}>} portMappings
 */
async function registerPorts(userId, projectName, portMappings) {
    if (!portMappings || portMappings.length === 0) return;

    const pool = getPool();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Delete existing entries for this project (idempotent re-registration)
        await connection.execute(
            'DELETE FROM project_ports WHERE user_id = ? AND project_name = ?',
            [userId, projectName]
        );

        // Insert new entries
        for (const mapping of portMappings) {
            await connection.execute(
                `INSERT INTO project_ports (user_id, project_name, service_name, internal_port, external_port, protocol)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, projectName, mapping.service, mapping.internal, mapping.external, mapping.protocol || 'tcp']
            );
        }

        await connection.commit();
        logger.info('Registered project ports', { userId, projectName, count: portMappings.length });
    } catch (error) {
        await connection.rollback();
        logger.error('Failed to register project ports', { userId, projectName, error: error.message });
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Register a single base port for standard (non-custom) projects
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @param {number} port - The EXPOSED_PORT
 */
async function registerBasePort(userId, projectName, port) {
    await registerPorts(userId, projectName, [{
        service: 'main',
        internal: 0,
        external: port,
        protocol: 'tcp'
    }]);
}

/**
 * Remove all port entries for a project
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 */
async function releasePorts(userId, projectName) {
    const pool = getPool();
    await pool.execute(
        'DELETE FROM project_ports WHERE user_id = ? AND project_name = ?',
        [userId, projectName]
    );
    logger.debug('Released project ports', { userId, projectName });
}

/**
 * Get all external ports currently registered in the database
 * @returns {Promise<Set<number>>} Set of all used external ports
 */
async function getAllUsedPorts() {
    const pool = getPool();
    const [rows] = await pool.query('SELECT external_port FROM project_ports');
    return new Set(rows.map(r => r.external_port));
}

/**
 * Scan filesystem for EXPOSED_PORT values (fallback for unregistered projects)
 * @returns {Promise<Set<number>>}
 */
async function scanFilesystemPorts() {
    const usedPorts = new Set();

    try {
        const users = await fs.readdir(USERS_PATH, { withFileTypes: true });
        for (const user of users) {
            if (!user.isDirectory()) continue;
            const userPath = path.join(USERS_PATH, user.name);
            try {
                const projects = await fs.readdir(userPath, { withFileTypes: true });
                for (const project of projects) {
                    if (!project.isDirectory() || project.name.startsWith('.')) continue;
                    try {
                        const envContent = await fs.readFile(
                            path.join(userPath, project.name, '.env'), 'utf8'
                        );
                        const match = envContent.match(/EXPOSED_PORT=(\d+)/);
                        if (match) usedPorts.add(parseInt(match[1]));
                    } catch {
                        // .env not found
                    }
                }
            } catch {
                // user dir error
            }
        }
    } catch {
        // USERS_PATH not accessible
    }

    return usedPorts;
}

/**
 * Find next available port, checking both database and filesystem.
 * Database is primary, filesystem scan is fallback for robustness.
 * @param {number} [count=1] - Number of consecutive ports needed
 * @returns {Promise<number>} First available port
 */
async function findNextAvailablePort(count = 1) {
    let dbPorts = new Set();
    try {
        dbPorts = await getAllUsedPorts();
    } catch (error) {
        logger.warn('Failed to query project_ports table, using filesystem only', { error: error.message });
    }

    const fsPorts = await scanFilesystemPorts();

    // Merge both sets
    const allUsedPorts = new Set([...dbPorts, ...fsPorts]);

    // Find a contiguous block of 'count' free ports starting from 8001
    const MAX_PORT = 65535;
    let startPort = 8001;

    while (startPort + count - 1 <= MAX_PORT) {
        let blockFree = true;
        for (let i = 0; i < count; i++) {
            if (allUsedPorts.has(startPort + i)) {
                blockFree = false;
                startPort = startPort + i + 1;
                break;
            }
        }
        if (blockFree) return startPort;
    }

    throw new Error('No available ports in valid range (8001-65535)');
}

/**
 * Backfill port data from existing projects into database.
 * Scans all projects and registers their ports.
 * Safe to run multiple times (idempotent via DELETE + INSERT).
 * @returns {Promise<{processed: number, registered: number, errors: number}>}
 */
async function backfillPorts() {
    const YAML = require('yaml');
    const pool = getPool();
    const stats = { processed: 0, registered: 0, errors: 0 };

    // Map system_username -> user_id
    const [users] = await pool.query('SELECT id, system_username FROM dashboard_users');
    const userMap = {};
    for (const user of users) {
        userMap[user.system_username] = user.id;
    }

    let userDirs;
    try {
        userDirs = await fs.readdir(USERS_PATH, { withFileTypes: true });
    } catch {
        logger.warn('Cannot read USERS_PATH for port backfill', { path: USERS_PATH });
        return stats;
    }

    for (const userDir of userDirs) {
        if (!userDir.isDirectory() || userDir.name.startsWith('.')) continue;
        const userId = userMap[userDir.name];
        if (!userId) continue;

        const userPath = path.join(USERS_PATH, userDir.name);
        let projectDirs;
        try {
            projectDirs = await fs.readdir(userPath, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const projDir of projectDirs) {
            if (!projDir.isDirectory() || projDir.name.startsWith('.')) continue;
            stats.processed++;

            try {
                const projectPath = path.join(userPath, projDir.name);

                // Read EXPOSED_PORT from .env
                let envContent;
                try {
                    envContent = await fs.readFile(path.join(projectPath, '.env'), 'utf8');
                } catch {
                    continue;
                }

                const portMatch = envContent.match(/EXPOSED_PORT=(\d+)/);
                if (!portMatch) continue;
                const basePort = parseInt(portMatch[1]);

                // Check if this is a custom compose project by parsing docker-compose.yml
                let composeContent;
                try {
                    composeContent = await fs.readFile(path.join(projectPath, 'docker-compose.yml'), 'utf8');
                } catch {
                    // No compose file, register base port only
                    await registerBasePort(userId, projDir.name, basePort);
                    stats.registered++;
                    continue;
                }

                // Check for x-dployr marker (custom compose)
                if (composeContent.includes('x-dployr:')) {
                    try {
                        const parsed = YAML.parse(composeContent);
                        if (parsed && parsed.services) {
                            const portMappings = [];
                            for (const [serviceName, service] of Object.entries(parsed.services)) {
                                if (service.ports && Array.isArray(service.ports)) {
                                    for (const port of service.ports) {
                                        const portStr = typeof port === 'string' ? port : String(port);
                                        const match = portStr.match(/^(\d+):(\d+)/);
                                        if (match) {
                                            portMappings.push({
                                                service: serviceName,
                                                internal: parseInt(match[2]),
                                                external: parseInt(match[1]),
                                                protocol: portStr.includes('/udp') ? 'udp' : 'tcp'
                                            });
                                        }
                                    }
                                }
                            }
                            if (portMappings.length > 0) {
                                await registerPorts(userId, projDir.name, portMappings);
                                stats.registered += portMappings.length;
                                continue;
                            }
                        }
                    } catch {
                        // YAML parse error, fall through to base port
                    }
                }

                // Standard project: register base port only
                await registerBasePort(userId, projDir.name, basePort);
                stats.registered++;
            } catch (error) {
                stats.errors++;
                logger.warn('Backfill error for project', {
                    project: projDir.name, error: error.message
                });
            }
        }
    }

    logger.info('Port backfill completed', stats);
    return stats;
}

module.exports = {
    registerPorts,
    registerBasePort,
    releasePorts,
    getAllUsedPorts,
    scanFilesystemPorts,
    findNextAvailablePort,
    backfillPorts
};
