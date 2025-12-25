const { pool } = require('../config/database');

// Berechtigungsstufen (aufsteigend)
const PERMISSION_LEVELS = {
    read: 1,
    manage: 2,
    full: 3
};

/**
 * Teilt ein Projekt mit einem anderen User
 */
async function shareProject(ownerId, ownerSystemUsername, projectName, sharedWithId, permission = 'read') {
    // Validierung: Kann nicht mit sich selbst teilen
    if (ownerId === sharedWithId) {
        throw new Error('Du kannst ein Projekt nicht mit dir selbst teilen');
    }

    // Validierung: Berechtigung muss gültig sein
    if (!PERMISSION_LEVELS[permission]) {
        throw new Error('Ungültige Berechtigung');
    }

    const [result] = await pool.execute(
        `INSERT INTO project_shares (owner_id, owner_system_username, project_name, shared_with_id, permission)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE permission = ?, created_at = CURRENT_TIMESTAMP`,
        [ownerId, ownerSystemUsername, projectName, sharedWithId, permission, permission]
    );

    return result;
}

/**
 * Entfernt eine Projekt-Freigabe
 */
async function unshareProject(ownerId, projectName, sharedWithId) {
    const [result] = await pool.execute(
        `DELETE FROM project_shares
         WHERE owner_id = ? AND project_name = ? AND shared_with_id = ?`,
        [ownerId, projectName, sharedWithId]
    );
    return result.affectedRows > 0;
}

/**
 * Aktualisiert die Berechtigung einer Freigabe
 */
async function updateSharePermission(ownerId, projectName, sharedWithId, newPermission) {
    if (!PERMISSION_LEVELS[newPermission]) {
        throw new Error('Ungültige Berechtigung');
    }

    const [result] = await pool.execute(
        `UPDATE project_shares SET permission = ?
         WHERE owner_id = ? AND project_name = ? AND shared_with_id = ?`,
        [newPermission, ownerId, projectName, sharedWithId]
    );
    return result.affectedRows > 0;
}

/**
 * Holt alle Freigaben für ein Projekt (für Besitzer-Ansicht)
 */
async function getProjectShares(ownerId, projectName) {
    const [rows] = await pool.execute(
        `SELECT ps.*, du.username, du.system_username as shared_system_username
         FROM project_shares ps
         JOIN dashboard_users du ON ps.shared_with_id = du.id
         WHERE ps.owner_id = ? AND ps.project_name = ?
         ORDER BY ps.created_at DESC`,
        [ownerId, projectName]
    );
    return rows;
}

/**
 * Holt alle mit einem User geteilten Projekte
 */
async function getSharedProjects(userId) {
    const [rows] = await pool.execute(
        `SELECT ps.*, du.username as owner_username
         FROM project_shares ps
         JOIN dashboard_users du ON ps.owner_id = du.id
         WHERE ps.shared_with_id = ?
         ORDER BY ps.created_at DESC`,
        [userId]
    );
    return rows;
}

/**
 * Prüft ob ein User die erforderliche Berechtigung für ein geteiltes Projekt hat
 */
async function hasPermission(userId, ownerSystemUsername, projectName, requiredLevel) {
    const shareInfo = await getShareInfo(userId, ownerSystemUsername, projectName);

    if (!shareInfo) {
        return false;
    }

    const userLevel = PERMISSION_LEVELS[shareInfo.permission] || 0;
    const requiredLevelNum = PERMISSION_LEVELS[requiredLevel] || 0;

    return userLevel >= requiredLevelNum;
}

/**
 * Holt die Freigabe-Informationen für einen User und ein Projekt
 */
async function getShareInfo(userId, ownerSystemUsername, projectName) {
    const [rows] = await pool.execute(
        `SELECT ps.*, du.username as owner_username
         FROM project_shares ps
         JOIN dashboard_users du ON ps.owner_id = du.id
         WHERE ps.shared_with_id = ?
         AND ps.owner_system_username = ?
         AND ps.project_name = ?`,
        [userId, ownerSystemUsername, projectName]
    );
    return rows[0] || null;
}

/**
 * Holt die Freigabe-Informationen nur mit Projekt-Name (sucht über alle Owner)
 */
async function getShareInfoByProjectName(userId, projectName) {
    const [rows] = await pool.execute(
        `SELECT ps.*, du.username as owner_username
         FROM project_shares ps
         JOIN dashboard_users du ON ps.owner_id = du.id
         WHERE ps.shared_with_id = ?
         AND ps.project_name = ?`,
        [userId, projectName]
    );
    return rows[0] || null;
}

/**
 * Holt alle User (für Dropdown, exklusive eines bestimmten Users)
 */
async function getAllUsersExcept(excludeUserId) {
    const [rows] = await pool.execute(
        `SELECT id, username, system_username
         FROM dashboard_users
         WHERE id != ? AND approved = TRUE
         ORDER BY username`,
        [excludeUserId]
    );
    return rows;
}

/**
 * Löscht alle Freigaben für ein Projekt (wenn Projekt gelöscht wird)
 */
async function deleteAllSharesForProject(ownerId, projectName) {
    const [result] = await pool.execute(
        `DELETE FROM project_shares WHERE owner_id = ? AND project_name = ?`,
        [ownerId, projectName]
    );
    return result.affectedRows;
}

/**
 * Gibt die menschenlesbare Bezeichnung für eine Berechtigung zurück
 */
function getPermissionLabel(permission) {
    const labels = {
        read: 'Ansehen',
        manage: 'Verwalten',
        full: 'Vollzugriff'
    };
    return labels[permission] || permission;
}

/**
 * Gibt das Icon für eine Berechtigung zurück
 */
function getPermissionIcon(permission) {
    const icons = {
        read: 'bi-eye',
        manage: 'bi-gear',
        full: 'bi-star'
    };
    return icons[permission] || 'bi-question';
}

module.exports = {
    PERMISSION_LEVELS,
    shareProject,
    unshareProject,
    updateSharePermission,
    getProjectShares,
    getSharedProjects,
    hasPermission,
    getShareInfo,
    getShareInfoByProjectName,
    getAllUsersExcept,
    deleteAllSharesForProject,
    getPermissionLabel,
    getPermissionIcon
};
