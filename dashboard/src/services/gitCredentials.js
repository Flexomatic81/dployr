/**
 * Git Credentials Service
 *
 * Responsible for:
 * - Secure storage of Git access tokens (encrypted in database)
 * - Temporary credential provisioning for Git operations
 * - Migration of existing plaintext credentials
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { encrypt, decrypt } = require('./encryption');
const { logger } = require('../config/logger');

const SESSION_SECRET = process.env.SESSION_SECRET;

/**
 * Saves Git credentials encrypted in the database
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @param {string} repoUrl - Repository URL (without token)
 * @param {string} token - Access token to encrypt
 */
async function saveCredentials(userId, projectName, repoUrl, token) {
    if (!token) {
        // No token - just store the repo URL
        await pool.execute(
            `INSERT INTO git_credentials (user_id, project_name, repo_url)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE repo_url = ?, updated_at = CURRENT_TIMESTAMP`,
            [userId, projectName, repoUrl, repoUrl]
        );
        return;
    }

    // Encrypt the token
    const { encrypted, iv } = encrypt(token, SESSION_SECRET);

    await pool.execute(
        `INSERT INTO git_credentials (user_id, project_name, repo_url, token_encrypted, token_iv)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            repo_url = ?,
            token_encrypted = ?,
            token_iv = ?,
            updated_at = CURRENT_TIMESTAMP`,
        [userId, projectName, repoUrl, encrypted, iv, repoUrl, encrypted, iv]
    );

    logger.debug('Git credentials saved (encrypted)', { userId, projectName });
}

/**
 * Gets decrypted Git credentials from the database
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @returns {Promise<{repoUrl: string, token: string|null}|null>}
 */
async function getCredentials(userId, projectName) {
    const [rows] = await pool.execute(
        `SELECT repo_url, token_encrypted, token_iv
         FROM git_credentials
         WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );

    if (rows.length === 0) {
        return null;
    }

    const row = rows[0];
    let token = null;

    if (row.token_encrypted && row.token_iv) {
        try {
            token = decrypt(row.token_encrypted, row.token_iv, SESSION_SECRET);
        } catch (error) {
            logger.error('Failed to decrypt Git token', { userId, projectName, error: error.message });
        }
    }

    return {
        repoUrl: row.repo_url,
        token
    };
}

/**
 * Deletes Git credentials for a project
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 */
async function deleteCredentials(userId, projectName) {
    await pool.execute(
        `DELETE FROM git_credentials WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );
    logger.debug('Git credentials deleted', { userId, projectName });
}

/**
 * Writes temporary .git-credentials file for a Git operation
 * Returns a cleanup function to remove the file after use
 * @param {string} gitPath - Path to the Git repository
 * @param {string} repoUrl - Repository URL
 * @param {string} token - Access token
 * @returns {Function} Cleanup function
 */
function writeTemporaryCredentials(gitPath, repoUrl, token) {
    const credentialsPath = path.join(gitPath, '.git-credentials');

    if (!token) {
        // No token - nothing to write
        return () => {};
    }

    try {
        const url = new URL(repoUrl);
        const credentialLine = `https://${token}@${url.host}${url.pathname}`;
        fs.writeFileSync(credentialsPath, credentialLine + '\n', { mode: 0o600 });
    } catch (error) {
        logger.error('Failed to write temporary credentials', { error: error.message });
    }

    // Return cleanup function
    return () => {
        try {
            if (fs.existsSync(credentialsPath)) {
                // Overwrite with empty content before deletion (security)
                fs.writeFileSync(credentialsPath, '', { mode: 0o600 });
                fs.unlinkSync(credentialsPath);
            }
        } catch (error) {
            logger.warn('Failed to cleanup temporary credentials', { error: error.message });
        }
    };
}

/**
 * Executes a Git operation with temporary credentials
 * Credentials are written before and cleaned up after the operation
 * @param {string} gitPath - Path to the Git repository
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @param {Function} operation - Async function to execute
 * @returns {Promise<any>} Result of the operation
 */
async function withCredentials(gitPath, userId, projectName, operation) {
    const creds = await getCredentials(userId, projectName);

    if (!creds || !creds.token) {
        // No stored credentials - just run the operation
        return operation();
    }

    const cleanup = writeTemporaryCredentials(gitPath, creds.repoUrl, creds.token);

    try {
        return await operation();
    } finally {
        cleanup();
    }
}

/**
 * Migrates existing .git-credentials file to encrypted database storage
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @param {string} gitPath - Path to the Git repository
 * @returns {Promise<boolean>} True if migration was successful
 */
async function migrateFromFile(userId, projectName, gitPath) {
    const credentialsPath = path.join(gitPath, '.git-credentials');

    if (!fs.existsSync(credentialsPath)) {
        return false;
    }

    try {
        const content = fs.readFileSync(credentialsPath, 'utf8').trim();

        // Parse: https://TOKEN@github.com/user/repo
        const match = content.match(/https:\/\/([^@]+)@([^/]+)(\/.*)?/);
        if (!match) {
            return false;
        }

        const token = match[1];
        const host = match[2];
        const pathname = match[3] || '';
        const repoUrl = `https://${host}${pathname}`;

        // Save encrypted in database
        await saveCredentials(userId, projectName, repoUrl, token);

        // Remove plaintext file
        fs.writeFileSync(credentialsPath, '', { mode: 0o600 });
        fs.unlinkSync(credentialsPath);

        logger.info('Git credentials migrated to encrypted storage', { userId, projectName });
        return true;
    } catch (error) {
        logger.error('Failed to migrate Git credentials', { userId, projectName, error: error.message });
        return false;
    }
}

/**
 * Checks if credentials exist for a project (in DB or file)
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @param {string} gitPath - Path to the Git repository
 * @returns {Promise<boolean>}
 */
async function hasCredentials(userId, projectName, gitPath) {
    // Check database first
    const dbCreds = await getCredentials(userId, projectName);
    if (dbCreds && dbCreds.token) {
        return true;
    }

    // Check file (legacy)
    const credentialsPath = path.join(gitPath, '.git-credentials');
    return fs.existsSync(credentialsPath);
}

module.exports = {
    saveCredentials,
    getCredentials,
    deleteCredentials,
    writeTemporaryCredentials,
    withCredentials,
    migrateFromFile,
    hasCredentials
};
