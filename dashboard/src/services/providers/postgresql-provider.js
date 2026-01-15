const { Pool } = require('pg');
const { exec } = require('child_process');
const { promisify } = require('util');
const { generatePassword, escapeSqlString, escapeShellArg } = require('../utils/crypto');
const { assertValidSqlIdentifier } = require('../utils/security');

const execAsync = promisify(exec);

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
    // Validate identifiers before SQL execution (defense-in-depth)
    assertValidSqlIdentifier(systemUsername, 'system username');

    // PostgreSQL doesn't allow hyphens in identifiers without quotes
    const safeName = databaseName.replace(/-/g, '_');
    assertValidSqlIdentifier(safeName, 'database name');

    const fullDbName = `${systemUsername}_${safeName}`;
    const dbUser = `${systemUsername}_${safeName}`;

    // Validate combined identifier as well
    assertValidSqlIdentifier(fullDbName, 'full database name');

    const dbPassword = generatePassword();

    const pool = getRootPool();

    try {
        // Check if user already exists
        const userExists = await pool.query(
            `SELECT 1 FROM pg_roles WHERE rolname = $1`,
            [dbUser]
        );

        // Create user or update password
        // Password is escaped to prevent SQL injection
        const escapedPassword = escapeSqlString(dbPassword);
        if (userExists.rows.length === 0) {
            await pool.query(
                `CREATE USER "${dbUser}" WITH PASSWORD '${escapedPassword}'`
            );
        } else {
            // User already exists - update password
            await pool.query(
                `ALTER USER "${dbUser}" WITH PASSWORD '${escapedPassword}'`
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
    // Validate identifiers before SQL execution (defense-in-depth)
    assertValidSqlIdentifier(databaseName, 'database name');
    if (username) {
        assertValidSqlIdentifier(username, 'username');
    }

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

/**
 * Dumps a database to a SQL file using pg_dump
 * @param {string} databaseName - Full database name
 * @param {string} username - Database username
 * @param {string} password - Database password
 * @param {string} outputPath - Path to output SQL file
 * @returns {Promise<{success: boolean, path: string}>}
 */
async function dumpDatabase(databaseName, username, password, outputPath) {
    // Validate identifiers before command execution (defense-in-depth)
    assertValidSqlIdentifier(databaseName, 'database name');
    assertValidSqlIdentifier(username, 'username');

    // Use pg_dump with PGPASSWORD env variable for authentication
    // Password is escaped to prevent shell injection
    const escapedPassword = escapeShellArg(password);
    const command = `PGPASSWORD="${escapedPassword}" pg_dump -h ${DB_HOST} -p ${DB_PORT} -U "${username}" -F p -b -v "${databaseName}" > "${outputPath}"`;

    try {
        await execAsync(command, {
            timeout: 300000, // 5 minute timeout
            shell: '/bin/sh'
        });
        return { success: true, path: outputPath };
    } catch (error) {
        throw new Error(`pg_dump failed: ${error.message}`);
    }
}

/**
 * Restores a database from a SQL file
 * @param {string} databaseName - Full database name
 * @param {string} username - Database username
 * @param {string} password - Database password
 * @param {string} inputPath - Path to SQL file
 * @returns {Promise<{success: boolean}>}
 */
async function restoreDatabase(databaseName, username, password, inputPath) {
    // Validate identifiers before command execution (defense-in-depth)
    assertValidSqlIdentifier(databaseName, 'database name');
    assertValidSqlIdentifier(username, 'username');

    // Password is escaped to prevent shell injection
    const escapedPassword = escapeShellArg(password);
    const command = `PGPASSWORD="${escapedPassword}" psql -h ${DB_HOST} -p ${DB_PORT} -U "${username}" -d "${databaseName}" -f "${inputPath}"`;

    try {
        await execAsync(command, {
            timeout: 300000, // 5 minute timeout
            shell: '/bin/sh'
        });
        return { success: true };
    } catch (error) {
        throw new Error(`psql restore failed: ${error.message}`);
    }
}

module.exports = {
    createDatabase,
    deleteDatabase,
    testConnection,
    getConnectionInfo,
    dumpDatabase,
    restoreDatabase,
    DB_HOST,
    DB_PORT
};
