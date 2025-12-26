const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const Docker = require('dockerode');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const SETUP_MARKER_PATH = '/app/infrastructure/.setup-complete';

// Prüfen ob Setup bereits abgeschlossen
async function isSetupComplete() {
    try {
        // Prüfen ob Setup-Marker existiert
        await fs.access(SETUP_MARKER_PATH);
        return true;
    } catch {
        return false;
    }
}

// Setup-Status API
router.get('/status', async (req, res) => {
    const complete = await isSetupComplete();
    res.json({
        setupComplete: complete,
        dockerAvailable: await checkDocker(),
        infrastructureRunning: await isInfrastructureRunning()
    });
});

// Setup-Wizard Seite
router.get('/', async (req, res) => {
    const complete = await isSetupComplete();

    if (complete) {
        return res.redirect('/login');
    }

    // Aktuelle Server-IP ermitteln
    const serverIp = req.hostname || 'localhost';

    res.render('setup/wizard', {
        title: 'Setup-Wizard',
        layout: 'setup-layout',
        serverIp,
        step: 1
    });
});

// Setup durchführen
router.post('/run', async (req, res) => {
    const { server_ip, admin_username, admin_password, system_username, mysql_root_password } = req.body;

    try {
        const steps = [];

        // Schritt 1: Docker Network erstellen
        steps.push({ step: 'network', status: 'running', message: 'Erstelle Docker-Netzwerk...' });
        await createDockerNetwork();
        steps[0].status = 'done';

        // Schritt 2: Warten auf MariaDB (läuft bereits via docker-compose)
        steps.push({ step: 'wait_db', status: 'running', message: 'Warte auf Datenbank...' });
        await waitForMariaDB(mysql_root_password);
        steps[1].status = 'done';

        // Schritt 3: Dashboard-Datenbank erstellen
        steps.push({ step: 'dashboard_db', status: 'running', message: 'Erstelle Dashboard-Datenbank...' });
        await createDashboardDatabase(mysql_root_password);
        steps[2].status = 'done';

        // Schritt 4: Admin-User erstellen
        steps.push({ step: 'admin', status: 'running', message: 'Erstelle Admin-Benutzer...' });
        await createAdminUser(admin_username, admin_password, system_username);
        steps[3].status = 'done';

        // Schritt 5: Setup als abgeschlossen markieren
        await markSetupComplete(server_ip, system_username);

        res.json({ success: true, steps });
    } catch (error) {
        console.error('Setup-Fehler:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Hilfsfunktionen
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

async function markSetupComplete(serverIp, defaultUser) {
    // Setup-Marker mit Metadaten erstellen
    const markerContent = JSON.stringify({
        completedAt: new Date().toISOString(),
        serverIp,
        defaultUser
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
    throw new Error('MariaDB nicht erreichbar nach 60 Sekunden');
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
        throw new Error(stderr || 'Datenbankfehler');
    }
}

async function createAdminUser(username, password, systemUsername) {
    const { pool, initDatabase } = require('../config/database');

    // Tabellen erstellen falls nicht vorhanden
    await initDatabase();

    // Passwort hashen
    const passwordHash = await bcrypt.hash(password, 12);

    // Admin-User erstellen (is_admin und approved auf TRUE)
    await pool.execute(
        `INSERT INTO dashboard_users (username, password_hash, system_username, is_admin, approved)
         VALUES (?, ?, ?, TRUE, TRUE)
         ON DUPLICATE KEY UPDATE password_hash = ?, is_admin = TRUE, approved = TRUE`,
        [username, passwordHash, systemUsername, passwordHash]
    );
}

module.exports = router;
module.exports.isSetupComplete = isSetupComplete;
