const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'deployr-mariadb',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USERNAME || 'dashboard_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'dashboard',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Datenbank-Schema initialisieren
async function initDatabase() {
    try {
        const connection = await pool.getConnection();

        // Dashboard Users Tabelle erstellen
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS dashboard_users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                system_username VARCHAR(50) NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Sessions Tabelle für express-session (optional, falls DB-Sessions gewünscht)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS sessions (
                session_id VARCHAR(128) PRIMARY KEY,
                expires INT UNSIGNED NOT NULL,
                data MEDIUMTEXT
            )
        `);

        connection.release();
        console.log('Datenbank-Schema initialisiert');
    } catch (error) {
        console.error('Datenbank-Initialisierung fehlgeschlagen:', error.message);
        throw error;
    }
}

module.exports = { pool, initDatabase };
