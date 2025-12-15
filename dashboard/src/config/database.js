const mysql = require('mysql2/promise');

let pool = null;

/**
 * Erstellt den Connection Pool (Lazy Initialization)
 */
function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'deployr-mariadb',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USERNAME || 'dashboard_user',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE || 'dashboard',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // Error-Handler für Verbindungsprobleme
        pool.on('error', (err) => {
            console.error('Database pool error:', err);
            if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNREFUSED') {
                pool = null; // Pool zurücksetzen für Reconnect
            }
        });
    }
    return pool;
}

/**
 * Proxy-Objekt das automatisch getPool() aufruft
 * Erlaubt Zugriff auf pool.query() etc. ohne expliziten getPool() Aufruf
 */
const poolProxy = new Proxy({}, {
    get(target, prop) {
        const currentPool = getPool();
        const value = currentPool[prop];
        if (typeof value === 'function') {
            return value.bind(currentPool);
        }
        return value;
    }
});

/**
 * Datenbank-Schema initialisieren
 */
async function initDatabase() {
    try {
        const connection = await getPool().getConnection();

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

/**
 * Testet die Datenbankverbindung
 */
async function testConnection() {
    try {
        const connection = await getPool().getConnection();
        await connection.ping();
        connection.release();
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Schließt den Pool (für graceful shutdown)
 */
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = {
    pool: poolProxy,  // Exportiert Proxy für Rückwärtskompatibilität
    getPool,
    initDatabase,
    testConnection,
    closePool
};
