const { pool } = require('../config/database');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { logger } = require('../config/logger');
const databaseService = require('./database');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

// Default patterns to exclude from backups
const DEFAULT_EXCLUDE_PATTERNS = [
    'node_modules',
    'vendor',
    '.git',
    '__pycache__',
    '.cache',
    '*.log',
    '.npm',
    '.yarn'
];

/**
 * Gets the backup directory path for a user
 */
function getBackupDir(systemUsername) {
    return path.join(USERS_PATH, systemUsername, '.backups');
}

/**
 * Ensures the backup directory exists
 */
async function ensureBackupDir(systemUsername) {
    const backupDir = getBackupDir(systemUsername);
    await fs.mkdir(backupDir, { recursive: true });
    return backupDir;
}

/**
 * Generates a backup filename with timestamp
 */
function generateBackupFilename(type, targetName, extension = 'tar.gz') {
    const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
    return `${type}_${targetName}_${timestamp}.${extension}`;
}

/**
 * Creates a project backup as tar.gz
 */
async function createProjectBackup(userId, systemUsername, projectName, options = {}) {
    const {
        excludePatterns = DEFAULT_EXCLUDE_PATTERNS
    } = options;

    const projectPath = path.join(USERS_PATH, systemUsername, projectName);
    const backupDir = await ensureBackupDir(systemUsername);
    const filename = generateBackupFilename('project', projectName);
    const backupPath = path.join(backupDir, filename);

    // Verify project exists
    try {
        await fs.access(projectPath);
    } catch {
        throw new Error('Project not found');
    }

    // Create backup log entry
    const [result] = await pool.execute(
        `INSERT INTO backup_logs (user_id, backup_type, target_name, filename, status)
         VALUES (?, 'project', ?, ?, 'running')`,
        [userId, projectName, filename]
    );
    const backupId = result.insertId;

    const startTime = Date.now();

    try {
        // Build tar command with exclusions
        const excludeArgs = excludePatterns.flatMap(pattern => ['--exclude', pattern]);

        // Create tar.gz archive
        await new Promise((resolve, reject) => {
            const tar = spawn('tar', [
                '-czf', backupPath,
                ...excludeArgs,
                '-C', path.join(USERS_PATH, systemUsername),
                projectName
            ]);

            let stderr = '';
            tar.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            tar.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`tar failed with code ${code}: ${stderr}`));
                }
            });

            tar.on('error', reject);
        });

        // Get file size
        const stats = await fs.stat(backupPath);
        const duration = Date.now() - startTime;

        // Update backup log
        await pool.execute(
            `UPDATE backup_logs
             SET status = 'success', file_size = ?, duration_ms = ?
             WHERE id = ?`,
            [stats.size, duration, backupId]
        );

        logger.info('Project backup created', {
            userId,
            projectName,
            filename,
            size: stats.size,
            durationMs: duration
        });

        return {
            id: backupId,
            filename,
            path: backupPath,
            size: stats.size,
            durationMs: duration
        };

    } catch (error) {
        // Update backup log with error
        await pool.execute(
            `UPDATE backup_logs
             SET status = 'failed', error_message = ?, duration_ms = ?
             WHERE id = ?`,
            [error.message, Date.now() - startTime, backupId]
        );

        // Cleanup partial backup file
        try {
            await fs.unlink(backupPath);
        } catch {}

        logger.error('Project backup failed', {
            userId,
            projectName,
            error: error.message
        });

        throw error;
    }
}

/**
 * Creates a database backup as SQL dump
 */
async function createDatabaseBackup(userId, systemUsername, databaseName) {
    // Get database credentials
    const databases = await databaseService.getUserDatabases(systemUsername);
    const dbInfo = databases.find(db => db.database === databaseName);

    if (!dbInfo) {
        throw new Error('Database not found');
    }

    const backupDir = await ensureBackupDir(systemUsername);
    const filename = generateBackupFilename('database', databaseName, 'sql');
    const backupPath = path.join(backupDir, filename);

    // Create backup log entry
    const [result] = await pool.execute(
        `INSERT INTO backup_logs (user_id, backup_type, target_name, filename, status, metadata)
         VALUES (?, 'database', ?, ?, 'running', ?)`,
        [userId, databaseName, filename, JSON.stringify({ dbType: dbInfo.type })]
    );
    const backupId = result.insertId;

    const startTime = Date.now();

    try {
        // Get appropriate provider and dump database
        const provider = databaseService.getProvider(dbInfo.type);
        await provider.dumpDatabase(databaseName, dbInfo.username, dbInfo.password, backupPath);

        // Get file size
        const stats = await fs.stat(backupPath);
        const duration = Date.now() - startTime;

        // Update backup log
        await pool.execute(
            `UPDATE backup_logs
             SET status = 'success', file_size = ?, duration_ms = ?
             WHERE id = ?`,
            [stats.size, duration, backupId]
        );

        logger.info('Database backup created', {
            userId,
            databaseName,
            dbType: dbInfo.type,
            filename,
            size: stats.size,
            durationMs: duration
        });

        return {
            id: backupId,
            filename,
            path: backupPath,
            size: stats.size,
            durationMs: duration
        };

    } catch (error) {
        // Update backup log with error
        await pool.execute(
            `UPDATE backup_logs
             SET status = 'failed', error_message = ?, duration_ms = ?
             WHERE id = ?`,
            [error.message, Date.now() - startTime, backupId]
        );

        // Cleanup partial backup file
        try {
            await fs.unlink(backupPath);
        } catch {}

        logger.error('Database backup failed', {
            userId,
            databaseName,
            dbType: dbInfo.type,
            error: error.message
        });

        throw error;
    }
}

