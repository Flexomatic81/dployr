const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const bcrypt = require('bcrypt');

const BASE_PATH = '/app';
const CONFIG_PATH = '/app/config.sh';
const INFRASTRUCTURE_PATH = '/app/infrastructure';

// Prüfen ob Setup bereits abgeschlossen
async function isSetupComplete() {
    try {
        // Prüfen ob config.sh existiert und Infrastruktur läuft
        await fs.access(CONFIG_PATH);

        // Prüfen ob MariaDB Container läuft
        return new Promise((resolve) => {
            exec('docker ps --filter "name=deployr-mariadb" --format "{{.Names}}"', (error, stdout) => {
                resolve(stdout.trim() === 'deployr-mariadb');
            });
        });
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
        configExists: await fileExists(CONFIG_PATH),
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

        // Schritt 1: Config erstellen
        steps.push({ step: 'config', status: 'running', message: 'Erstelle Konfiguration...' });
        await createConfig(server_ip, system_username);
        steps[0].status = 'done';

        // Schritt 2: Infrastructure .env erstellen
        steps.push({ step: 'infra_env', status: 'running', message: 'Erstelle Infrastruktur-Konfiguration...' });
        await createInfrastructureEnv(mysql_root_password);
        steps[1].status = 'done';

        // Schritt 3: Docker Network erstellen
        steps.push({ step: 'network', status: 'running', message: 'Erstelle Docker-Netzwerk...' });
        await createDockerNetwork();
        steps[2].status = 'done';

        // Schritt 4: Infrastruktur starten
        steps.push({ step: 'infrastructure', status: 'running', message: 'Starte MariaDB & phpMyAdmin...' });
        await startInfrastructure();
        steps[3].status = 'done';

        // Schritt 5: Warten auf MariaDB
        steps.push({ step: 'wait_db', status: 'running', message: 'Warte auf Datenbank...' });
        await waitForMariaDB(mysql_root_password);
        steps[4].status = 'done';

        // Schritt 6: Dashboard-Datenbank erstellen
        steps.push({ step: 'dashboard_db', status: 'running', message: 'Erstelle Dashboard-Datenbank...' });
        await createDashboardDatabase(mysql_root_password);
        steps[5].status = 'done';

        // Schritt 7: Admin-User erstellen
        steps.push({ step: 'admin', status: 'running', message: 'Erstelle Admin-Benutzer...' });
        await createAdminUser(admin_username, admin_password, system_username);
        steps[6].status = 'done';

        res.json({ success: true, steps });
    } catch (error) {
        console.error('Setup-Fehler:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Hilfsfunktionen
async function checkDocker() {
    return new Promise((resolve) => {
        exec('docker info', (error) => resolve(!error));
    });
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function isInfrastructureRunning() {
    return new Promise((resolve) => {
        exec('docker ps --filter "name=deployr-mariadb" -q', (error, stdout) => {
            resolve(stdout.trim().length > 0);
        });
    });
}

async function createConfig(serverIp, defaultUser) {
    const configContent = `#!/bin/bash
# Server-Konfiguration (automatisch erstellt vom Setup-Wizard)

# Server IP-Adresse
SERVER_IP="${serverIp}"

# Standard-Benutzer für SSH-Verbindungen
DEFAULT_USER="${defaultUser}"

# phpMyAdmin Port
PHPMYADMIN_PORT="8080"

# MariaDB Port
MARIADB_PORT="3306"
`;
    await fs.writeFile(CONFIG_PATH, configContent);
}

async function createInfrastructureEnv(mysqlRootPassword) {
    const envPath = path.join(INFRASTRUCTURE_PATH, '.env');
    const envContent = `# MariaDB Root Passwort
MYSQL_ROOT_PASSWORD=${mysqlRootPassword}
`;
    await fs.writeFile(envPath, envContent);
}

async function createDockerNetwork() {
    return new Promise((resolve, reject) => {
        exec('docker network create deployr-network 2>/dev/null || true', (error, stdout, stderr) => {
            resolve();
        });
    });
}

async function startInfrastructure() {
    return new Promise((resolve, reject) => {
        exec(`cd ${INFRASTRUCTURE_PATH} && docker compose up -d`, (error, stdout, stderr) => {
            if (error && !stderr.includes('already exists')) {
                reject(new Error(stderr || error.message));
            } else {
                resolve();
            }
        });
    });
}

async function waitForMariaDB(mysqlRootPassword, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        const isReady = await new Promise((resolve) => {
            exec(`docker exec deployr-mariadb mysql -uroot -p"${mysqlRootPassword}" -e "SELECT 1" 2>/dev/null`,
                (error) => resolve(!error));
        });

        if (isReady) return;
        await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('MariaDB nicht erreichbar nach 60 Sekunden');
}

async function createDashboardDatabase(mysqlRootPassword) {
    const dbPassword = process.env.DB_PASSWORD;

    return new Promise((resolve, reject) => {
        const sql = `
            CREATE DATABASE IF NOT EXISTS dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            CREATE USER IF NOT EXISTS 'dashboard_user'@'%' IDENTIFIED BY '${dbPassword}';
            GRANT ALL PRIVILEGES ON dashboard.* TO 'dashboard_user'@'%';
            FLUSH PRIVILEGES;
        `;

        exec(`docker exec -i deployr-mariadb mysql -uroot -p"${mysqlRootPassword}" -e "${sql}"`,
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve();
                }
            });
    });
}

async function createAdminUser(username, password, systemUsername) {
    const { pool, initDatabase } = require('../config/database');

    // Tabellen erstellen falls nicht vorhanden
    await initDatabase();

    // Passwort hashen
    const passwordHash = await bcrypt.hash(password, 12);

    // Admin-User erstellen
    await pool.execute(
        `INSERT INTO dashboard_users (username, password_hash, system_username, is_admin)
         VALUES (?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE password_hash = ?, is_admin = TRUE`,
        [username, passwordHash, systemUsername, passwordHash]
    );
}

module.exports = router;
module.exports.isSetupComplete = isSetupComplete;
