const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { createReadStream } = require('fs');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const userService = require('../services/user');
const projectService = require('../services/project');
const { logger } = require('../config/logger');
const { pool } = require('../config/database');

const LOG_DIR = process.env.LOG_DIR || '/app/logs';

// All admin routes require admin privileges
router.use(requireAuth);
router.use(requireAdmin);

// Admin Dashboard - Overview
router.get('/', async (req, res) => {
    try {
        // Fetch all counts in parallel
        const [userCount, adminCount, pendingCount, users] = await Promise.all([
            userService.getUserCount(),
            userService.getAdminCount(),
            userService.getPendingCount(),
            userService.getAllUsers()
        ]);

        // Fetch all project counts in parallel
        const projectCounts = await Promise.all(
            users.map(user => projectService.getUserProjects(user.system_username))
        );
        const totalProjects = projectCounts.reduce((sum, projects) => sum + projects.length, 0);

        res.render('admin/index', {
            title: 'Admin Area',
            stats: {
                users: userCount,
                admins: adminCount,
                projects: totalProjects,
                pending: pendingCount
            }
        });
    } catch (error) {
        logger.error('Error in admin dashboard', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/dashboard');
    }
});

// Show pending registrations
router.get('/pending', async (req, res) => {
    try {
        const pendingUsers = await userService.getPendingUsers();

        res.render('admin/pending', {
            title: 'Pending Registrations',
            pendingUsers
        });
    } catch (error) {
        logger.error('Error loading pending registrations', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

// Approve user
router.post('/users/:id/approve', async (req, res) => {
    try {
        const user = await userService.approveUser(req.params.id);

        if (user) {
            req.flash('success', req.t('admin:flash.userApproved', { username: user.username }));
        } else {
            req.flash('error', req.t('admin:errors.userNotFound'));
        }

        res.redirect('/admin/pending');
    } catch (error) {
        logger.error('Error approving user', { error: error.message });
        req.flash('error', error.message);
        res.redirect('/admin/pending');
    }
});

// Reject user registration
router.post('/users/:id/reject', async (req, res) => {
    try {
        await userService.rejectUser(req.params.id);
        req.flash('success', req.t('admin:flash.userRejected', { username: '' }));
        res.redirect('/admin/pending');
    } catch (error) {
        logger.error('Error rejecting user', { error: error.message });
        req.flash('error', error.message);
        res.redirect('/admin/pending');
    }
});

// User management - List
router.get('/users', async (req, res) => {
    try {
        const users = await userService.getAllUsers();

        // Count projects per user in parallel
        const projectCounts = await Promise.all(
            users.map(user => projectService.getUserProjects(user.system_username))
        );

        users.forEach((user, index) => {
            user.projectCount = projectCounts[index].length;
        });

        res.render('admin/users', {
            title: 'User Management',
            users
        });
    } catch (error) {
        logger.error('Error loading users', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

// Create new user - Form
router.get('/users/create', (req, res) => {
    res.render('admin/users-create', {
        title: 'New User'
    });
});

// Create new user - Processing
router.post('/users', async (req, res) => {
    try {
        const { username, password, system_username, is_admin } = req.body;

        // Validation
        if (!username || !password || !system_username) {
            req.flash('error', req.t('common:validation.required'));
            return res.redirect('/admin/users/create');
        }

        if (!/^[a-z0-9_-]+$/.test(username)) {
            req.flash('error', req.t('common:validation.lowercaseOnly'));
            return res.redirect('/admin/users/create');
        }

        if (!/^[a-z0-9_-]+$/.test(system_username)) {
            req.flash('error', req.t('common:validation.lowercaseOnly'));
            return res.redirect('/admin/users/create');
        }

        // Check if user exists
        if (await userService.existsUsernameOrSystemUsername(username, system_username)) {
            req.flash('error', req.t('auth:errors.usernameExists'));
            return res.redirect('/admin/users/create');
        }

        // Admin-created users are automatically approved
        await userService.createUser(username, password, system_username, is_admin === 'on', true);

        req.flash('success', req.t('admin:flash.userCreated', { username }));
        res.redirect('/admin/users');
    } catch (error) {
        logger.error('Error creating user', { error: error.message });
        req.flash('error', req.t('common:errors.createError'));
        res.redirect('/admin/users/create');
    }
});

// Edit user - Form
router.get('/users/:id/edit', async (req, res) => {
    try {
        const editUser = await userService.getUserById(req.params.id);

        if (!editUser) {
            req.flash('error', req.t('admin:errors.userNotFound'));
            return res.redirect('/admin/users');
        }

        res.render('admin/users-edit', {
            title: 'Edit User',
            editUser
        });
    } catch (error) {
        logger.error('Error loading user', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin/users');
    }
});

// Edit user - Processing
router.put('/users/:id', async (req, res) => {
    try {
        const { username, password, system_username, is_admin } = req.body;
        const userId = req.params.id;

        // Validation
        if (!username || !system_username) {
            req.flash('error', req.t('common:validation.required'));
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        // Check if username/system username is already in use
        if (await userService.existsUsernameOrSystemUsername(username, system_username, userId)) {
            req.flash('error', req.t('auth:errors.usernameExists'));
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        await userService.updateUser(userId, {
            username,
            password: password || null,
            systemUsername: system_username,
            isAdmin: is_admin === 'on'
        });

        req.flash('success', req.t('admin:flash.userUpdated', { username }));
        res.redirect('/admin/users');
    } catch (error) {
        logger.error('Error updating user', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/admin/users/${req.params.id}/edit`);
    }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;

        // Cannot delete own account
        if (parseInt(userId) === req.session.user.id) {
            req.flash('error', req.t('admin:errors.cannotDeleteSelf'));
            return res.redirect('/admin/users');
        }

        // Check if this is the last admin
        if (await userService.isLastAdmin(userId)) {
            req.flash('error', req.t('admin:errors.cannotDeleteLastAdmin'));
            return res.redirect('/admin/users');
        }

        await userService.deleteUser(userId);

        req.flash('success', req.t('admin:flash.userDeleted', { username: '' }));
        res.redirect('/admin/users');
    } catch (error) {
        logger.error('Error deleting user', { error: error.message });
        req.flash('error', error.message);
        res.redirect('/admin/users');
    }
});

// Show all projects of all users
router.get('/projects', async (req, res) => {
    try {
        const users = await userService.getAllUsers();

        // Fetch all projects in parallel
        const projectsPerUser = await Promise.all(
            users.map(user => projectService.getUserProjects(user.system_username))
        );

        // Merge projects with owner info
        const allProjects = users.flatMap((user, index) =>
            projectsPerUser[index].map(project => ({
                ...project,
                ownerUsername: user.username,
                ownerSystemUsername: user.system_username
            }))
        );

        res.render('admin/projects', {
            title: 'All Projects',
            projects: allProjects
        });
    } catch (error) {
        logger.error('Error loading projects', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

// ============================================
// System-Logs
// ============================================

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
router.get('/logs', async (req, res) => {
    try {
        const logType = req.query.type || 'combined'; // combined or error
        const levelFilter = req.query.level || 'all'; // all, error, warn, info
        const limit = Math.min(parseInt(req.query.limit) || 200, 1000);

        const logFile = logType === 'error' ? 'error.log' : 'combined.log';
        const logPath = path.join(LOG_DIR, logFile);

        let logs = [];
        let error = null;

        try {
            const lines = await readLastLines(logPath, limit * 2); // Mehr lesen für Filter
            logs = lines
                .map(parseLogLine)
                .filter(log => {
                    if (levelFilter === 'all') return true;
                    return log.level === levelFilter;
                })
                .slice(-limit)
                .reverse(); // Neueste zuerst
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
router.get('/logs/api', async (req, res) => {
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

// ============================================
// Deployment-Historie
// ============================================

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
