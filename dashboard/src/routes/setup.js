const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const Docker = require('dockerode');
const { logger } = require('../config/logger');
const proxyService = require('../services/proxy');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const SETUP_MARKER_PATH = '/app/infrastructure/.setup-complete';

// Check if setup is already complete
async function isSetupComplete() {
    try {
        // Check if setup marker exists
        await fs.access(SETUP_MARKER_PATH);
        return true;
    } catch {
        return false;
    }
}

// Setup status API
router.get('/status', async (req, res) => {
    const complete = await isSetupComplete();
    res.json({
        setupComplete: complete,
        dockerAvailable: await checkDocker(),
        infrastructureRunning: await isInfrastructureRunning()
    });
});

// Set language for setup (before selecting language in wizard)
router.post('/language', (req, res) => {
    const { language } = req.body;
    if (['de', 'en'].includes(language)) {
        req.session.language = language;
        req.i18n.changeLanguage(language);
    }
    res.json({ success: true, language: req.session.language || 'de' });
});

// Setup wizard page
router.get('/', async (req, res) => {
    const complete = await isSetupComplete();

    if (complete) {
        return res.redirect('/login');
    }

    // Determine current server IP
    const serverIp = req.hostname || 'localhost';

    // Get current language from session or default to 'de'
    const currentLanguage = req.session.language || req.language || 'de';

    res.render('setup/wizard', {
        title: req.t('setup:title'),
        layout: 'setup-layout',
        serverIp,
        step: 1,
        currentLanguage
    });
});

