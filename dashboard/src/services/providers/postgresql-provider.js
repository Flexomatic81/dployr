const { Pool } = require('pg');
const { generatePassword } = require('../utils/crypto');

const DB_HOST = 'dployr-postgresql';
const DB_PORT = 5432;

/**
 * PostgreSQL Provider for database operations
 */

// Root pool for admin operations
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

// Create new database
async function createDatabase(systemUsername, databaseName) {
    // PostgreSQL doesn't allow hyphens in identifiers without quotes
    const safeName = databaseName.replace(/-/g, '_');
    const fullDbName = `${systemUsername}_${safeName}`;
    const dbUser = `${systemUsername}_${safeName}`;
    const dbPassword = generatePassword();

    const pool = getRootPool();

    try {
        // Check if user already exists
        const userExists = await pool.query(
            `SELECT 1 FROM pg_roles WHERE rolname = $1`,
            [dbUser]
        );

        // Create user or update password
        if (userExists.rows.length === 0) {
            // Password must be escaped for SQL
            await pool.query(
                `CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword}'`
            );
        } else {
            // User already exists - update password
            await pool.query(
                `ALTER USER "${dbUser}" WITH PASSWORD '${dbPassword}'`
            );
        }

        // Check if database already exists
        const dbExists = await pool.query(
            `SELECT 1 FROM pg_database WHERE datname = $1`,
            [fullDbName]
        );

        // Create database if not present
        if (dbExists.rows.length === 0) {
            await pool.query(`CREATE DATABASE "${fullDbName}" OWNER "${dbUser}"`);
        }

        // Grant all privileges
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

// Delete database
async function deleteDatabase(databaseName, username) {
    const pool = getRootPool();

    try {
        // Disconnect all connections to the database
        await pool.query(`
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = $1
            AND pid <> pg_backend_pid()
        `, [databaseName]);

        // Delete database
        await pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);

        // Delete user
        if (username) {
            // First remove all privileges
            await pool.query(`DROP OWNED BY "${username}" CASCADE`).catch(() => {});
            await pool.query(`DROP USER IF EXISTS "${username}"`);
        }

        return { success: true };
    } finally {
        await pool.end();
    }
}

// Test connection
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

// Get connection info
function getConnectionInfo() {
    return {
        host: DB_HOST,
        port: DB_PORT,
        type: 'postgresql',
        managementUrl: `/pgadmin`
    };
}

module.exports = {
    createDatabase,
    deleteDatabase,
    testConnection,
    getConnectionInfo,
    DB_HOST,
    DB_PORT
};
