const { pool } = require('../config/database');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

// Datenbanken eines Users abrufen
async function getUserDatabases(systemUsername) {
    const credentialsPath = path.join(USERS_PATH, systemUsername, '.db-credentials');
    const databases = [];

    try {
        const content = await fs.readFile(credentialsPath, 'utf8');
        const lines = content.split('\n');

        let currentDb = {};

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith('# Datenbank:')) {
                if (currentDb.name) {
                    databases.push(currentDb);
                }
                currentDb = {
                    name: trimmed.replace('# Datenbank:', '').split('(')[0].trim()
                };
            } else if (trimmed.startsWith('DB_DATABASE=')) {
                currentDb.database = trimmed.split('=')[1];
            } else if (trimmed.startsWith('DB_USERNAME=')) {
                currentDb.username = trimmed.split('=')[1];
            } else if (trimmed.startsWith('DB_PASSWORD=')) {
                currentDb.password = trimmed.split('=')[1];
            }
        }

        if (currentDb.database) {
            databases.push(currentDb);
        }

        return databases;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

// Neue Datenbank erstellen
async function createDatabase(systemUsername, databaseName) {
    // Validierung
    if (!/^[a-z0-9_]+$/.test(databaseName)) {
        throw new Error('Datenbankname darf nur Kleinbuchstaben, Zahlen und Unterstriche enthalten');
    }

    const dbUser = `${systemUsername}_${databaseName}`;
    const dbPassword = generatePassword();

    // Verbindung zur MariaDB herstellen (als root)
    const mysql = require('mysql2/promise');
    const rootConnection = await mysql.createConnection({
        host: process.env.DB_HOST || 'deployr-mariadb',
        port: process.env.DB_PORT || 3306,
        user: 'root',
        password: process.env.MYSQL_ROOT_PASSWORD
    });

    try {
        // Datenbank erstellen
        await rootConnection.execute(
            `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );

        // User erstellen
        await rootConnection.execute(
            `CREATE USER IF NOT EXISTS '${dbUser}'@'%' IDENTIFIED BY '${dbPassword}'`
        );

        // Rechte vergeben
        await rootConnection.execute(
            `GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO '${dbUser}'@'%'`
        );

        await rootConnection.execute('FLUSH PRIVILEGES');

        // Credentials speichern
        await saveCredentials(systemUsername, databaseName, dbUser, dbPassword);

        return {
            database: databaseName,
            username: dbUser,
            password: dbPassword,
            host: 'deployr-mariadb',
            port: 3306
        };
    } finally {
        await rootConnection.end();
    }
}

// Datenbank löschen
async function deleteDatabase(systemUsername, databaseName) {
    // Credentials laden um den User zu finden
    const databases = await getUserDatabases(systemUsername);
    const dbInfo = databases.find(db => db.database === databaseName);

    if (!dbInfo) {
        throw new Error('Datenbank nicht gefunden');
    }

    // Verbindung zur MariaDB herstellen (als root)
    const mysql = require('mysql2/promise');
    const rootConnection = await mysql.createConnection({
        host: process.env.DB_HOST || 'deployr-mariadb',
        port: process.env.DB_PORT || 3306,
        user: 'root',
        password: process.env.MYSQL_ROOT_PASSWORD
    });

    try {
        // Datenbank löschen
        await rootConnection.execute(`DROP DATABASE IF EXISTS \`${databaseName}\``);

        // User löschen
        if (dbInfo.username) {
            await rootConnection.execute(`DROP USER IF EXISTS '${dbInfo.username}'@'%'`);
        }

        await rootConnection.execute('FLUSH PRIVILEGES');

        // Credentials aus Datei entfernen
        await removeCredentials(systemUsername, databaseName);

        return { success: true };
    } finally {
        await rootConnection.end();
    }
}

// Credentials in Datei speichern
async function saveCredentials(systemUsername, databaseName, dbUser, dbPassword) {
    const userPath = path.join(USERS_PATH, systemUsername);
    const credentialsPath = path.join(userPath, '.db-credentials');

    // User-Verzeichnis erstellen falls nicht vorhanden
    await fs.mkdir(userPath, { recursive: true });

    const entry = `
# Datenbank: ${databaseName} (erstellt: ${new Date().toISOString()})
DB_DATABASE=${databaseName}
DB_USERNAME=${dbUser}
DB_PASSWORD=${dbPassword}
`;

    await fs.appendFile(credentialsPath, entry);
}

// Credentials aus Datei entfernen
async function removeCredentials(systemUsername, databaseName) {
    const credentialsPath = path.join(USERS_PATH, systemUsername, '.db-credentials');

    try {
        const content = await fs.readFile(credentialsPath, 'utf8');
        const lines = content.split('\n');
        const newLines = [];
        let skipUntilNext = false;

        for (const line of lines) {
            if (line.includes(`# Datenbank: ${databaseName}`)) {
                skipUntilNext = true;
                continue;
            }

            if (skipUntilNext) {
                if (line.startsWith('# Datenbank:') || line.trim() === '') {
                    if (line.startsWith('# Datenbank:')) {
                        skipUntilNext = false;
                        newLines.push(line);
                    }
                }
                continue;
            }

            newLines.push(line);
        }

        await fs.writeFile(credentialsPath, newLines.join('\n'));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
}

// Sicheres Passwort generieren
function generatePassword(length = 16) {
    return crypto.randomBytes(length).toString('base64').slice(0, length).replace(/[+/=]/g, 'x');
}

module.exports = {
    getUserDatabases,
    createDatabase,
    deleteDatabase
};
