const mysql = require('mysql2/promise');
const crypto = require('crypto');

const DB_HOST = 'dployr-mariadb';
const DB_PORT = 3306;

/**
 * MariaDB Provider für Datenbank-Operationen
 */

// Neue Datenbank erstellen
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
        // Datenbank erstellen
        await rootConnection.execute(
            `CREATE DATABASE IF NOT EXISTS \`${fullDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );

        // User erstellen
        await rootConnection.execute(
            `CREATE USER IF NOT EXISTS '${dbUser}'@'%' IDENTIFIED BY '${dbPassword}'`
        );

        // Rechte vergeben
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

// Datenbank löschen
async function deleteDatabase(databaseName, username) {
    const rootConnection = await mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: 'root',
        password: process.env.MYSQL_ROOT_PASSWORD
    });

    try {
        // Datenbank löschen
        await rootConnection.execute(`DROP DATABASE IF EXISTS \`${databaseName}\``);

        // User löschen
        if (username) {
            await rootConnection.execute(`DROP USER IF EXISTS '${username}'@'%'`);
        }

        await rootConnection.execute('FLUSH PRIVILEGES');

        return { success: true };
    } finally {
        await rootConnection.end();
    }
}

// Verbindung testen
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

// Verbindungsinfo abrufen
function getConnectionInfo() {
    return {
        host: DB_HOST,
        port: DB_PORT,
        type: 'mariadb',
        managementUrl: `/phpmyadmin`
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
