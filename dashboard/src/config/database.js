const mysql = require('mysql2/promise');
const { logger } = require('./logger');

let pool = null;

/**
 * Creates the connection pool (lazy initialization)
 */
function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'dployr-mariadb',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USERNAME || 'dashboard_user',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE || 'dashboard',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // Error handler for connection issues
        pool.on('error', (err) => {
            logger.error('Database pool error', { error: err.message, code: err.code });
            if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNREFUSED') {
                pool = null; // Reset pool for reconnect
            }
        });
    }
    return pool;
}

/**
 * Proxy object that automatically calls getPool()
 * Allows access to pool.query() etc. without explicit getPool() call
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
 * Initialize database schema
 */
async function initDatabase() {
    try {
        const connection = await getPool().getConnection();

        // Create dashboard users table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS dashboard_users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                system_username VARCHAR(50) NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                approved BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migration: Add approved column if not exists
        try {
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN approved BOOLEAN DEFAULT FALSE
            `);
            // Auto-approve existing users
            await connection.execute(`UPDATE dashboard_users SET approved = TRUE WHERE approved IS NULL OR id > 0`);
            logger.info('Migration: Added approved column, existing users approved');
        } catch (e) {
            // Column already exists - ignore
        }

        // Sessions table for express-session (optional, if DB sessions desired)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS sessions (
                session_id VARCHAR(128) PRIMARY KEY,
                expires INT UNSIGNED NOT NULL,
                data MEDIUMTEXT
            )
        `);

        // Auto-deploy configuration table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS project_autodeploy (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                project_name VARCHAR(100) NOT NULL,
                enabled BOOLEAN DEFAULT TRUE,
                branch VARCHAR(100) DEFAULT 'main',
                interval_minutes INT DEFAULT 5,
                last_check TIMESTAMP NULL,
                last_commit_hash VARCHAR(40) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_project (user_id, project_name)
            )
        `);

        // Migration: Add interval_minutes column if not exists
        try {
            await connection.execute(`
                ALTER TABLE project_autodeploy ADD COLUMN interval_minutes INT DEFAULT 5
            `);
            logger.info('Migration: Added interval_minutes column');
        } catch (e) {
            // Column already exists - ignore
        }

        // Deployment logs table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS deployment_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                project_name VARCHAR(100) NOT NULL,
                trigger_type ENUM('auto', 'manual', 'clone', 'pull') DEFAULT 'auto',
                old_commit_hash VARCHAR(40) NULL,
                new_commit_hash VARCHAR(40) NULL,
                commit_message TEXT NULL,
                status ENUM('pending', 'pulling', 'cloning', 'restarting', 'success', 'failed') NOT NULL,
                error_message TEXT NULL,
                duration_ms INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                INDEX idx_project (user_id, project_name),
                INDEX idx_created (created_at)
            )
        `);

        // Migration: Extend trigger_type ENUM for clone/pull
        try {
            await connection.execute(`
                ALTER TABLE deployment_logs MODIFY COLUMN trigger_type ENUM('auto', 'manual', 'clone', 'pull') DEFAULT 'auto'
            `);
            await connection.execute(`
                ALTER TABLE deployment_logs MODIFY COLUMN status ENUM('pending', 'pulling', 'cloning', 'restarting', 'success', 'failed') NOT NULL
            `);
        } catch (e) {
            // ENUM already extended - ignore
        }

        // Project shares table for project sharing
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS project_shares (
                id INT AUTO_INCREMENT PRIMARY KEY,
                owner_id INT NOT NULL,
                owner_system_username VARCHAR(50) NOT NULL,
                project_name VARCHAR(100) NOT NULL,
                shared_with_id INT NOT NULL,
                permission ENUM('read', 'manage', 'full') DEFAULT 'read',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                FOREIGN KEY (shared_with_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_share (owner_id, project_name, shared_with_id),
                INDEX idx_shared_with (shared_with_id)
            )
        `);

        // Migration: Add language column for i18n
        try {
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN language VARCHAR(5) DEFAULT 'de'
            `);
            logger.info('Migration: Added language column for i18n');
        } catch (e) {
            // Column already exists - ignore
        }

        connection.release();
        logger.info('Database schema initialized');
    } catch (error) {
        logger.error('Database initialization failed', { error: error.message });
        throw error;
    }
}

/**
 * Tests the database connection
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
 * Closes the pool (for graceful shutdown)
 */
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = {
    pool: poolProxy,  // Export proxy for backwards compatibility
    getPool,
    initDatabase,
    testConnection,
    closePool
};
