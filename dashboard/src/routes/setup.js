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

// Execute setup with Server-Sent Events for real-time progress
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

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Helper to send SSE events
    const sendEvent = (type, data) => {
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Helper to send step progress
    const sendStep = (step, status, message) => {
        sendEvent('step', { step, status, message });
    };

    try {
        // Step 1: Create Docker network
        sendStep('network', 'running');
        await createDockerNetwork();
        sendStep('network', 'done');

        // Step 2: Wait for MariaDB (already running via docker-compose)
        sendStep('wait_db', 'running');
        await waitForMariaDB(mysqlRootPassword);
        sendStep('wait_db', 'done');

        // Step 3: Create dashboard database
        sendStep('dashboard_db', 'running');
        await createDashboardDatabase(mysqlRootPassword);
        sendStep('dashboard_db', 'done');

        // Step 4: Create admin user with selected language
        const selectedLanguage = language || req.session.language || 'de';
        sendStep('admin', 'running');
        await createAdminUser(admin_username, admin_password, system_username, selectedLanguage);
        sendStep('admin', 'done');

        // Step 5: Configure NPM if enabled
        if (npm_enabled && npm_email && npm_password) {
            sendStep('npm', 'running');
            await configureNpm(npm_email, npm_password);
            sendStep('npm', 'done');

            // Step 6: Configure dashboard access via NPM
            const isDomain = server_ip && !isIpAddress(server_ip);
            if (isDomain) {
                sendStep('dashboard_domain', 'running');
                await configureDashboardDomain(server_ip);
                sendStep('dashboard_domain', 'done');
            } else if (server_ip) {
                // Configure IP-based access (dashboard on port 80, no SSL)
                sendStep('dashboard_ip', 'running');
                await configureIpBasedAccess(server_ip);
                sendStep('dashboard_ip', 'done');
            }
        }

        // Final: Mark setup as complete (include selected language and NPM status)
        await markSetupComplete(server_ip, system_username, selectedLanguage, npm_enabled);

        // Determine the dashboard URL based on configuration
        let dashboardUrl = '/login';
        if (npm_enabled && server_ip) {
            const isDomain = !isIpAddress(server_ip);
            if (isDomain) {
                // Domain with SSL
                dashboardUrl = `https://${server_ip}/login`;
            } else {
                // IP with NPM (port 80)
                dashboardUrl = `http://${server_ip}/login`;
            }
        }

        sendEvent('complete', { success: true, dashboardUrl });
        res.end();
    } catch (error) {
        logger.error('Setup error', { error: error.message });
        sendEvent('error', { success: false, error: error.message });
        res.end();
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

        // Also update process.env so proxyService.isEnabled() works immediately
        process.env.NPM_ENABLED = 'true';
        process.env.NPM_API_EMAIL = email;
        process.env.NPM_API_PASSWORD = password;

        logger.info('NPM configuration saved', { email });

        // Start NPM container
        await startNpmContainer();
    } catch (error) {
        logger.error('Failed to configure NPM', { error: error.message });
        throw new Error('Failed to save NPM configuration');
    }
}

/**
 * Reset and start NPM container with fresh database
 * NPM only reads INITIAL_ADMIN_* env vars on first database creation,
 * so we need to remove the data volume to ensure new credentials are used
 */
