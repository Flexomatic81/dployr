/**
 * Admin System Logs Routes
 * Handles system log viewing and deployment history
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const readline = require('readline');
const { createReadStream } = require('fs');
const { pool } = require('../../config/database');
const { logger } = require('../../config/logger');

const LOG_DIR = process.env.LOG_DIR || '/app/logs';

// Helper function: Read last N lines of a file (efficiently)
async function readLastLines(filePath, maxLines = 500) {
    return new Promise((resolve, reject) => {
        const lines = [];

        const rl = readline.createInterface({
            input: createReadStream(filePath),
            crlfDelay: Infinity
        });

        rl.on('line', (line) => {
            lines.push(line);
            // Keep only the last maxLines
            if (lines.length > maxLines) {
                lines.shift();
            }
        });

        rl.on('close', () => resolve(lines));
        rl.on('error', reject);
    });
}

// Helper function: Parse log line (Winston JSON format)
function parseLogLine(line) {
    try {
        const parsed = JSON.parse(line);
        return {
            timestamp: parsed.timestamp || '',
            level: parsed.level || 'info',
            message: parsed.message || '',
            meta: { ...parsed, timestamp: undefined, level: undefined, message: undefined, service: undefined }
        };
    } catch {
        // Fallback for non-JSON lines
        return {
            timestamp: '',
            level: 'info',
            message: line,
            meta: {}
        };
    }
}

// Show system logs
router.get('/', async (req, res) => {
    try {
        const logType = req.query.type || 'combined'; // combined or error
        const levelFilter = req.query.level || 'all'; // all, error, warn, info
        const limit = Math.min(parseInt(req.query.limit) || 200, 1000);

        const logFile = logType === 'error' ? 'error.log' : 'combined.log';
        const logPath = path.join(LOG_DIR, logFile);

        let logs = [];
        let error = null;

        try {
            const lines = await readLastLines(logPath, limit * 2); // Read more lines for filtering
            logs = lines
                .map(parseLogLine)
                .filter(log => {
                    if (levelFilter === 'all') return true;
                    return log.level === levelFilter;
                })
                .slice(-limit)
                .reverse(); // Newest first
        } catch (err) {
            if (err.code === 'ENOENT') {
                error = `Log file not found: ${logFile}`;
            } else {
                error = `Error reading logs: ${err.message}`;
            }
        }

        res.render('admin/logs', {
            title: 'System-Logs',
            logs,
            error,
            filters: {
                type: logType,
                level: levelFilter,
                limit
            }
        });
    } catch (error) {
        logger.error('Error loading system logs', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

// System logs as JSON API (for live refresh)
router.get('/api', async (req, res) => {
    try {
        const logType = req.query.type || 'combined';
        const levelFilter = req.query.level || 'all';
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);

        const logFile = logType === 'error' ? 'error.log' : 'combined.log';
        const logPath = path.join(LOG_DIR, logFile);

        const lines = await readLastLines(logPath, limit * 2);
        const logs = lines
            .map(parseLogLine)
            .filter(log => {
                if (levelFilter === 'all') return true;
                return log.level === levelFilter;
            })
            .slice(-limit)
            .reverse();

        res.json({ success: true, logs });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Show deployment history
router.get('/deployments', async (req, res) => {
    try {
        const statusFilter = req.query.status || 'all';
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        let query = `
            SELECT
                dl.*,
                dl.created_at as deployed_at,
                dl.old_commit_hash as commit_before,
                dl.new_commit_hash as commit_after,
                u.username,
                u.system_username
            FROM deployment_logs dl
            JOIN dashboard_users u ON dl.user_id = u.id
        `;

        const params = [];
        if (statusFilter !== 'all') {
            query += ' WHERE dl.status = ?';
            params.push(statusFilter);
        }

        query += ' ORDER BY dl.created_at DESC LIMIT ?';
        params.push(limit);

        const [deployments] = await pool.execute(query, params);

        // Calculate statistics
        const [stats] = await pool.execute(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                AVG(duration_ms) as avg_duration
            FROM deployment_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `);

        res.render('admin/deployments', {
            title: 'Deployment History',
            deployments,
            stats: stats[0],
            filters: {
                status: statusFilter,
                limit
            }
        });
    } catch (error) {
        logger.error('Error loading deployment history', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

module.exports = router;
