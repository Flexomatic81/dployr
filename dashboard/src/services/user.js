const bcrypt = require('bcrypt');
const { pool } = require('../config/database');

const SALT_ROUNDS = 10;

/**
 * Alle User abrufen
 */
async function getAllUsers() {
    const [users] = await pool.query(
        'SELECT id, username, system_username, is_admin, approved, created_at FROM dashboard_users ORDER BY created_at DESC'
    );
    return users;
}

/**
 * Alle ausstehenden User (nicht freigeschaltet) abrufen
 */
async function getPendingUsers() {
    const [users] = await pool.query(
        'SELECT id, username, system_username, created_at FROM dashboard_users WHERE approved = FALSE ORDER BY created_at ASC'
    );
    return users;
}

/**
 * Anzahl ausstehender Registrierungen
 */
async function getPendingCount() {
    const [result] = await pool.query(
        'SELECT COUNT(*) as count FROM dashboard_users WHERE approved = FALSE'
    );
    return result[0].count;
}

/**
 * User nach ID abrufen
 */
async function getUserById(id) {
    const [users] = await pool.query(
        'SELECT id, username, system_username, is_admin, approved, created_at FROM dashboard_users WHERE id = ?',
        [id]
    );
    return users[0] || null;
}

/**
 * User nach Username abrufen (für Login)
 */
async function getUserByUsername(username) {
    const [users] = await pool.query(
        'SELECT * FROM dashboard_users WHERE username = ?',
        [username]
    );
    return users[0] || null;
}

/**
 * Prüfen ob Username oder System-Username bereits existiert
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
 * Neuen User erstellen
 * @param {boolean} approved - Wenn true, wird User sofort freigeschaltet (Admin-Erstellung)
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
 * User aktualisieren
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
 * Nur Passwort aktualisieren
 */
async function updatePassword(id, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query(
        'UPDATE dashboard_users SET password_hash = ? WHERE id = ?',
        [passwordHash, id]
    );
}

/**
 * User löschen
 */
async function deleteUser(id) {
    await pool.query('DELETE FROM dashboard_users WHERE id = ?', [id]);
}

/**
 * Passwort verifizieren
 */
async function verifyPassword(user, password) {
    return bcrypt.compare(password, user.password_hash);
}

/**
 * Anzahl der Admins abrufen
 */
async function getAdminCount() {
    const [result] = await pool.query(
        'SELECT COUNT(*) as count FROM dashboard_users WHERE is_admin = TRUE'
    );
    return result[0].count;
}

/**
 * Anzahl aller User abrufen
 */
async function getUserCount() {
    const [result] = await pool.query(
        'SELECT COUNT(*) as count FROM dashboard_users'
    );
    return result[0].count;
}

/**
 * Prüfen ob User der letzte Admin ist
 */
async function isLastAdmin(userId) {
    const user = await getUserById(userId);
    if (!user || !user.is_admin) return false;

    const adminCount = await getAdminCount();
    return adminCount <= 1;
}

/**
 * User freischalten (Registrierung genehmigen)
 */
async function approveUser(id) {
    await pool.query(
        'UPDATE dashboard_users SET approved = TRUE WHERE id = ?',
        [id]
    );
    return getUserById(id);
}

/**
 * User-Registrierung ablehnen (User löschen)
 */
async function rejectUser(id) {
    // Nur nicht freigeschaltete User können abgelehnt werden
    const user = await getUserById(id);
    if (!user) {
        throw new Error('User nicht gefunden');
    }
    if (user.approved) {
        throw new Error('Bereits freigeschaltete User können nicht abgelehnt werden');
    }
    await pool.query('DELETE FROM dashboard_users WHERE id = ?', [id]);
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
    rejectUser
};
