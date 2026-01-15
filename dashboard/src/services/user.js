const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../config/database');

const SALT_ROUNDS = 10;

/**
 * Generate a secure random token (64 character hex string)
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Get all users
 */
async function getAllUsers() {
    const [users] = await pool.query(
        'SELECT id, username, system_username, is_admin, approved, created_at FROM dashboard_users ORDER BY created_at DESC'
    );
    return users;
}

/**
 * Get all pending users (not approved)
 */
async function getPendingUsers() {
    const [users] = await pool.query(
        'SELECT id, username, system_username, created_at FROM dashboard_users WHERE approved = FALSE ORDER BY created_at ASC'
    );
    return users;
}

/**
 * Get count of pending registrations
 */
async function getPendingCount() {
    const [result] = await pool.query(
        'SELECT COUNT(*) as count FROM dashboard_users WHERE approved = FALSE'
    );
    return result[0].count;
}

/**
 * Get user by ID
 */
async function getUserById(id) {
    const [users] = await pool.query(
        'SELECT id, username, system_username, is_admin, approved, created_at FROM dashboard_users WHERE id = ?',
        [id]
    );
    return users[0] || null;
}

/**
 * Get user by username (for login)
 */
async function getUserByUsername(username) {
    const [users] = await pool.query(
        'SELECT * FROM dashboard_users WHERE username = ?',
        [username]
    );
    return users[0] || null;
}

/**
 * Check if username or system username already exists
 */
async function existsUsernameOrSystemUsername(username, systemUsername, excludeId = null) {
    let query = 'SELECT id FROM dashboard_users WHERE (username = ? OR system_username = ?)';
    const params = [username, systemUsername];

    if (excludeId) {
        query += ' AND id != ?';
        params.push(excludeId);
    }

    const [existing] = await pool.query(query, params);
    return existing.length > 0;
}

/**
 * Create new user
 * @param {boolean} approved - If true, user is immediately approved (admin creation)
 * @param {string} email - Optional email address
 */
