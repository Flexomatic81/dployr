/**
 * Port Manager Service
 *
 * Responsible for:
 * - Dynamic port allocation for workspaces
 * - Avoiding port conflicts
 * - Port release management
 */

const { pool } = require('../config/database');
const { logger } = require('../config/logger');

// Port range for workspace containers
const PORT_RANGE = {
    start: parseInt(process.env.WORKSPACE_PORT_RANGE_START) || 10000,
    end: parseInt(process.env.WORKSPACE_PORT_RANGE_END) || 10100
};

/**
 * Allocates a free port from the available range
 * Uses database-level locking to prevent race conditions
 * @returns {Promise<number>} The allocated port
 * @throws {Error} If no ports are available
 */
async function allocatePort() {
    const connection = await pool.getConnection();
    try {
        // Start transaction for atomic port allocation
        await connection.beginTransaction();

        // Lock tables to prevent concurrent allocations
        await connection.query('LOCK TABLES workspaces WRITE, preview_environments WRITE');

        // Get all currently assigned ports
        const [rows] = await connection.query(
            `SELECT assigned_port FROM workspaces WHERE assigned_port IS NOT NULL
             UNION
             SELECT assigned_port FROM preview_environments WHERE assigned_port IS NOT NULL`
        );

        const usedPorts = new Set(rows.map(r => r.assigned_port));

        // Find first available port in range
        for (let port = PORT_RANGE.start; port <= PORT_RANGE.end; port++) {
            if (!usedPorts.has(port)) {
                // Commit transaction and unlock tables
                await connection.commit();
                await connection.query('UNLOCK TABLES');

                logger.debug('Port allocated', { port });
                return port;
            }
        }

        // No ports available - rollback and unlock
        await connection.rollback();
        await connection.query('UNLOCK TABLES');

        throw new Error(`No available ports in range ${PORT_RANGE.start}-${PORT_RANGE.end}`);
    } catch (error) {
        // Ensure cleanup on error
        try {
            await connection.rollback();
            await connection.query('UNLOCK TABLES');
        } catch (cleanupError) {
            logger.error('Port allocation cleanup failed', { error: cleanupError.message });
        }

        logger.error('Port allocation failed', { error: error.message });
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Releases a port (called when workspace is stopped or deleted)
 * Port is automatically freed when workspace.assigned_port is set to NULL
 * @param {number} port - The port to release
 */
async function releasePort(port) {
    logger.debug('Port released', { port });
    // No explicit action needed - port is freed via UPDATE workspace SET assigned_port = NULL
}

/**
 * Checks if a port is currently in use
 * @param {number} port - The port to check
 * @returns {Promise<boolean>} True if port is in use
 */
async function isPortInUse(port) {
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(*) as count FROM (
                SELECT assigned_port FROM workspaces WHERE assigned_port = ?
                UNION ALL
                SELECT assigned_port FROM preview_environments WHERE assigned_port = ?
            ) as ports`,
            [port, port]
        );

        return rows[0].count > 0;
    } catch (error) {
        logger.error('Port check failed', { port, error: error.message });
        return true; // Assume in use on error (safe default)
    }
}

/**
 * Gets statistics about port usage
 * @returns {Promise<{total: number, used: number, available: number}>}
 */
async function getPortStats() {
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(DISTINCT assigned_port) as used FROM (
                SELECT assigned_port FROM workspaces WHERE assigned_port IS NOT NULL
                UNION
                SELECT assigned_port FROM preview_environments WHERE assigned_port IS NOT NULL
            ) as ports`
        );

        const total = PORT_RANGE.end - PORT_RANGE.start + 1;
        const used = rows[0].used;

        return {
            total,
            used,
            available: total - used,
            range: PORT_RANGE
        };
    } catch (error) {
        logger.error('Failed to get port stats', { error: error.message });
        throw error;
    }
}

module.exports = {
    allocatePort,
    releasePort,
    isPortInUse,
    getPortStats,
    PORT_RANGE
};
