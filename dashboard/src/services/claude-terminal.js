/**
 * Claude Terminal Service
 *
 * Provides WebSocket-based Claude Code terminal access to workspace containers.
 * Automatically starts Claude and parses output for authentication URLs.
 */

const Docker = require('dockerode');
const { logger } = require('../config/logger');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Active Claude sessions: Map<sessionId, { exec, stream, container, authCallback }>
const sessions = new Map();

// Regex patterns for detecting Claude auth URLs and success messages
// Note: These match clean text (after ANSI codes are stripped)
const AUTH_URL_PATTERNS = [
    /https:\/\/claude\.ai\/oauth[^\s]*/g,
    /https:\/\/console\.anthropic\.com\/oauth[^\s]*/g,
    /https:\/\/[^\s]*\/oauth\/authorize[^\s]*/g
];

const AUTH_SUCCESS_PATTERNS = [
    /Successfully authenticated/i,
    /Welcome to Claude/i,
    /Authentication successful/i,
    /Logged in as/i,
    /You are now logged in/i
];

/**
 * Creates a new Claude terminal session in a container
 * @param {string} containerId - Docker container ID
 * @param {object} options - Terminal options
 * @param {function} onAuthUrl - Callback when auth URL is detected
 * @param {function} onAuthSuccess - Callback when auth is successful
 * @returns {object} Session with exec stream
 */
async function createClaudeSession(containerId, options = {}, onAuthUrl = null, onAuthSuccess = null) {
    const { cols = 80, rows = 24 } = options;

    const container = docker.getContainer(containerId);

    // Verify container is running
    const info = await container.inspect();
    if (!info.State.Running) {
        throw new Error('Container is not running');
    }

    // Create exec instance that starts claude directly
    // Use YOLO mode (--dangerously-skip-permissions) since workspace is already isolated
    const exec = await container.exec({
        Cmd: ['/bin/bash', '-c', 'claude --dangerously-skip-permissions'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        User: 'coder',
        WorkingDir: '/workspace',
        Env: [
            'TERM=xterm-256color',
            `COLUMNS=${cols}`,
            `LINES=${rows}`,
            'PATH=/home/coder/.local/bin:/usr/local/bin:/usr/bin:/bin',
            'HOME=/home/coder'
        ]
    });

    // Start the exec instance
    const stream = await exec.start({
        hijack: true,
        stdin: true,
        Tty: true
    });

    // Generate session ID
    const sessionId = `claude_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store session
    const session = {
        exec,
        stream,
        container,
        containerId,
        cols,
        rows,
        createdAt: new Date(),
        onAuthUrl,
        onAuthSuccess,
        authDetected: false,
        authSuccessDetected: false
    };

    sessions.set(sessionId, session);

    logger.info('Claude terminal session created', { sessionId, containerId });

    return {
        sessionId,
        stream,
        exec
    };
}

/**
 * Parses terminal output for auth URLs and success messages
 * @param {string} sessionId - Session ID
 * @param {string} data - Terminal output data
 * @returns {object} Parsed result with authUrl and authSuccess flags
 */
function parseOutput(sessionId, data) {
    const session = sessions.get(sessionId);
    if (!session) {
        return { authUrl: null, authSuccess: false };
    }

    let authUrl = null;
    let authSuccess = false;

    // Clean ANSI codes FIRST, then search for URLs
    // This prevents truncation when escape codes are embedded in URLs (e.g., hyperlinks)
    const cleanData = cleanAnsiCodes(data);

    // Check for auth URLs
    if (!session.authSuccessDetected) {
        for (const pattern of AUTH_URL_PATTERNS) {
            const matches = cleanData.match(pattern);
            if (matches && matches.length > 0) {
                authUrl = matches[0].trim();
                session.authDetected = true;

                if (session.onAuthUrl) {
                    session.onAuthUrl(authUrl);
                }

                logger.info('Claude auth URL detected', { sessionId, url: authUrl });
                break;
            }
        }
    }

    // Check for auth success (use clean data for consistency)
    if (session.authDetected && !session.authSuccessDetected) {
        for (const pattern of AUTH_SUCCESS_PATTERNS) {
            if (pattern.test(cleanData)) {
                authSuccess = true;
                session.authSuccessDetected = true;

                if (session.onAuthSuccess) {
                    session.onAuthSuccess();
                }

                logger.info('Claude authentication successful', { sessionId });
                break;
            }
        }
    }

    return { authUrl, authSuccess };
}

/**
 * Removes all ANSI/terminal control sequences from string
 * Handles CSI sequences (colors), OSC sequences (hyperlinks), and other escapes
 * @param {string} str - String with control codes
 * @returns {string} Clean string
 */
function cleanAnsiCodes(str) {
    // eslint-disable-next-line no-control-regex
    return str
        // Remove CSI sequences (e.g., colors): ESC [ ... letter
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        // Remove OSC sequences (e.g., hyperlinks): ESC ] ... (ST or BEL)
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        // Remove any remaining escape sequences
        .replace(/\x1b[^[\]]\S*/g, '')
        .trim();
}

/**
 * Resizes a Claude terminal session
 * @param {string} sessionId - Session ID
 * @param {number} cols - New column count
 * @param {number} rows - New row count
 */
async function resizeClaudeTerminal(sessionId, cols, rows) {
    const session = sessions.get(sessionId);
    if (!session) {
        throw new Error('Session not found');
    }

    try {
        await session.exec.resize({ w: cols, h: rows });
        session.cols = cols;
        session.rows = rows;
        logger.debug('Claude terminal resized', { sessionId, cols, rows });
    } catch (error) {
        logger.warn('Failed to resize Claude terminal', { sessionId, error: error.message });
    }
}

/**
 * Closes a Claude terminal session
 * @param {string} sessionId - Session ID
 */
function closeClaudeSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
        return;
    }

    try {
        if (session.stream) {
            session.stream.end();
        }
    } catch (error) {
        logger.debug('Error closing Claude terminal stream', { error: error.message });
    }

    sessions.delete(sessionId);
    logger.info('Claude terminal session closed', { sessionId });
}

/**
 * Gets a session by ID
 * @param {string} sessionId - Session ID
 * @returns {object|null} Session or null
 */
function getClaudeSession(sessionId) {
    return sessions.get(sessionId) || null;
}

/**
 * Cleanup old sessions (called periodically)
 */
function cleanupClaudeSessions() {
    const maxAge = 4 * 60 * 60 * 1000; // 4 hours
    const now = Date.now();

    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.createdAt.getTime() > maxAge) {
            logger.info('Cleaning up stale Claude terminal session', { sessionId });
            closeClaudeSession(sessionId);
        }
    }
}

// Cleanup every hour
setInterval(cleanupClaudeSessions, 60 * 60 * 1000);

module.exports = {
    createClaudeSession,
    parseOutput,
    resizeClaudeTerminal,
    closeClaudeSession,
    getClaudeSession
};
