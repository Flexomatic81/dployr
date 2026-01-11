/**
 * Terminal Service
 *
 * Provides WebSocket-based terminal access to workspace containers
 * using docker exec to spawn interactive shells.
 */

const Docker = require('dockerode');
const { logger } = require('../config/logger');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Active terminal sessions: Map<sessionId, { exec, stream, container }>
const sessions = new Map();

/**
 * Creates a new terminal session in a container
 * @param {string} containerId - Docker container ID
 * @param {object} options - Terminal options
 * @returns {object} Session with exec stream
 */
async function createTerminalSession(containerId, options = {}) {
    const { cols = 80, rows = 24 } = options;

    const container = docker.getContainer(containerId);

    // Verify container is running
    const info = await container.inspect();
    if (!info.State.Running) {
        throw new Error('Container is not running');
    }

    // Create exec instance with interactive shell
    const exec = await container.exec({
        Cmd: ['/bin/bash'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        User: 'coder', // Run as coder user (same as code-server)
        WorkingDir: '/workspace',
        Env: [
            'TERM=xterm-256color',
            `COLUMNS=${cols}`,
            `LINES=${rows}`
        ]
    });

    // Start the exec instance
    const stream = await exec.start({
        hijack: true,
        stdin: true,
        Tty: true
    });

    // Generate session ID
    const sessionId = `term_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store session
    sessions.set(sessionId, {
        exec,
        stream,
        container,
        containerId,
        cols,
        rows,
        createdAt: new Date()
    });

    logger.info('Terminal session created', { sessionId, containerId });

    return {
        sessionId,
        stream,
        exec
    };
}

/**
 * Resizes a terminal session
 * @param {string} sessionId - Session ID
 * @param {number} cols - New column count
 * @param {number} rows - New row count
 */
async function resizeTerminal(sessionId, cols, rows) {
    const session = sessions.get(sessionId);
    if (!session) {
        throw new Error('Session not found');
    }

    try {
        await session.exec.resize({ w: cols, h: rows });
        session.cols = cols;
        session.rows = rows;
        logger.debug('Terminal resized', { sessionId, cols, rows });
    } catch (error) {
        logger.warn('Failed to resize terminal', { sessionId, error: error.message });
    }
}

/**
 * Closes a terminal session
 * @param {string} sessionId - Session ID
 */
function closeSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
        return;
    }

    try {
        if (session.stream) {
            session.stream.end();
        }
    } catch (error) {
        logger.debug('Error closing terminal stream', { error: error.message });
    }

    sessions.delete(sessionId);
    logger.info('Terminal session closed', { sessionId });
}

/**
 * Gets a session by ID
 * @param {string} sessionId - Session ID
 * @returns {object|null} Session or null
 */
function getSession(sessionId) {
    return sessions.get(sessionId) || null;
}

/**
 * Cleanup old sessions (called periodically)
 */
function cleanupSessions() {
    const maxAge = 4 * 60 * 60 * 1000; // 4 hours
    const now = Date.now();

    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.createdAt.getTime() > maxAge) {
            logger.info('Cleaning up stale terminal session', { sessionId });
            closeSession(sessionId);
        }
    }
}

// Cleanup every hour
setInterval(cleanupSessions, 60 * 60 * 1000);

module.exports = {
    createTerminalSession,
    resizeTerminal,
    closeSession,
    getSession
};
