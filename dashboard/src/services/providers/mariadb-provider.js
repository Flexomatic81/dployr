const mysql = require('mysql2/promise');
const { generatePassword } = require('../utils/crypto');

const DB_HOST = 'dployr-mariadb';
const DB_PORT = 3306;

/**
 * MariaDB Provider for database operations
 */

// Create new database
async function createDatabase(systemUsername, databaseName) {
    const fullDbName = `${systemUsername}_${databaseName}`;
    const dbUser = `${systemUsername}_${databaseName}`;
    const dbPassword = generatePassword();

    const rootConnection = await mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: 'root',
        password: process.env.MYSQL_ROOT_PASSWORD
    });

    try {
        // Create database
        await rootConnection.execute(
            `CREATE DATABASE IF NOT EXISTS \`${fullDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );

        // Create user or update password if user already exists
        await rootConnection.execute(
            `CREATE USER IF NOT EXISTS '${dbUser}'@'%' IDENTIFIED BY '${dbPassword}'`
        );

        // Set password (if user already existed)
        await rootConnection.execute(
            `ALTER USER '${dbUser}'@'%' IDENTIFIED BY '${dbPassword}'`
        );

        // Grant privileges
        await rootConnection.execute(
            `GRANT ALL PRIVILEGES ON \`${fullDbName}\`.* TO '${dbUser}'@'%'`
        );

        await rootConnection.execute('FLUSH PRIVILEGES');

        return {
            database: fullDbName,
            username: dbUser,
            password: dbPassword,
            host: DB_HOST,
            port: DB_PORT,
            type: 'mariadb'
        };
    } finally {
        await rootConnection.end();
    }
}

// Delete database
async function deleteDatabase(databaseName, username) {
    const rootConnection = await mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: 'root',
        password: process.env.MYSQL_ROOT_PASSWORD
    });

    try {
        // Delete database
        await rootConnection.execute(`DROP DATABASE IF EXISTS \`${databaseName}\``);

        // Delete user
        if (username) {
            await rootConnection.execute(`DROP USER IF EXISTS '${username}'@'%'`);
        }

        await rootConnection.execute('FLUSH PRIVILEGES');

        return { success: true };
    } finally {
        await rootConnection.end();
    }
}

// Test connection
async function testConnection() {
    const connection = await mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: 'root',
        password: process.env.MYSQL_ROOT_PASSWORD
    });

    try {
        await connection.execute('SELECT 1');
        return true;
    } catch (error) {
        return false;
    } finally {
        await connection.end();
    }
}

// Get connection info
function getConnectionInfo() {
    return {
        host: DB_HOST,
        port: DB_PORT,
        type: 'mariadb',
        managementUrl: `/phpmyadmin`
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