async function createUser(username, password, systemUsername, isAdmin = false, approved = false, email = null) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Generate verification token if email provided
    const verificationToken = email ? generateToken() : null;
    const verificationExpires = email ? new Date(Date.now() + (parseInt(process.env.EMAIL_VERIFICATION_EXPIRES) || 24) * 60 * 60 * 1000) : null;

    const [result] = await pool.query(
        `INSERT INTO dashboard_users
         (username, password_hash, system_username, is_admin, approved, email, verification_token, verification_token_expires)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [username, passwordHash, systemUsername, isAdmin, approved, email, verificationToken, verificationExpires]
    );

    return {
        id: result.insertId,
        username,
        system_username: systemUsername,
        is_admin: isAdmin,
        approved,
        email,
        verificationToken
    };
}

/**
 * Update user
 */
async function updateUser(id, { username, password, systemUsername, isAdmin, email }) {
    if (password) {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        await pool.query(
            'UPDATE dashboard_users SET username = ?, password_hash = ?, system_username = ?, is_admin = ?, email = ? WHERE id = ?',
            [username, passwordHash, systemUsername, isAdmin, email, id]
        );
    } else {
        await pool.query(
            'UPDATE dashboard_users SET username = ?, system_username = ?, is_admin = ?, email = ? WHERE id = ?',
            [username, systemUsername, isAdmin, email, id]
        );
    }

    return getUserById(id);
}

/**
 * Update password only
 */
async function updatePassword(id, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query(
        'UPDATE dashboard_users SET password_hash = ? WHERE id = ?',
        [passwordHash, id]
    );
}

/**
 * Delete user
 */
async function deleteUser(id) {
    await pool.query('DELETE FROM dashboard_users WHERE id = ?', [id]);
}

/**
 * Verify password
 */
async function verifyPassword(user, password) {
    return bcrypt.compare(password, user.password_hash);
}

/**
 * Get admin count
 */
async function getAdminCount() {
    const [result] = await pool.query(
        'SELECT COUNT(*) as count FROM dashboard_users WHERE is_admin = TRUE'
    );
    return result[0].count;
}

/**
 * Get total user count
 */
async function getUserCount() {
    const [result] = await pool.query(
        'SELECT COUNT(*) as count FROM dashboard_users'
    );
    return result[0].count;
}

/**
 * Check if user is the last admin
 */
async function isLastAdmin(userId) {
    const user = await getUserById(userId);
    if (!user || !user.is_admin) return false;

    const adminCount = await getAdminCount();
    return adminCount <= 1;
}

/**
 * Approve user (approve registration)
 */
async function approveUser(id) {
    await pool.query(
        'UPDATE dashboard_users SET approved = TRUE WHERE id = ?',
        [id]
    );
    return getUserById(id);
}

/**
 * Reject user registration (delete user)
 */
async function rejectUser(id) {
    // Only non-approved users can be rejected
    const user = await getUserById(id);
    if (!user) {
        throw new Error('User not found');
    }
    if (user.approved) {
        throw new Error('Already approved users cannot be rejected');
    }
    await pool.query('DELETE FROM dashboard_users WHERE id = ?', [id]);
}

/**
 * Update user language preference
 */
async function updateUserLanguage(id, language) {
    const supportedLanguages = ['de', 'en'];
    if (!supportedLanguages.includes(language)) {
        throw new Error('Unsupported language');
    }
    await pool.query(
        'UPDATE dashboard_users SET language = ? WHERE id = ?',
        [language, id]
    );
}

/**
 * Get default language from setup marker
 */
async function getDefaultLanguage() {
    try {
        const fs = require('fs').promises;
        const setupContent = await fs.readFile('/app/infrastructure/.setup-complete', 'utf8');
        const setupData = JSON.parse(setupContent);
        return setupData.defaultLanguage || 'de';
    } catch {
        return 'de';
    }
}

/**
 * Get user language preference
 */
async function getUserLanguage(id) {
    const [result] = await pool.query(
        'SELECT language FROM dashboard_users WHERE id = ?',
        [id]
    );
    // Return user's language if set, otherwise use default from setup
    if (result[0]?.language) {
        return result[0].language;
    }
    return await getDefaultLanguage();
}

// ============================================
// Email and Token Functions
// ============================================

/**
 * Get user by email address
 */
async function getUserByEmail(email) {
    const [users] = await pool.query(
        'SELECT * FROM dashboard_users WHERE email = ?',
        [email]
    );
    return users[0] || null;
}

/**
 * Check if email already exists
 * @param {string} email - Email to check
 * @param {number} excludeId - User ID to exclude from check (for updates)
 */
async function emailExists(email, excludeId = null) {
    let query = 'SELECT id FROM dashboard_users WHERE email = ?';
    const params = [email];

    if (excludeId) {
        query += ' AND id != ?';
        params.push(excludeId);
    }

    const [existing] = await pool.query(query, params);
    return existing.length > 0;
}

/**
 * Get user by verification token
 */
async function getUserByVerificationToken(token) {
    const [users] = await pool.query(
        'SELECT * FROM dashboard_users WHERE verification_token = ? AND verification_token_expires > NOW()',
        [token]
    );
    return users[0] || null;
}

/**
 * Get user by password reset token
 */
async function getUserByResetToken(token) {
    const [users] = await pool.query(
        'SELECT * FROM dashboard_users WHERE reset_token = ? AND reset_token_expires > NOW()',
        [token]
    );
    return users[0] || null;
}

/**
 * Verify email address (mark as verified and clear token)
 */
async function verifyEmail(userId) {
    await pool.query(
        'UPDATE dashboard_users SET email_verified = TRUE, verification_token = NULL, verification_token_expires = NULL WHERE id = ?',
        [userId]
    );
}

/**
 * Create password reset token
 * @returns {string} The reset token
 */
async function createResetToken(userId) {
    const token = generateToken();
    const expires = new Date(Date.now() + (parseInt(process.env.EMAIL_RESET_EXPIRES) || 1) * 60 * 60 * 1000);

    await pool.query(
        'UPDATE dashboard_users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
        [token, expires, userId]
    );

    return token;
}

/**
 * Clear password reset token (after use)
 */
async function clearResetToken(userId) {
    await pool.query(
        'UPDATE dashboard_users SET reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
        [userId]
    );
}

/**
 * Update user email and generate new verification token
 * @returns {string} The verification token
 */
async function updateEmail(userId, email) {
    const verificationToken = generateToken();
    const verificationExpires = new Date(Date.now() + (parseInt(process.env.EMAIL_VERIFICATION_EXPIRES) || 24) * 60 * 60 * 1000);

    await pool.query(
        'UPDATE dashboard_users SET email = ?, email_verified = FALSE, verification_token = ?, verification_token_expires = ? WHERE id = ?',
        [email, verificationToken, verificationExpires, userId]
    );

    return verificationToken;
}

/**
 * Get full user by ID (including email fields)
 */
async function getFullUserById(id) {
    const [users] = await pool.query(
        'SELECT id, username, system_username, is_admin, approved, email, email_verified, notify_deploy_success, notify_deploy_failure, notify_autodeploy, created_at FROM dashboard_users WHERE id = ?',
        [id]
    );
    return users[0] || null;
}

/**
 * Get user notification preferences
 */
async function getNotificationPreferences(userId) {
    const [users] = await pool.query(
        'SELECT email, email_verified, notify_deploy_success, notify_deploy_failure, notify_autodeploy FROM dashboard_users WHERE id = ?',
        [userId]
    );
    if (!users[0]) return null;

    // Default to true if columns don't exist yet (migration not run)
    return {
        email: users[0].email,
        emailVerified: users[0].email_verified,
        deploySuccess: users[0].notify_deploy_success ?? true,
        deployFailure: users[0].notify_deploy_failure ?? true,
        autodeploy: users[0].notify_autodeploy ?? true
    };
}

/**
 * Update user notification preferences
 */
async function updateNotificationPreferences(userId, { deploySuccess, deployFailure, autodeploy }) {
    await pool.query(
        'UPDATE dashboard_users SET notify_deploy_success = ?, notify_deploy_failure = ?, notify_autodeploy = ? WHERE id = ?',
        [deploySuccess, deployFailure, autodeploy, userId]
    );
}

// ============================================
// Two-Factor Authentication (TOTP) Functions
// ============================================

/**
 * Get TOTP settings for user
 * @returns {{secret: string|null, enabled: boolean, backupCodes: string[]|null}}
 */
async function getTotpSettings(userId) {
    const [users] = await pool.query(
        'SELECT totp_secret, totp_enabled, totp_backup_codes FROM dashboard_users WHERE id = ?',
        [userId]
    );
    if (!users[0]) return null;

    let backupCodes = null;
    if (users[0].totp_backup_codes) {
        try {
            backupCodes = JSON.parse(users[0].totp_backup_codes);
        } catch {
            backupCodes = null;
        }
    }

    return {
        secret: users[0].totp_secret,
        enabled: users[0].totp_enabled === 1 || users[0].totp_enabled === true,
        backupCodes
    };
}

/**
 * Save TOTP secret during setup (before enabling)
 */
async function saveTotpSecret(userId, secret) {
    await pool.query(
        'UPDATE dashboard_users SET totp_secret = ? WHERE id = ?',
        [secret, userId]
    );
}

/**
 * Enable TOTP for user with backup codes
 * @param {number} userId - User ID
 * @param {string[]} hashedBackupCodes - Array of bcrypt hashes
 */
async function enableTotp(userId, hashedBackupCodes) {
    const backupCodesJson = JSON.stringify(hashedBackupCodes);
    await pool.query(
        'UPDATE dashboard_users SET totp_enabled = TRUE, totp_backup_codes = ? WHERE id = ?',
        [backupCodesJson, userId]
    );
}

/**
 * Disable TOTP for user
 */
async function disableTotp(userId) {
    await pool.query(
        'UPDATE dashboard_users SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = NULL WHERE id = ?',
        [userId]
    );
}

/**
 * Update backup codes (after one is used)
 * @param {number} userId - User ID
 * @param {string[]} hashedBackupCodes - Updated array of bcrypt hashes
 */
async function updateBackupCodes(userId, hashedBackupCodes) {
    const backupCodesJson = JSON.stringify(hashedBackupCodes);
    await pool.query(
        'UPDATE dashboard_users SET totp_backup_codes = ? WHERE id = ?',
        [backupCodesJson, userId]
    );
}

/**
 * Check if 2FA is required (from environment or settings)
 */
function isTwoFaRequired() {
    return process.env.REQUIRE_2FA === 'true';
}

module.exports = {
    getAllUsers,
    getPendingUsers,
    getPendingCount,
    getUserById,
    getUserByUsername,
    existsUsernameOrSystemUsername,
    createUser,
    updateUser,
    updatePassword,
    deleteUser,
    verifyPassword,
    getAdminCount,
    getUserCount,
    isLastAdmin,
    approveUser,
    rejectUser,
    updateUserLanguage,
    getUserLanguage,
    // Email and token functions
    getUserByEmail,
    emailExists,
    getUserByVerificationToken,
    getUserByResetToken,
    verifyEmail,
    createResetToken,
    clearResetToken,
    updateEmail,
    getFullUserById,
    // Notification preferences
    getNotificationPreferences,
    updateNotificationPreferences,
    // Two-Factor Authentication
    getTotpSettings,
    saveTotpSecret,
    enableTotp,
    disableTotp,
    updateBackupCodes,
    isTwoFaRequired
};
