const bcrypt = require('bcrypt');
const { pool } = require('../config/database');

const SALT_ROUNDS = 10;

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
 */
async function createUser(username, password, systemUsername, isAdmin = false, approved = false) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const [result] = await pool.query(
        'INSERT INTO dashboard_users (username, password_hash, system_username, is_admin, approved) VALUES (?, ?, ?, ?, ?)',
        [username, passwordHash, systemUsername, isAdmin, approved]
    );

    return {
        id: result.insertId,
        username,
        system_username: systemUsername,
        is_admin: isAdmin,
        approved
    };
}

/**
 * Update user
 */
async function updateUser(id, { username, password, systemUsername, isAdmin }) {
    if (password) {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        await pool.query(
            'UPDATE dashboard_users SET username = ?, password_hash = ?, system_username = ?, is_admin = ? WHERE id = ?',
            [username, passwordHash, systemUsername, isAdmin, id]
        );
    } else {
        await pool.query(
            'UPDATE dashboard_users SET username = ?, system_username = ?, is_admin = ? WHERE id = ?',
            [username, systemUsername, isAdmin, id]
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
 * Get user language preference
 */
async function getUserLanguage(id) {
    const [result] = await pool.query(
        'SELECT language FROM dashboard_users WHERE id = ?',
        [id]
    );
    return result[0]?.language || 'de';
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
    getUserLanguage
};
