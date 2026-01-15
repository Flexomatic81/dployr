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

        // Migration: Add webhook columns for webhook-based auto-deploy
        try {
            await connection.execute(`
                ALTER TABLE project_autodeploy ADD COLUMN webhook_secret VARCHAR(64) NULL
            `);
            await connection.execute(`
                ALTER TABLE project_autodeploy ADD COLUMN webhook_enabled BOOLEAN DEFAULT FALSE
            `);
            logger.info('Migration: Added webhook_secret and webhook_enabled columns');
        } catch (e) {
            // Columns already exist - ignore
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

        // Migration: Extend trigger_type ENUM for clone/pull/webhook
        try {
            await connection.execute(`
                ALTER TABLE deployment_logs MODIFY COLUMN trigger_type ENUM('auto', 'manual', 'clone', 'pull', 'webhook') DEFAULT 'auto'
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

        // Migration: Add email columns for email verification and password reset
        try {
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN email VARCHAR(255) NULL
            `);
            logger.info('Migration: Added email column');
        } catch (e) {
            // Column already exists - ignore
        }

        try {
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE
            `);
            logger.info('Migration: Added email_verified column');
        } catch (e) {
            // Column already exists - ignore
        }

        try {
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN verification_token VARCHAR(64) NULL
            `);
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN verification_token_expires DATETIME NULL
            `);
            logger.info('Migration: Added verification_token columns');
        } catch (e) {
            // Columns already exist - ignore
        }

        try {
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN reset_token VARCHAR(64) NULL
            `);
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN reset_token_expires DATETIME NULL
            `);
            logger.info('Migration: Added reset_token columns');
        } catch (e) {
            // Columns already exist - ignore
        }

        // Migration: Add notification preferences columns
        try {
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN notify_deploy_success BOOLEAN DEFAULT TRUE
            `);
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN notify_deploy_failure BOOLEAN DEFAULT TRUE
            `);
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN notify_autodeploy BOOLEAN DEFAULT TRUE
            `);
            logger.info('Migration: Added notification preference columns');
        } catch (e) {
            // Columns already exist - ignore
        }

        // Migration: Add TOTP (Two-Factor Authentication) columns
        try {
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN totp_secret VARCHAR(64) NULL
            `);
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN totp_enabled BOOLEAN DEFAULT FALSE
            `);
            await connection.execute(`
                ALTER TABLE dashboard_users ADD COLUMN totp_backup_codes TEXT NULL
            `);
            logger.info('Migration: Added TOTP columns for 2FA');
        } catch (e) {
            // Columns already exist - ignore
        }

        // Project domains table for NPM integration
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS project_domains (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                project_name VARCHAR(100) NOT NULL,
                domain VARCHAR(255) NOT NULL,
                proxy_host_id INT NULL,
                certificate_id INT NULL,
                ssl_enabled BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_domain (domain),
                INDEX idx_project (user_id, project_name)
            )
        `);

        // Backup logs table for project and database backups
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS backup_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                backup_type ENUM('project', 'database') NOT NULL,
                target_name VARCHAR(100) NOT NULL,
                filename VARCHAR(255) NOT NULL,
                file_size BIGINT NULL,
                status ENUM('pending', 'running', 'success', 'failed') NOT NULL,
                error_message TEXT NULL,
                duration_ms INT NULL,
                metadata JSON NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                INDEX idx_user_target (user_id, backup_type, target_name),
                INDEX idx_created (created_at)
            )
        `);

        // ============================================================
        // WORKSPACES FEATURE TABLES
        // ============================================================

        // Workspaces table - stores workspace configuration and status
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS workspaces (
                id INT AUTO_INCREMENT PRIMARY KEY,

                -- Relationships
                user_id INT NOT NULL,
                project_name VARCHAR(100) NOT NULL,

                -- Container info
                container_id VARCHAR(64) NULL,
                container_name VARCHAR(100) NULL,

                -- Status
                status ENUM('stopped', 'starting', 'running', 'stopping', 'error')
                    DEFAULT 'stopped',
                error_message TEXT NULL,

                -- Network
                internal_port INT DEFAULT 8080,
                assigned_port INT NULL,

                -- Resource limits
                cpu_limit VARCHAR(20) DEFAULT '1',
                ram_limit VARCHAR(20) DEFAULT '2g',
                disk_limit VARCHAR(20) DEFAULT '10g',

                -- Timeouts
                idle_timeout_minutes INT DEFAULT 30,
                max_lifetime_hours INT DEFAULT 24,

                -- Activity tracking
                last_activity TIMESTAMP NULL,
                last_accessed_by INT NULL,
                started_at TIMESTAMP NULL,

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                -- Constraints
                FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                FOREIGN KEY (last_accessed_by) REFERENCES dashboard_users(id) ON DELETE SET NULL,
                UNIQUE KEY unique_workspace (user_id, project_name),
                INDEX idx_status (status),
                INDEX idx_last_activity (last_activity)
            )
        `);

        // Migration: Add code-server password columns to workspaces
        try {
            await connection.execute(`
                ALTER TABLE workspaces
                ADD COLUMN code_server_password_encrypted VARBINARY(512) NULL,
                ADD COLUMN code_server_password_iv VARBINARY(16) NULL
            `);
            logger.info('Migration: Added code-server password columns to workspaces');
        } catch (e) {
            // Columns already exist - ignore
            if (!e.message.includes('Duplicate column name')) {
                logger.debug('Workspace password columns migration skipped or error:', e.message);
            }
        }

        // User API keys table - encrypted storage of API keys
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS user_api_keys (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL UNIQUE,

                -- Anthropic API key (encrypted)
                anthropic_key_encrypted VARBINARY(512) NULL,
                anthropic_key_iv VARBINARY(16) NULL,

                -- Future providers
                openai_key_encrypted VARBINARY(512) NULL,
                openai_key_iv VARBINARY(16) NULL,

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE
            )
        `);

        // Preview environments table - temporary deployment environments
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS preview_environments (
                id INT AUTO_INCREMENT PRIMARY KEY,

                -- Relationships
                workspace_id INT NOT NULL,
                user_id INT NOT NULL,
                project_name VARCHAR(100) NOT NULL,

                -- Identification
                preview_hash VARCHAR(32) NOT NULL UNIQUE,
                preview_url VARCHAR(255) NULL,

                -- Container info
                container_id VARCHAR(64) NULL,
                container_name VARCHAR(100) NULL,
                assigned_port INT NULL,

                -- Status
                status ENUM('creating', 'running', 'stopping', 'stopped', 'expired', 'error')
                    DEFAULT 'creating',
                error_message TEXT NULL,

                -- Lifecycle
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                -- Optional password protection
                password_hash VARCHAR(255) NULL,

                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                INDEX idx_expires (expires_at),
                INDEX idx_status (status)
            )
        `);

        // Workspace activity log - audit trail for workspace actions
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS workspace_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,

                -- Relationships
                workspace_id INT NULL,
                user_id INT NOT NULL,
                project_name VARCHAR(100) NOT NULL,

                -- Action
                action ENUM(
                    'create', 'start', 'stop', 'delete',
                    'sync_to_project', 'sync_from_project',
                    'preview_create', 'preview_delete',
                    'timeout', 'error'
                ) NOT NULL,

                -- Details
                details JSON NULL,

                -- Timestamp
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
                FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                INDEX idx_user_project (user_id, project_name),
                INDEX idx_created (created_at)
            )
        `);

        // Resource limits table - global and user-specific limits
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS resource_limits (
                id INT AUTO_INCREMENT PRIMARY KEY,

                -- NULL = global defaults, otherwise user-specific
                user_id INT NULL,

                -- Workspace limits
                max_workspaces INT DEFAULT 2,
                default_cpu VARCHAR(20) DEFAULT '1',
                default_ram VARCHAR(20) DEFAULT '2g',
                default_disk VARCHAR(20) DEFAULT '10g',
                default_idle_timeout INT DEFAULT 30,

                -- Preview limits
                max_previews_per_workspace INT DEFAULT 3,
                default_preview_lifetime_hours INT DEFAULT 24,

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_user_limits (user_id)
            )
        `);

        // Insert global defaults if not exists
        try {
            await connection.execute(`
                INSERT INTO resource_limits (user_id) VALUES (NULL)
            `);
            logger.info('Migration: Created global resource limits');
        } catch (e) {
            // Global defaults already exist - ignore
        }

        // ============================================================
        // GIT CREDENTIALS TABLE (encrypted storage)
        // ============================================================

        // Git credentials table - encrypted storage of Git tokens
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS git_credentials (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                project_name VARCHAR(100) NOT NULL,
                repo_url VARCHAR(500) NOT NULL,
                token_encrypted VARBINARY(1024) NULL,
                token_iv VARBINARY(16) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_project_creds (user_id, project_name)
            )
        `);

        // ============================================================
        // PROJECT PORTS TABLE (for multi-container projects)
        // ============================================================

        // Project ports table - tracks port allocations for custom docker-compose projects
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS project_ports (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                project_name VARCHAR(100) NOT NULL,
                service_name VARCHAR(100) NOT NULL,
                internal_port INT NOT NULL,
                external_port INT NOT NULL,
                protocol VARCHAR(10) DEFAULT 'tcp',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_external_port (external_port),
                INDEX idx_project (user_id, project_name)
            )
        `);

        connection.release();
        logger.info('Database schema initialized (including workspaces)');
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
