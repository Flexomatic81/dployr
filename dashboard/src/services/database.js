const { pool } = require('../config/database');
const fs = require('fs').promises;
const path = require('path');

const mariadbProvider = require('./providers/mariadb-provider');
const postgresqlProvider = require('./providers/postgresql-provider');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

// Provider nach Typ abrufen
function getProvider(type = 'mariadb') {
    switch (type) {
        case 'postgresql':
        case 'postgres':
            return postgresqlProvider;
        case 'mariadb':
        case 'mysql':
        default:
            return mariadbProvider;
    }
}

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
                // Parse Name und Typ aus Kommentar
                const nameMatch = trimmed.match(/# Datenbank:\s*([^\s(]+)/);
                const typeMatch = trimmed.match(/typ:\s*(\w+)/);
                currentDb = {
                    name: nameMatch ? nameMatch[1] : '',
                    type: typeMatch ? typeMatch[1] : 'mariadb' // Default: mariadb für alte Einträge
                };
            } else if (trimmed.startsWith('DB_TYPE=')) {
                currentDb.type = trimmed.split('=')[1];
            } else if (trimmed.startsWith('DB_HOST=')) {
                currentDb.host = trimmed.split('=')[1];
            } else if (trimmed.startsWith('DB_PORT=')) {
                currentDb.port = parseInt(trimmed.split('=')[1], 10);
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
async function createDatabase(systemUsername, databaseName, type = 'mariadb') {
    // Validierung
    if (!/^[a-z0-9_]+$/.test(databaseName)) {
        throw new Error('Datenbankname darf nur Kleinbuchstaben, Zahlen und Unterstriche enthalten');
    }

    // Provider für den gewählten Typ holen
    const provider = getProvider(type);

    // Datenbank über Provider erstellen
    const result = await provider.createDatabase(systemUsername, databaseName);

    // Credentials speichern (mit Typ-Information)
    await saveCredentials(systemUsername, result);

    return result;
}

// Datenbank löschen
async function deleteDatabase(systemUsername, databaseName) {
    // Credentials laden um den User und Typ zu finden
    const databases = await getUserDatabases(systemUsername);
    const dbInfo = databases.find(db => db.database === databaseName);

    if (!dbInfo) {
        throw new Error('Datenbank nicht gefunden');
    }

    // Provider für den Datenbanktyp holen
    const provider = getProvider(dbInfo.type);

    // Datenbank über Provider löschen
    await provider.deleteDatabase(databaseName, dbInfo.username);

    // Credentials aus Datei entfernen
    await removeCredentials(systemUsername, databaseName);

    return { success: true };
}

// Credentials in Datei speichern (erweitertes Format)
async function saveCredentials(systemUsername, dbInfo) {
    const userPath = path.join(USERS_PATH, systemUsername);
    const credentialsPath = path.join(userPath, '.db-credentials');

    // User-Verzeichnis erstellen falls nicht vorhanden
    await fs.mkdir(userPath, { recursive: true });

    const entry = `
# Datenbank: ${dbInfo.database} (erstellt: ${new Date().toISOString()}, typ: ${dbInfo.type})
DB_TYPE=${dbInfo.type}
DB_HOST=${dbInfo.host}
DB_PORT=${dbInfo.port}
DB_DATABASE=${dbInfo.database}
DB_USERNAME=${dbInfo.username}
DB_PASSWORD=${dbInfo.password}
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

// Verfügbare Datenbanktypen
function getAvailableTypes() {
    return [
        {
            id: 'mariadb',
            name: 'MariaDB',
            description: 'MySQL-kompatible relationale Datenbank',
            icon: 'bi-database',
            color: 'primary',
            port: 3306,
            managementTool: 'phpMyAdmin'
        },
        {
            id: 'postgresql',
            name: 'PostgreSQL',
            description: 'Fortschrittliche Open-Source Datenbank',
            icon: 'bi-database-fill',
            color: 'info',
            port: 5432,
            managementTool: 'pgAdmin'
        }
    ];
}

// Verbindung für einen Typ testen
async function testConnection(type = 'mariadb') {
    const provider = getProvider(type);
    return provider.testConnection();
}

module.exports = {
    getUserDatabases,
    createDatabase,
    deleteDatabase,
    getAvailableTypes,
    testConnection,
    getProvider
};
