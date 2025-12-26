const { pool } = require('../config/database');
const fs = require('fs').promises;
const path = require('path');

const mariadbProvider = require('./providers/mariadb-provider');
const postgresqlProvider = require('./providers/postgresql-provider');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

// Get provider by type
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

// Get user databases
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
                // Parse name and type from comment
                const nameMatch = trimmed.match(/# Datenbank:\s*([^\s(]+)/);
                const typeMatch = trimmed.match(/typ:\s*(\w+)/);
                currentDb = {
                    name: nameMatch ? nameMatch[1] : '',
                    type: typeMatch ? typeMatch[1] : 'mariadb' // Default: mariadb for old entries
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

// Create new database
async function createDatabase(systemUsername, databaseName, type = 'mariadb') {
    // Validation
    if (!/^[a-z0-9_]+$/.test(databaseName)) {
        throw new Error('Database name may only contain lowercase letters, numbers and underscores');
    }

    // Get provider for selected type
    const provider = getProvider(type);

    // Create database via provider
    const result = await provider.createDatabase(systemUsername, databaseName);

    // Save credentials (with type information)
    await saveCredentials(systemUsername, result);

    return result;
}

// Delete database
async function deleteDatabase(systemUsername, databaseName) {
    // Load credentials to find user and type
    const databases = await getUserDatabases(systemUsername);
    const dbInfo = databases.find(db => db.database === databaseName);

    if (!dbInfo) {
        throw new Error('Database not found');
    }

    // Get provider for database type
    const provider = getProvider(dbInfo.type);

    // Delete database via provider
    await provider.deleteDatabase(databaseName, dbInfo.username);

    // Remove credentials from file
    await removeCredentials(systemUsername, databaseName);

    return { success: true };
}

// Save credentials to file (extended format)
async function saveCredentials(systemUsername, dbInfo) {
    const userPath = path.join(USERS_PATH, systemUsername);
    const credentialsPath = path.join(userPath, '.db-credentials');

    // Create user directory if not exists
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

// Remove credentials from file
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

// Available database types
function getAvailableTypes() {
    return [
        {
            id: 'mariadb',
            name: 'MariaDB',
            description: 'MySQL-compatible relational database',
            icon: 'bi-database',
            color: 'primary',
            port: 3306,
            managementTool: 'phpMyAdmin'
        },
        {
            id: 'postgresql',
            name: 'PostgreSQL',
            description: 'Advanced open-source database',
            icon: 'bi-database-fill',
            color: 'info',
            port: 5432,
            managementTool: 'pgAdmin'
        }
    ];
}

// Test connection for a type
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