/**
 * Lists all backups for a user
 */
async function listBackups(userId, type = null, targetName = null) {
    let query = `
        SELECT id, backup_type, target_name, filename, file_size,
               status, error_message, duration_ms, created_at
        FROM backup_logs
        WHERE user_id = ?
    `;
    const params = [userId];

    if (type) {
        query += ' AND backup_type = ?';
        params.push(type);
    }

    if (targetName) {
        query += ' AND target_name = ?';
        params.push(targetName);
    }

    query += ' ORDER BY created_at DESC';

    const [rows] = await pool.execute(query, params);
    return rows;
}

/**
 * Gets a single backup by ID
 */
async function getBackupInfo(backupId) {
    const [rows] = await pool.execute(
        `SELECT bl.*, du.system_username
         FROM backup_logs bl
         JOIN dashboard_users du ON bl.user_id = du.id
         WHERE bl.id = ?`,
        [backupId]
    );
    return rows[0] || null;
}

/**
 * Gets the full path to a backup file
 */
function getBackupFilePath(systemUsername, filename) {
    return path.join(getBackupDir(systemUsername), filename);
}

/**
 * Checks if a backup file exists
 */
async function backupFileExists(systemUsername, filename) {
    const filePath = getBackupFilePath(systemUsername, filename);
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Deletes a backup (file and database record)
 */
async function deleteBackup(backupId, systemUsername) {
    // Get backup info first
    const backup = await getBackupInfo(backupId);
    if (!backup) {
        throw new Error('Backup not found');
    }

    // Delete file
    const filePath = getBackupFilePath(systemUsername, backup.filename);
    try {
        await fs.unlink(filePath);
    } catch (error) {
        // File may already be deleted
        logger.warn('Backup file not found during deletion', { filename: backup.filename });
    }

    // Delete database record
    await pool.execute('DELETE FROM backup_logs WHERE id = ?', [backupId]);

    logger.info('Backup deleted', {
        backupId,
        filename: backup.filename
    });

    return true;
}

/**
 * Gets backup statistics for a user
 */
async function getBackupStats(userId) {
    const [rows] = await pool.execute(
        `SELECT
            COUNT(*) as total_backups,
            SUM(CASE WHEN backup_type = 'project' THEN 1 ELSE 0 END) as project_backups,
            SUM(CASE WHEN backup_type = 'database' THEN 1 ELSE 0 END) as database_backups,
            SUM(file_size) as total_size,
            MAX(created_at) as last_backup
         FROM backup_logs
         WHERE user_id = ? AND status = 'success'`,
        [userId]
    );
    return rows[0];
}

/**
 * Gets recent backups for a specific project
 */
async function getProjectBackups(userId, projectName, limit = 5) {
    const [rows] = await pool.execute(
        `SELECT id, backup_type, filename, file_size, status, created_at
         FROM backup_logs
         WHERE user_id = ? AND target_name = ? AND backup_type = 'project'
         ORDER BY created_at DESC
         LIMIT ?`,
        [userId, projectName, limit]
    );
    return rows;
}

/**
 * Gets recent backups for specific databases
 * @param {number} userId - User ID
 * @param {string[]} databaseNames - Array of database names to get backups for
 * @param {number} limit - Max backups per database
 */
async function getDatabaseBackups(userId, databaseNames, limit = 3) {
    if (!databaseNames || databaseNames.length === 0) {
        return [];
    }

    // Create placeholders for IN clause
    const placeholders = databaseNames.map(() => '?').join(',');

    const [rows] = await pool.execute(
        `SELECT id, backup_type, target_name, filename, file_size, status, created_at
         FROM backup_logs
         WHERE user_id = ? AND target_name IN (${placeholders}) AND backup_type = 'database'
         ORDER BY created_at DESC
         LIMIT ?`,
        [userId, ...databaseNames, limit * databaseNames.length]
    );
    return rows;
}

/**
 * Formats file size for display
 */
function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Gets a preview of files in a project backup archive
 */
async function getBackupPreview(systemUsername, filename, limit = 100) {
    const backupPath = getBackupFilePath(systemUsername, filename);

    // Verify file exists
    try {
        await fs.access(backupPath);
    } catch {
        throw new Error('Backup file not found');
    }

    // List archive contents
    return new Promise((resolve, reject) => {
        const files = [];
        const tar = spawn('tar', ['-tzf', backupPath]);

        let stdout = '';
        tar.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        tar.on('close', (code) => {
            if (code === 0) {
                const allFiles = stdout.trim().split('\n').filter(f => f);
                resolve({
                    files: allFiles.slice(0, limit),
                    totalFiles: allFiles.length,
                    truncated: allFiles.length > limit
                });
            } else {
                reject(new Error('Failed to read archive'));
            }
        });

        tar.on('error', reject);
    });
}

/**
 * Restores a project from a backup archive
 * Overwrites existing project files
 */
async function restoreProjectBackup(systemUsername, backupId) {
    const backup = await getBackupInfo(backupId);

    if (!backup) {
        throw new Error('Backup not found');
    }

    if (backup.backup_type !== 'project') {
        throw new Error('Not a project backup');
    }

    const backupPath = getBackupFilePath(systemUsername, backup.filename);
    const projectPath = path.join(USERS_PATH, systemUsername, backup.target_name);

    // Verify backup file exists
    try {
        await fs.access(backupPath);
    } catch {
        throw new Error('Backup file not found');
    }

    // Verify project directory exists
    try {
        await fs.access(projectPath);
    } catch {
        throw new Error('Project not found');
    }

    logger.info('Restoring project backup', {
        backupId,
        projectName: backup.target_name,
        filename: backup.filename
    });

    // Extract archive, overwriting existing files
    // We extract to parent directory since archive contains project folder
    return new Promise((resolve, reject) => {
        const tar = spawn('tar', [
            '-xzf', backupPath,
            '-C', path.join(USERS_PATH, systemUsername),
            '--overwrite'
        ]);

        let stderr = '';
        tar.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        tar.on('close', (code) => {
            if (code === 0) {
                logger.info('Project backup restored', {
                    backupId,
                    projectName: backup.target_name
                });
                resolve({ success: true, projectName: backup.target_name });
            } else {
                logger.error('Project restore failed', {
                    backupId,
                    error: stderr
                });
                reject(new Error(`Restore failed: ${stderr}`));
            }
        });

        tar.on('error', reject);
    });
}

/**
 * Restores a database from a SQL backup
 */
async function restoreDatabaseBackup(systemUsername, backupId) {
    const backup = await getBackupInfo(backupId);

    if (!backup) {
        throw new Error('Backup not found');
    }

    if (backup.backup_type !== 'database') {
        throw new Error('Not a database backup');
    }

    const backupPath = getBackupFilePath(systemUsername, backup.filename);

    // Verify backup file exists
    try {
        await fs.access(backupPath);
    } catch {
        throw new Error('Backup file not found');
    }

    // Get database credentials
    const databases = await databaseService.getUserDatabases(systemUsername);
    const dbInfo = databases.find(db => db.database === backup.target_name);

    if (!dbInfo) {
        throw new Error('Database not found - cannot restore');
    }

    logger.info('Restoring database backup', {
        backupId,
        databaseName: backup.target_name,
        dbType: dbInfo.type
    });

    // Get appropriate provider and restore
    const provider = databaseService.getProvider(dbInfo.type);
    await provider.restoreDatabase(backup.target_name, dbInfo.username, dbInfo.password, backupPath);

    logger.info('Database backup restored', {
        backupId,
        databaseName: backup.target_name
    });

    return { success: true, databaseName: backup.target_name };
}

module.exports = {
    createProjectBackup,
    createDatabaseBackup,
    listBackups,
    getBackupInfo,
    getBackupFilePath,
    backupFileExists,
    deleteBackup,
    getBackupStats,
    getProjectBackups,
    getDatabaseBackups,
    formatFileSize,
    getBackupPreview,
    restoreProjectBackup,
    restoreDatabaseBackup,
    DEFAULT_EXCLUDE_PATTERNS
};
