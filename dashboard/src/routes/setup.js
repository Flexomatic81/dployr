const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const Docker = require('dockerode');
const { logger } = require('../config/logger');

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
    const { server_ip, admin_username, admin_password, system_username, mysql_root_password, language } = req.body;

    try {
        const steps = [];

        // Step 1: Create Docker network
        steps.push({ step: 'network', status: 'running', message: 'Creating Docker network...' });
        await createDockerNetwork();
        steps[0].status = 'done';

        // Step 2: Wait for MariaDB (already running via docker-compose)
        steps.push({ step: 'wait_db', status: 'running', message: 'Waiting for database...' });
        await waitForMariaDB(mysql_root_password);
        steps[1].status = 'done';

        // Step 3: Create dashboard database
        steps.push({ step: 'dashboard_db', status: 'running', message: 'Creating dashboard database...' });
        await createDashboardDatabase(mysql_root_password);
        steps[2].status = 'done';

        // Step 4: Create admin user
        steps.push({ step: 'admin', status: 'running', message: 'Creating admin user...' });
        await createAdminUser(admin_username, admin_password, system_username);
        steps[3].status = 'done';

        // Step 5: Mark setup as complete (include selected language)
        const selectedLanguage = language || req.session.language || 'de';
        await markSetupComplete(server_ip, system_username, selectedLanguage);

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

async function markSetupComplete(serverIp, defaultUser, language = 'de') {
    // Create setup marker with metadata including default language
    const markerContent = JSON.stringify({
        completedAt: new Date().toISOString(),
        serverIp,
        defaultUser,
        defaultLanguage: language
    }, null, 2);
    await fs.writeFile(SETUP_MARKER_PATH, markerContent);
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

async function createAdminUser(username, password, systemUsername) {
    const { pool, initDatabase } = require('../config/database');

    // Create tables if they don't exist
    await initDatabase();

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create admin user (is_admin and approved set to TRUE)
    await pool.execute(
        `INSERT INTO dashboard_users (username, password_hash, system_username, is_admin, approved)
         VALUES (?, ?, ?, TRUE, TRUE)
         ON DUPLICATE KEY UPDATE password_hash = ?, is_admin = TRUE, approved = TRUE`,
        [username, passwordHash, systemUsername, passwordHash]
    );
}

module.exports = router;
module.exports.isSetupComplete = isSetupComplete;
