const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { createReadStream } = require('fs');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const userService = require('../services/user');
const projectService = require('../services/project');
const proxyService = require('../services/proxy');
const emailService = require('../services/email');
const { logger } = require('../config/logger');
const { pool } = require('../config/database');

const LOG_DIR = process.env.LOG_DIR || '/app/logs';
const ENV_PATH = '/app/.env';
const SETUP_MARKER_PATH = '/app/infrastructure/.setup-complete';

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
            // Send approval notification email if enabled and user has email
            const fullUser = await userService.getFullUserById(user.id);
            if (emailService.isEnabled() && fullUser.email) {
                const language = await userService.getUserLanguage(user.id);
                await emailService.sendApprovalEmail(fullUser.email, user.username, language);
                logger.info('Approval email sent', { userId: user.id, email: fullUser.email });
            }

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
        const { username, password, system_username, is_admin, email } = req.body;

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

        // Check if email is already in use
        if (email && await userService.emailExists(email)) {
            req.flash('error', req.t('auth:errors.emailExists'));
            return res.redirect('/admin/users/create');
        }

        // Admin-created users are automatically approved (email is optional)
        await userService.createUser(username, password, system_username, is_admin === 'on', true, email || null);

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
        // Use getFullUserById to include email fields
        const editUser = await userService.getFullUserById(req.params.id);

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
        const { username, password, system_username, is_admin, email } = req.body;
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

        // Check if email is already in use by another user
        if (email && await userService.emailExists(email, userId)) {
            req.flash('error', req.t('auth:errors.emailExists'));
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        await userService.updateUser(userId, {
            username,
            password: password || null,
            systemUsername: system_username,
            isAdmin: is_admin === 'on',
            email: email || null
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
            const lines = await readLastLines(logPath, limit * 2); // Read more lines for filtering
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

// ============================================
// NPM Settings
// ============================================

// Helper function: Read .env file
async function readEnvFile() {
    try {
        const content = await fs.readFile(ENV_PATH, 'utf-8');
        const envVars = {};
        content.split('\n').forEach(line => {
            const match = line.match(/^([^#=]+)=(.*)$/);
            if (match) {
                envVars[match[1].trim()] = match[2].trim();
            }
        });
        return envVars;
    } catch {
        return {};
    }
}

// Helper function: Write .env file
async function writeEnvFile(envVars) {
    const content = Object.entries(envVars)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    await fs.writeFile(ENV_PATH, content + '\n');
}

// Helper function: Read setup marker
async function readSetupMarker() {
    try {
        const content = await fs.readFile(SETUP_MARKER_PATH, 'utf-8');
        return JSON.parse(content);
    } catch {
        return {};
    }
}

// Helper function: Update setup marker
async function updateSetupMarker(updates) {
    const current = await readSetupMarker();
    const updated = { ...current, ...updates };
    await fs.writeFile(SETUP_MARKER_PATH, JSON.stringify(updated, null, 2));
}

// ============================================
// Email Settings
// ============================================

// Show Email settings
router.get('/settings/email', async (req, res) => {
    try {
        const envVars = await readEnvFile();

        res.render('admin/settings-email', {
            title: req.t('admin:email.title'),
            email: {
                enabled: envVars.EMAIL_ENABLED === 'true',
                host: envVars.EMAIL_HOST || '',
                port: envVars.EMAIL_PORT || '587',
                user: envVars.EMAIL_USER || '',
                hasPassword: !!envVars.EMAIL_PASSWORD,
                secure: envVars.EMAIL_SECURE === 'true',
                from: envVars.EMAIL_FROM || ''
            }
        });
    } catch (error) {
        logger.error('Error loading email settings', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

// Save Email settings
router.post('/settings/email', async (req, res) => {
    try {
        const { email_enabled, email_host, email_port, email_user, email_password, email_secure, email_from } = req.body;

        const envVars = await readEnvFile();

        envVars.EMAIL_ENABLED = email_enabled === 'on' ? 'true' : 'false';

        if (email_host) envVars.EMAIL_HOST = email_host;
        if (email_port) envVars.EMAIL_PORT = email_port;
        if (email_user) envVars.EMAIL_USER = email_user;
        if (email_password && email_password.trim()) {
            envVars.EMAIL_PASSWORD = email_password;
        }
        envVars.EMAIL_SECURE = email_secure === 'on' ? 'true' : 'false';
        if (email_from) envVars.EMAIL_FROM = email_from;

        await writeEnvFile(envVars);

        // Reset the email transporter to pick up new config
        emailService.resetTransporter();

        logger.info('Email settings updated', { enabled: email_enabled === 'on' });

        req.flash('success', req.t('admin:email.saved'));
        res.redirect('/admin/settings/email');
    } catch (error) {
        logger.error('Error saving email settings', { error: error.message });
        req.flash('error', req.t('common:errors.saveError'));
        res.redirect('/admin/settings/email');
    }
});

// Test email connection
router.post('/settings/email/test', async (req, res) => {
    try {
        const result = await emailService.testConnection();
        if (result.success) {
            res.json({ success: true, message: req.t('admin:email.connectionSuccess') });
        } else {
            res.json({ success: false, error: result.error });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Send test email
router.post('/settings/email/send-test', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.json({ success: false, error: req.t('admin:email.noEmailProvided') });
        }

        const language = await userService.getUserLanguage(req.session.user.id);
        const result = await emailService.sendTestEmail(email, language);

        if (result.success) {
            res.json({ success: true, message: req.t('admin:email.testEmailSent') });
        } else {
            res.json({ success: false, error: result.error || result.reason });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ============================================
// NPM Settings
// ============================================

// Show NPM settings
router.get('/settings/npm', async (req, res) => {
    try {
        const envVars = await readEnvFile();
        const setupMarker = await readSetupMarker();
        const npmStatus = await proxyService.isEnabled();

        res.render('admin/settings-npm', {
            title: req.t('admin:npm.title'),
            npm: {
                enabled: envVars.NPM_ENABLED === 'true',
                email: envVars.NPM_API_EMAIL || '',
                // Do not send password to frontend
                hasPassword: !!envVars.NPM_API_PASSWORD,
                httpPort: envVars.NPM_HTTP_PORT || '80',
                httpsPort: envVars.NPM_HTTPS_PORT || '443',
                adminPort: envVars.NPM_ADMIN_PORT || '81',
                dashboardDomain: envVars.NPM_DASHBOARD_DOMAIN || ''
            },
            setupMarker,
            npmStatus
        });
    } catch (error) {
        logger.error('Error loading NPM settings', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

// Save NPM settings
router.post('/settings/npm', async (req, res) => {
    try {
        const { npm_enabled, npm_email, npm_password, npm_http_port, npm_https_port, npm_admin_port } = req.body;

        // Read current env vars
        const envVars = await readEnvFile();

        // Update NPM settings
        envVars.NPM_ENABLED = npm_enabled === 'on' ? 'true' : 'false';

        if (npm_email) {
            envVars.NPM_API_EMAIL = npm_email;
        }

        // Only update password if provided (not empty)
        if (npm_password && npm_password.trim()) {
            if (npm_password.length < 8) {
                req.flash('error', req.t('admin:npm.passwordLength'));
                return res.redirect('/admin/settings/npm');
            }
            envVars.NPM_API_PASSWORD = npm_password;
        }

        // Update ports if provided
        if (npm_http_port) {
            envVars.NPM_HTTP_PORT = npm_http_port;
        }
        if (npm_https_port) {
            envVars.NPM_HTTPS_PORT = npm_https_port;
        }
        if (npm_admin_port) {
            envVars.NPM_ADMIN_PORT = npm_admin_port;
        }

        // Write updated env file
        await writeEnvFile(envVars);

        // Update setup marker
        await updateSetupMarker({ npmEnabled: npm_enabled === 'on' });

        logger.info('NPM settings updated', { email: npm_email, enabled: npm_enabled === 'on' });

        req.flash('success', req.t('admin:npm.saved'));
        res.redirect('/admin/settings/npm');
    } catch (error) {
        logger.error('Error saving NPM settings', { error: error.message });
        req.flash('error', req.t('common:errors.saveError'));
        res.redirect('/admin/settings/npm');
    }
});

// Test NPM connection
router.post('/settings/npm/test', async (req, res) => {
    try {
        const isEnabled = await proxyService.isEnabled();
        if (!isEnabled) {
            return res.json({ success: false, error: req.t('admin:npm.notEnabled') });
        }

        // Try to get token (this tests the connection)
        const token = await proxyService.getToken();
        if (token) {
            res.json({ success: true, message: req.t('admin:npm.connectionSuccess') });
        } else {
            res.json({ success: false, error: req.t('admin:npm.connectionFailed') });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Get NPM container status
router.get('/settings/npm/status', async (req, res) => {
    try {
        const status = await proxyService.getContainerStatus();
        res.json({ success: true, ...status });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Start NPM container
router.post('/settings/npm/start', async (req, res) => {
    try {
        const result = await proxyService.startContainer();
        if (result.success) {
            logger.info('NPM container started by admin', { userId: req.session.user.id });
            res.json({ success: true, message: req.t('admin:npm.containerStarted') });
        } else {
            res.json({ success: false, error: result.error });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Stop NPM container
router.post('/settings/npm/stop', async (req, res) => {
    try {
        const result = await proxyService.stopContainer();
        if (result.success) {
            logger.info('NPM container stopped by admin', { userId: req.session.user.id });
            res.json({ success: true, message: req.t('admin:npm.containerStopped') });
        } else {
            res.json({ success: false, error: result.error });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Restart NPM container
router.post('/settings/npm/restart', async (req, res) => {
    try {
        const result = await proxyService.restartContainer();
        if (result.success) {
            logger.info('NPM container restarted by admin', { userId: req.session.user.id });
            res.json({ success: true, message: req.t('admin:npm.containerRestarted') });
        } else {
            res.json({ success: false, error: result.error });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Recreate NPM container (delete data and restart fresh)
router.post('/settings/npm/recreate', async (req, res) => {
    try {
        const result = await proxyService.recreateContainer();
        if (result.success) {
            logger.info('NPM container recreated by admin', { userId: req.session.user.id });
            res.json({
                success: true,
                needsManualStart: result.needsManualStart,
                message: req.t('admin:npm.recreateSuccess')
            });
        } else {
            res.json({ success: false, error: result.error });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Initialize NPM credentials (change default credentials to configured ones)
router.post('/settings/npm/initialize', async (req, res) => {
    try {
        const email = process.env.NPM_API_EMAIL;
        const password = process.env.NPM_API_PASSWORD;

        if (!email || !password) {
            return res.json({
                success: false,
                error: req.t('admin:npm.credentialsRequired')
            });
        }

        // Wait for API to be ready (max 30 seconds)
        const apiReady = await proxyService.waitForApi(15, 2000);
        if (!apiReady) {
            return res.json({
                success: false,
                error: req.t('admin:npm.apiNotReady')
            });
        }

        const result = await proxyService.initializeCredentials(email, password);

        if (result.success) {
            logger.info('NPM credentials initialized by admin', { userId: req.session.user.id, email });
            res.json({
                success: true,
                message: result.alreadyInitialized
                    ? req.t('admin:npm.alreadyInitialized')
                    : req.t('admin:npm.initializeSuccess')
            });
        } else {
            res.json({ success: false, error: result.error });
        }
    } catch (error) {
        logger.error('Failed to initialize NPM credentials', { error: error.message });
        res.json({ success: false, error: error.message });
    }
});

// Get NPM container logs
router.get('/settings/npm/logs', async (req, res) => {
    try {
        const lines = parseInt(req.query.lines) || 50;
        const result = await proxyService.getContainerLogs(lines);
        if (result.success) {
            res.json({ success: true, logs: result.logs });
        } else {
            res.json({ success: false, error: result.error });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Configure dashboard domain (creates proxy host in NPM)
router.post('/settings/npm/dashboard-domain', async (req, res) => {
    try {
        const { domain, enableSsl } = req.body;

        // Validate domain format
        const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        if (!domain || !domainRegex.test(domain)) {
            return res.json({
                success: false,
                error: req.t('admin:npm.dashboardDomainInvalid')
            });
        }

        // Check if NPM is enabled
        const isEnabled = await proxyService.isEnabled();
        if (!isEnabled) {
            return res.json({
                success: false,
                error: req.t('admin:npm.notEnabled')
            });
        }

        // Create proxy host for dashboard container
        const withSsl = enableSsl === 'true' || enableSsl === true;
        const result = await proxyService.createDashboardProxyHost(domain, withSsl);

        if (result.success) {
            // Save domain to .env file
            const envVars = await readEnvFile();
            envVars.NPM_DASHBOARD_DOMAIN = domain;
            await writeEnvFile(envVars);

            logger.info('Dashboard domain configured', { domain, ssl: withSsl, userId: req.session.user.id });
            res.json({
                success: true,
                message: req.t('admin:npm.dashboardDomainSuccess', { domain })
            });
        } else {
            res.json({ success: false, error: result.error });
        }
    } catch (error) {
        logger.error('Failed to configure dashboard domain', { error: error.message });
        res.json({
            success: false,
            error: req.t('admin:npm.dashboardDomainError')
        });
    }
});

// Remove dashboard domain
router.delete('/settings/npm/dashboard-domain', async (req, res) => {
    try {
        const envVars = await readEnvFile();
        const domain = envVars.NPM_DASHBOARD_DOMAIN;

        if (!domain) {
            return res.json({ success: true });
        }

        // Delete proxy host from NPM
        await proxyService.deleteDashboardProxyHost(domain);

        // Remove from .env file
        delete envVars.NPM_DASHBOARD_DOMAIN;
        await writeEnvFile(envVars);

        logger.info('Dashboard domain removed', { domain, userId: req.session.user.id });
        res.json({
            success: true,
            message: req.t('admin:npm.dashboardDomainRemoved')
        });
    } catch (error) {
        logger.error('Failed to remove dashboard domain', { error: error.message });
        res.json({ success: false, error: error.message });
    }
});

// Get NPM operation logs from dashboard logs (proxy, certificate, domain operations)
router.get('/settings/npm/operation-logs', async (req, res) => {
    try {
        const fs = require('fs').promises;
        const path = require('path');
        const lines = parseInt(req.query.lines) || 50;

        const logFile = path.join(__dirname, '..', '..', 'logs', 'combined.log');

        try {
            const content = await fs.readFile(logFile, 'utf8');
            const allLines = content.split('\n').filter(line => line.trim());

            // Filter for NPM-related operations
            const npmKeywords = [
                'proxy host', 'Proxy host',
                'certificate', 'Certificate',
                'SSL', 'ssl',
                'Dashboard domain', 'dashboard domain',
                'NPM API', 'npm api',
                'domain configured', 'domain removed'
            ];

            const npmLines = allLines.filter(line => {
                return npmKeywords.some(keyword => line.includes(keyword));
            });

            // Get last N lines, newest first
            const recentLines = npmLines.slice(-lines).reverse();

            res.json({ success: true, logs: recentLines.join('\n') });
        } catch (readError) {
            if (readError.code === 'ENOENT') {
                res.json({ success: true, logs: '' });
            } else {
                throw readError;
            }
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

module.exports = router;
