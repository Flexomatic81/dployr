/**
 * Middleware for workspace access control
 * Based on project access control
 */

const workspaceService = require('../services/workspace');
const { getProjectAccess, requirePermission } = require('./projectAccess');
const { logger } = require('../config/logger');

/**
 * Middleware: Check workspace access
 * Combines project access check with workspace existence check
 *
 * @param {string} paramName - Name of the URL parameter for the project name (default: 'projectName')
 */
function getWorkspaceAccess(paramName = 'projectName') {
    return [
        // First check project access
        getProjectAccess(paramName),
        // Then load workspace
        async (req, res, next) => {
            try {
                const projectName = req.params[paramName];
                const userId = req.session.user.id;

                const workspace = await workspaceService.getWorkspace(userId, projectName);
                req.workspace = workspace; // Can be null if workspace doesn't exist

                next();
            } catch (error) {
                logger.error('Error checking workspace access', { error: error.message });
                req.flash('error', req.t('workspaces:errors.loadError'));
                return res.redirect('/workspaces');
            }
        }
    ];
}

/**
 * Require workspace to exist
 */
function requireWorkspace(req, res, next) {
    if (!req.workspace) {
        req.flash('error', req.t('workspaces:errors.notFound'));
        return res.redirect(`/projects/${req.params.projectName || req.params.name}`);
    }
    next();
}

/**
 * Require workspace to be running
 */
function requireRunningWorkspace(req, res, next) {
    if (!req.workspace || req.workspace.status !== 'running') {
        req.flash('error', req.t('workspaces:errors.notRunning'));
        return res.redirect(`/workspaces/${req.params.projectName}`);
    }
    next();
}

/**
 * Require workspace permission (at least 'manage')
 * Shared users with 'read' permission cannot use workspaces
 */
function requireWorkspacePermission(req, res, next) {
    const access = req.projectAccess;

    // Owner always has access
    if (access.isOwner) {
        return next();
    }

    // Shared: require at least 'manage' permission
    if (access.permission === 'manage' || access.permission === 'full') {
        return next();
    }

    req.flash('error', req.t('workspaces:errors.noPermission'));
    return res.redirect(`/projects/${req.params.projectName || req.params.name}`);
}

module.exports = {
    getWorkspaceAccess,
    requireWorkspace,
    requireRunningWorkspace,
    requireWorkspacePermission
};
