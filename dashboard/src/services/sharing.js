const { pool } = require('../config/database');
const { PERMISSION_LEVELS } = require('../config/constants');

/**
 * Share a project with another user
 */
async function shareProject(ownerId, ownerSystemUsername, projectName, sharedWithId, permission = 'read') {
    // Validation: Cannot share with yourself
    if (ownerId === sharedWithId) {
        throw new Error('You cannot share a project with yourself');
    }

    // Validation: Permission must be valid
    if (!PERMISSION_LEVELS[permission]) {
        throw new Error('Invalid permission');
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
 * Remove a project share
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
 * Update share permission
 */
async function updateSharePermission(ownerId, projectName, sharedWithId, newPermission) {
    if (!PERMISSION_LEVELS[newPermission]) {
        throw new Error('Invalid permission');
    }

    const [result] = await pool.execute(
        `UPDATE project_shares SET permission = ?
         WHERE owner_id = ? AND project_name = ? AND shared_with_id = ?`,
        [newPermission, ownerId, projectName, sharedWithId]
    );
    return result.affectedRows > 0;
}

/**
 * Get all shares for a project (for owner view)
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
 * Get all projects shared with a user
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
 * Check if user has required permission for a shared project
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
 * Get share information for a user and project
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
 * Get share information by project name only (searches across all owners)
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
 * Get all users (for dropdown, excluding a specific user)
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
 * Delete all shares for a project (when project is deleted)
 */
async function deleteAllSharesForProject(ownerId, projectName) {
    const [result] = await pool.execute(
        `DELETE FROM project_shares WHERE owner_id = ? AND project_name = ?`,
        [ownerId, projectName]
    );
    return result.affectedRows;
}

/**
 * Get human-readable label for a permission
 */
function getPermissionLabel(permission) {
    const labels = {
        read: 'View',
        manage: 'Manage',
        full: 'Full access'
    };
    return labels[permission] || permission;
}

/**
 * Get icon for a permission
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