// Execute setup
router.post('/run', async (req, res) => {
    const {
        server_ip,
        admin_username,
        admin_password,
        system_username,
        language,
        npm_enabled,
        npm_email,
        npm_password
    } = req.body;

    // Read MySQL root password from environment variable (set in .env)
    const mysqlRootPassword = process.env.MYSQL_ROOT_PASSWORD;
    if (!mysqlRootPassword) {
        return res.status(400).json({
            success: false,
            error: 'MYSQL_ROOT_PASSWORD not configured in .env file'
        });
    }

    try {
        const steps = [];

        // Step 1: Create Docker network
        steps.push({ step: 'network', status: 'running', message: 'Creating Docker network...' });
        await createDockerNetwork();
        steps[0].status = 'done';

        // Step 2: Wait for MariaDB (already running via docker-compose)
        steps.push({ step: 'wait_db', status: 'running', message: 'Waiting for database...' });
        await waitForMariaDB(mysqlRootPassword);
        steps[1].status = 'done';

        // Step 3: Create dashboard database
        steps.push({ step: 'dashboard_db', status: 'running', message: 'Creating dashboard database...' });
        await createDashboardDatabase(mysqlRootPassword);
        steps[2].status = 'done';

        // Step 4: Create admin user with selected language
        const selectedLanguage = language || req.session.language || 'de';
        steps.push({ step: 'admin', status: 'running', message: 'Creating admin user...' });
        await createAdminUser(admin_username, admin_password, system_username, selectedLanguage);
        steps[3].status = 'done';

        // Step 5: Configure NPM if enabled
        if (npm_enabled && npm_email && npm_password) {
            steps.push({ step: 'npm', status: 'running', message: 'Configuring Nginx Proxy Manager...' });
            await configureNpm(npm_email, npm_password);
            steps[steps.length - 1].status = 'done';

            // Step 6: Configure dashboard domain if a domain (not IP) was provided
            const isDomain = server_ip && !isIpAddress(server_ip);
            if (isDomain) {
                steps.push({ step: 'dashboard_domain', status: 'running', message: 'Configuring dashboard domain with SSL...' });
                await configureDashboardDomain(server_ip);
                steps[steps.length - 1].status = 'done';
            } else {
                // Just create default host for IP-based access
                steps.push({ step: 'default_host', status: 'running', message: 'Configuring default host...' });
                await configureDefaultHost();
                steps[steps.length - 1].status = 'done';
            }
        }

        // Final: Mark setup as complete (include selected language and NPM status)
        await markSetupComplete(server_ip, system_username, selectedLanguage, npm_enabled);

        res.json({ success: true, steps });
    } catch (error) {
        logger.error('Setup error', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Helper functions
async function checkDocker() {
    try {
        await docker.ping();
        return true;
    } catch {
        return false;
    }
}

async function isInfrastructureRunning() {
    try {
        const container = docker.getContainer('dployr-mariadb');
        const info = await container.inspect();
        return info.State.Running;
    } catch {
        return false;
    }
}

async function markSetupComplete(serverIp, defaultUser, language = 'de', npmEnabled = false) {
    // Create setup marker with metadata including default language and NPM status
    const markerContent = JSON.stringify({
        completedAt: new Date().toISOString(),
        serverIp,
        defaultUser,
        defaultLanguage: language,
        npmEnabled: npmEnabled || false
    }, null, 2);
    await fs.writeFile(SETUP_MARKER_PATH, markerContent);
}

async function configureNpm(email, password) {
    // Write NPM configuration to root .env file
    // This is read by docker-compose for environment variables
    const envPath = '/app/.env';

    try {
        // Read existing .env content
        let envContent = '';
        try {
            envContent = await fs.readFile(envPath, 'utf-8');
        } catch {
            // File doesn't exist, will create new
        }

        // Parse existing env vars
        const envLines = envContent.split('\n');
        const envVars = {};
        envLines.forEach(line => {
            const match = line.match(/^([^#=]+)=(.*)$/);
            if (match) {
                envVars[match[1].trim()] = match[2].trim();
            }
        });

        // Update NPM variables
        envVars['NPM_ENABLED'] = 'true';
        envVars['NPM_API_EMAIL'] = email;
        envVars['NPM_API_PASSWORD'] = password;

        // Rebuild .env content
        const newEnvContent = Object.entries(envVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        await fs.writeFile(envPath, newEnvContent + '\n');

        logger.info('NPM configuration saved', { email });

        // Start NPM container
        await startNpmContainer();
    } catch (error) {
        logger.error('Failed to configure NPM', { error: error.message });
        throw new Error('Failed to save NPM configuration');
    }
}

async function startNpmContainer() {
    try {
        const container = docker.getContainer('dployr-npm');
        await container.start();
        logger.info('NPM container started during setup');
    } catch (error) {
        // Container might already be running (304) or not exist
        if (error.statusCode === 304) {
            logger.info('NPM container already running');
        } else if (error.statusCode === 404) {
            logger.warn('NPM container not found - may need to run docker compose up first');
        } else {
            logger.error('Failed to start NPM container', { error: error.message });
            // Don't throw - setup should succeed even if NPM doesn't start
        }
    }
}

/**
 * Check if a string is an IP address (v4 or v6)
 */
function isIpAddress(str) {
    // IPv4 pattern
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6 pattern (simplified)
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    // localhost
    if (str === 'localhost') return true;

    return ipv4Pattern.test(str) || ipv6Pattern.test(str);
}

/**
 * Configure dashboard domain with SSL in NPM
 * Called when a domain (not IP) is provided during setup
 */
async function configureDashboardDomain(domain) {
    try {
        // Wait for NPM API to be ready
        const isReady = await proxyService.waitForApi(30, 2000);
        if (!isReady) {
            logger.warn('NPM API not ready for dashboard domain setup');
            return;
        }

        // First ensure default host exists (as fallback)
        await proxyService.ensureDefaultHost();

        // Create dashboard proxy host with SSL
        const result = await proxyService.createDashboardProxyHost(domain, true);

        if (result.success) {
            // Save domain to .env for future reference
            await saveDashboardDomainToEnv(domain);
            logger.info('Dashboard domain configured with SSL', { domain });
        } else {
            logger.warn('Failed to configure dashboard domain', { domain, error: result.error });
        }
    } catch (error) {
        logger.error('Error configuring dashboard domain', { domain, error: error.message });
        // Don't throw - setup should succeed even if domain config fails
    }
}

/**
 * Configure default host only (for IP-based access)
 */
async function configureDefaultHost() {
    try {
        // Wait for NPM API to be ready
        const isReady = await proxyService.waitForApi(30, 2000);
        if (!isReady) {
            logger.warn('NPM API not ready for default host setup');
            return;
        }

        const result = await proxyService.ensureDefaultHost();
        if (result.success) {
            logger.info('Default host configured for IP-based access');
        } else {
            logger.warn('Failed to configure default host', { error: result.error });
        }
    } catch (error) {
        logger.error('Error configuring default host', { error: error.message });
        // Don't throw - setup should succeed
    }
}

/**
 * Save dashboard domain to .env file
 */
async function saveDashboardDomainToEnv(domain) {
    const envPath = '/app/.env';

    try {
        let envContent = '';
        try {
            envContent = await fs.readFile(envPath, 'utf-8');
        } catch {
            // File doesn't exist
        }

        // Parse existing env vars
        const envLines = envContent.split('\n');
        const envVars = {};
        envLines.forEach(line => {
            const match = line.match(/^([^#=]+)=(.*)$/);
            if (match) {
                envVars[match[1].trim()] = match[2].trim();
            }
        });

        // Add dashboard domain
        envVars['NPM_DASHBOARD_DOMAIN'] = domain;

        // Rebuild .env content
        const newEnvContent = Object.entries(envVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        await fs.writeFile(envPath, newEnvContent + '\n');
    } catch (error) {
        logger.error('Failed to save dashboard domain to .env', { error: error.message });
    }
}

async function createDockerNetwork() {
    try {
        const networks = await docker.listNetworks({ filters: { name: ['dployr-network'] } });
        if (networks.length === 0) {
            await docker.createNetwork({ Name: 'dployr-network' });
        }
    } catch {
        // Network may already exist, ignore error
    }
}

async function waitForMariaDB(mysqlRootPassword, maxAttempts = 30) {
    const container = docker.getContainer('dployr-mariadb');

    for (let i = 0; i < maxAttempts; i++) {
        try {
            const exec = await container.exec({
                Cmd: ['mariadb', '-uroot', `-p${mysqlRootPassword}`, '-e', 'SELECT 1'],
                AttachStdout: true,
                AttachStderr: true
            });

            const stream = await exec.start({ hijack: true, stdin: false });

            // Wait for command to complete
            await new Promise((resolve, reject) => {
                stream.on('end', resolve);
                stream.on('error', reject);
                // Consume data to allow stream to end
                stream.on('data', () => {});
            });

            const inspection = await exec.inspect();
            if (inspection.ExitCode === 0) {
                return;
            }
        } catch {
            // Connection failed, wait and retry
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('MariaDB not reachable after 60 seconds');
}

async function createDashboardDatabase(mysqlRootPassword) {
    const dbPassword = process.env.DB_PASSWORD;
    const container = docker.getContainer('dployr-mariadb');

    const sql = `
        CREATE DATABASE IF NOT EXISTS dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        CREATE USER IF NOT EXISTS 'dashboard_user'@'%' IDENTIFIED BY '${dbPassword}';
        GRANT ALL PRIVILEGES ON dashboard.* TO 'dashboard_user'@'%';
        FLUSH PRIVILEGES;
    `;

    const exec = await container.exec({
        Cmd: ['mariadb', '-uroot', `-p${mysqlRootPassword}`, '-e', sql],
        AttachStdout: true,
        AttachStderr: true
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    // Collect stderr for error messages
    let stderr = '';
    await new Promise((resolve, reject) => {
        stream.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        stream.on('end', resolve);
        stream.on('error', reject);
    });

    const inspection = await exec.inspect();
    if (inspection.ExitCode !== 0) {
        throw new Error(stderr || 'Database error');
    }
}

async function createAdminUser(username, password, systemUsername, language = 'de') {
    const { pool, initDatabase } = require('../config/database');

    // Create tables if they don't exist
    await initDatabase();

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create admin user (is_admin and approved set to TRUE, with selected language)
    await pool.execute(
        `INSERT INTO dashboard_users (username, password_hash, system_username, is_admin, approved, language)
         VALUES (?, ?, ?, TRUE, TRUE, ?)
         ON DUPLICATE KEY UPDATE password_hash = ?, is_admin = TRUE, approved = TRUE, language = ?`,
        [username, passwordHash, systemUsername, language, passwordHash, language]
    );
}

module.exports = router;
module.exports.isSetupComplete = isSetupComplete;