async function startNpmContainer() {
    try {
        const container = docker.getContainer('dployr-npm');

        // Try to stop and remove NPM container first (to reset its database)
        try {
            await container.stop();
            logger.info('NPM container stopped for reset');
        } catch (stopErr) {
            // Container might not be running - ignore
        }

        try {
            await container.remove();
            logger.info('NPM container removed for reset');
        } catch (removeErr) {
            // Container might not exist - ignore
        }

        // Remove NPM data volume to force fresh initialization with new credentials
        // This is necessary because NPM stores credentials in SQLite on first start
        try {
            const npmDataVolume = docker.getVolume('dployr-npm-data');
            await npmDataVolume.remove();
            logger.info('NPM data volume removed for fresh initialization');
        } catch (volErr) {
            // Volume might not exist - ignore
        }

        // Create NPM container via Docker API
        // We need to replicate the docker-compose.yml settings
        const npmEmail = process.env.NPM_API_EMAIL || '';
        const npmPassword = process.env.NPM_API_PASSWORD || '';
        const npmHttpPort = process.env.NPM_HTTP_PORT || '80';
        const npmHttpsPort = process.env.NPM_HTTPS_PORT || '443';
        const npmAdminPort = process.env.NPM_ADMIN_PORT || '81';

        try {
            const newContainer = await docker.createContainer({
                Image: 'jc21/nginx-proxy-manager:latest',
                name: 'dployr-npm',
                Env: [
                    'DISABLE_IPV6=true',
                    `INITIAL_ADMIN_EMAIL=${npmEmail}`,
                    `INITIAL_ADMIN_PASSWORD=${npmPassword}`
                ],
                Labels: {
                    // Add docker-compose labels so container is managed by docker compose
                    'com.docker.compose.project': 'dployr',
                    'com.docker.compose.service': 'npm',
                    'com.docker.compose.container-number': '1',
                    'com.docker.compose.project.working_dir': '/opt/dployr',
                    'com.docker.compose.project.config_files': '/opt/dployr/docker-compose.yml'
                },
                HostConfig: {
                    RestartPolicy: { Name: 'unless-stopped' },
                    PortBindings: {
                        '80/tcp': [{ HostPort: npmHttpPort }],
                        '443/tcp': [{ HostPort: npmHttpsPort }],
                        '81/tcp': [{ HostPort: npmAdminPort }]
                    },
                    Binds: [
                        'dployr-npm-data:/data',
                        'dployr-npm-letsencrypt:/etc/letsencrypt'
                    ],
                    NetworkMode: 'dployr-network'
                },
                NetworkingConfig: {
                    EndpointsConfig: {
                        'dployr-network': {}
                    }
                }
            });

            await newContainer.start();
            logger.info('NPM container created and started via Docker API');
        } catch (createErr) {
            logger.error('Failed to create NPM container via Docker API', { error: createErr.message });
            // Don't throw - setup should succeed even if NPM doesn't start
        }
    } catch (error) {
        logger.error('Failed to start NPM container', { error: error.message });
        // Don't throw - setup should succeed even if NPM doesn't start
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
 * Wait for NPM API to be fully ready and accepting authentication
 * This is more thorough than proxyService.waitForApi() because it actually
 * tests authentication, not just API availability
 */
async function waitForNpmAuth(maxAttempts = 60, delayMs = 2000) {
    const axios = require('axios');
    const npmApiUrl = process.env.NPM_API_URL || 'http://dployr-npm:81/api';
    const email = process.env.NPM_API_EMAIL;
    const password = process.env.NPM_API_PASSWORD;

    for (let i = 0; i < maxAttempts; i++) {
        try {
            // Try to authenticate - this is the real test
            const response = await axios.post(`${npmApiUrl}/tokens`, {
                identity: email,
                secret: password
            }, { timeout: 5000 });

            if (response.data && response.data.token) {
                logger.info('NPM API ready and authentication successful', { attempt: i + 1 });
                return true;
            }
        } catch (error) {
            // 502 means NPM is starting but not ready yet
            // Connection refused means container is starting
            logger.debug('Waiting for NPM API authentication...', {
                attempt: i + 1,
                status: error.response?.status,
                error: error.message
            });
        }
        await new Promise(r => setTimeout(r, delayMs));
    }
    logger.warn('NPM API authentication not ready after maximum attempts');
    return false;
}

/**
 * Configure dashboard domain with SSL in NPM
 * Called when a domain (not IP) is provided during setup
 */
async function configureDashboardDomain(domain) {
    try {
        // Wait for NPM API to be fully ready (including authentication)
        // NPM needs time after container start to initialize its database
        const isReady = await waitForNpmAuth(60, 2000);
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
 * Configure proxy host for IP-based access (no SSL)
 * Makes dashboard accessible via http://IP (port 80)
 * @param {string} serverIp - The server IP address
 */
async function configureIpBasedAccess(serverIp) {
    try {
        // Wait for NPM API to be fully ready (including authentication)
        const isReady = await waitForNpmAuth(60, 2000);
        if (!isReady) {
            logger.warn('NPM API not ready for IP-based access setup');
            return;
        }

        // Create default host as fallback
        await proxyService.ensureDefaultHost();

        // Create IP-based proxy host for dashboard
        const result = await proxyService.createDashboardIpProxyHost(serverIp);
        if (result.success) {
            logger.info('IP-based dashboard access configured', { serverIp });
        } else {
            logger.warn('Failed to configure IP-based dashboard access', { serverIp, error: result.error });
        }
    } catch (error) {
        logger.error('Error configuring IP-based access', { error: error.message });
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
