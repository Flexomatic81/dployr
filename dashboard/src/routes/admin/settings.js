/**
 * Admin Settings Routes
 * Handles Email, NPM, and Security configuration
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const proxyService = require('../../services/proxy');
const emailService = require('../../services/email');
const userService = require('../../services/user');
const { logger } = require('../../config/logger');
const pool = require('../../config/database');

const ENV_PATH = '/app/.env';
const SETUP_MARKER_PATH = '/app/infrastructure/.setup-complete';

// ============================================
// Helper Functions
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
router.get('/email', async (req, res) => {
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
router.post('/email', async (req, res) => {
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

        // Update process.env so changes take effect immediately
        process.env.EMAIL_ENABLED = envVars.EMAIL_ENABLED;
        process.env.EMAIL_HOST = envVars.EMAIL_HOST || '';
        process.env.EMAIL_PORT = envVars.EMAIL_PORT || '587';
        process.env.EMAIL_USER = envVars.EMAIL_USER || '';
        if (envVars.EMAIL_PASSWORD) {
            process.env.EMAIL_PASSWORD = envVars.EMAIL_PASSWORD;
        }
        process.env.EMAIL_SECURE = envVars.EMAIL_SECURE;
        process.env.EMAIL_FROM = envVars.EMAIL_FROM || '';

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
router.post('/email/test', async (req, res) => {
    logger.info('Testing email connection...');
    try {
        const result = await emailService.testConnection();
        logger.info('Email connection test result', { result });
        if (result.success) {
            res.json({ success: true, message: req.t('admin:email.connectionSuccess') });
        } else {
            res.json({ success: false, error: result.error });
        }
    } catch (error) {
        logger.error('Email connection test error', { error: error.message });
        res.json({ success: false, error: error.message });
    }
});

// Send test email
router.post('/email/send-test', async (req, res) => {
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
router.get('/npm', async (req, res) => {
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
router.post('/npm', async (req, res) => {
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
router.post('/npm/test', async (req, res) => {
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
router.get('/npm/status', async (req, res) => {
    try {
        const status = await proxyService.getContainerStatus();
        res.json({ success: true, ...status });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Start NPM container
router.post('/npm/start', async (req, res) => {
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
router.post('/npm/stop', async (req, res) => {
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
router.post('/npm/restart', async (req, res) => {
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
router.post('/npm/recreate', async (req, res) => {
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
router.post('/npm/initialize', async (req, res) => {
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
router.get('/npm/logs', async (req, res) => {
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
router.post('/npm/dashboard-domain', async (req, res) => {
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
router.delete('/npm/dashboard-domain', async (req, res) => {
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
router.get('/npm/operation-logs', async (req, res) => {
    try {
        const lines = parseInt(req.query.lines) || 50;

        const logFile = path.join(__dirname, '..', '..', '..', 'logs', 'combined.log');

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

// ============================================
// Security Settings
// ============================================

// Show Security settings
router.get('/security', async (req, res) => {
    try {
        const envVars = await readEnvFile();

        // Get 2FA status for all users
        const [users] = await pool.query(`
            SELECT id, username, is_admin, totp_enabled
            FROM dashboard_users
            WHERE approved = TRUE
            ORDER BY username
        `);

        const usersWithout2fa = users.filter(u => !u.totp_enabled && !u.is_admin);
        const usersWith2fa = users.filter(u => u.totp_enabled);

        res.render('admin/settings-security', {
            title: req.t('admin:security.title'),
            security: {
                require2fa: envVars.REQUIRE_2FA === 'true'
            },
            usersWithout2fa,
            usersWith2fa
        });
    } catch (error) {
        logger.error('Error loading security settings', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

// Save Security settings
router.post('/security', async (req, res) => {
    try {
        const { require_2fa } = req.body;

        const envVars = await readEnvFile();
        envVars.REQUIRE_2FA = require_2fa === 'on' ? 'true' : 'false';

        await writeEnvFile(envVars);

        // Update process.env so changes take effect immediately
        process.env.REQUIRE_2FA = envVars.REQUIRE_2FA;

        logger.info('Security settings updated', {
            require2fa: require_2fa === 'on',
            userId: req.session.user.id
        });

        req.flash('success', req.t('admin:security.saved'));
        res.redirect('/admin/settings/security');
    } catch (error) {
        logger.error('Error saving security settings', { error: error.message });
        req.flash('error', req.t('common:errors.saveError'));
        res.redirect('/admin/settings/security');
    }
});

module.exports = router;
