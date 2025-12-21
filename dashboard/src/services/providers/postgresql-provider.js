const { Pool } = require('pg');
const crypto = require('crypto');

const DB_HOST = 'dployr-postgresql';
const DB_PORT = 5432;

/**
 * PostgreSQL Provider für Datenbank-Operationen
 */

// Root-Pool für Admin-Operationen
function getRootPool() {
    return new Pool({
        host: DB_HOST,
        port: DB_PORT,
        user: 'postgres',
        password: process.env.POSTGRES_ROOT_PASSWORD,
        database: 'postgres',
        max: 5
    });
}

// Neue Datenbank erstellen
async function createDatabase(systemUsername, databaseName) {
    // PostgreSQL erlaubt keine Bindestriche in Identifier ohne Quotes
    const safeName = databaseName.replace(/-/g, '_');
    const fullDbName = `${systemUsername}_${safeName}`;
    const dbUser = `${systemUsername}_${safeName}`;
    const dbPassword = generatePassword();

    const pool = getRootPool();

    try {
        // Prüfen ob User bereits existiert
        const userExists = await pool.query(
            `SELECT 1 FROM pg_roles WHERE rolname = $1`,
            [dbUser]
        );

        // User erstellen falls nicht vorhanden
        if (userExists.rows.length === 0) {
            // Passwort muss escaped werden für SQL
            await pool.query(
                `CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword}'`
            );
        }

        // Prüfen ob Datenbank bereits existiert
        const dbExists = await pool.query(
            `SELECT 1 FROM pg_database WHERE datname = $1`,
            [fullDbName]
        );

        // Datenbank erstellen falls nicht vorhanden
        if (dbExists.rows.length === 0) {
            await pool.query(`CREATE DATABASE "${fullDbName}" OWNER "${dbUser}"`);
        }

        // Alle Rechte vergeben
        await pool.query(`GRANT ALL PRIVILEGES ON DATABASE "${fullDbName}" TO "${dbUser}"`);

        return {
            database: fullDbName,
            username: dbUser,
            password: dbPassword,
            host: DB_HOST,
            port: DB_PORT,
            type: 'postgresql'
        };
    } finally {
        await pool.end();
    }
}

// Datenbank löschen
async function deleteDatabase(databaseName, username) {
    const pool = getRootPool();

    try {
        // Alle Verbindungen zur Datenbank trennen
        await pool.query(`
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = $1
            AND pid <> pg_backend_pid()
        `, [databaseName]);

        // Datenbank löschen
        await pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);

        // User löschen
        if (username) {
            // Erst alle Rechte entfernen
            await pool.query(`DROP OWNED BY "${username}" CASCADE`).catch(() => {});
            await pool.query(`DROP USER IF EXISTS "${username}"`);
        }

        return { success: true };
    } finally {
        await pool.end();
    }
}

// Verbindung testen
async function testConnection() {
    const pool = getRootPool();

    try {
        await pool.query('SELECT 1');
        return true;
    } catch (error) {
        return false;
    } finally {
        await pool.end();
    }
}

// Verbindungsinfo abrufen
function getConnectionInfo() {
    return {
        host: DB_HOST,
        port: DB_PORT,
        type: 'postgresql',
        managementUrl: `/pgadmin`
    };
}

// Sicheres Passwort generieren
function generatePassword(length = 16) {
    return crypto.randomBytes(length).toString('base64').slice(0, length).replace(/[+/=]/g, 'x');
}

module.exports = {
    createDatabase,
    deleteDatabase,
    testConnection,
    getConnectionInfo,
    DB_HOST,
    DB_PORT
};
