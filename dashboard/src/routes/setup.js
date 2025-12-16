const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const bcrypt = require('bcrypt');

const BASE_PATH = '/app';
const INFRASTRUCTURE_PATH = '/app/infrastructure';
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
    return new Promise((resolve) => {
        exec('docker info', (error) => resolve(!error));
    });
}

async function isInfrastructureRunning() {
    return new Promise((resolve) => {
        exec('docker ps --filter "name=dployr-mariadb" -q', (error, stdout) => {
            resolve(stdout.trim().length > 0);
        });
    });
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
    return new Promise((resolve) => {
        exec('docker network create dployr-network 2>/dev/null || true', (error, stdout, stderr) => {
            resolve();
        });
    });
}

async function waitForMariaDB(mysqlRootPassword, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        const isReady = await new Promise((resolve) => {
            // MariaDB 11 verwendet 'mariadb' statt 'mysql' als Client
            exec(`docker exec dployr-mariadb mariadb -uroot -p"${mysqlRootPassword}" -e "SELECT 1" 2>/dev/null`,
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

        exec(`docker exec -i dployr-mariadb mariadb -uroot -p"${mysqlRootPassword}" -e "${sql}"`,
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
