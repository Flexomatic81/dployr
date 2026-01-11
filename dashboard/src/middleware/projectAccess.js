/**
 * Middleware for project access control
 * Central point for permission checking on projects
 */

const projectService = require('../services/project');
const sharingService = require('../services/sharing');
const { PERMISSION_LEVELS } = require('../config/constants');
const { logger } = require('../config/logger');

/**
 * Middleware: Check project access (own or shared project)
 * Sets req.projectAccess with permission information
 *
 * @param {string} paramName - Name of the URL parameter for the project name (default: 'name')
 */
function getProjectAccess(paramName = 'name') {
    return async (req, res, next) => {
        const projectName = req.params[paramName];
        const userId = req.session.user.id;
        const systemUsername = req.session.user.system_username;

        try {
            // 1. Check if own project
            const ownProject = await projectService.getProjectInfo(systemUsername, projectName);
            if (ownProject) {
                req.projectAccess = {
                    isOwner: true,
                    permission: 'owner',
                    project: ownProject,
                    systemUsername: systemUsername
                };
                return next();
            }

            // 2. Check if shared project
            const shareInfo = await sharingService.getShareInfoByProjectName(userId, projectName);
            if (shareInfo) {
                const sharedProject = await projectService.getProjectInfo(
                    shareInfo.owner_system_username,
                    projectName
                );
                if (sharedProject) {
                    req.projectAccess = {
                        isOwner: false,
                        permission: shareInfo.permission,
                        ownerSystemUsername: shareInfo.owner_system_username,
                        ownerUsername: shareInfo.owner_username,
                        ownerId: shareInfo.owner_id,
                        project: sharedProject,
                        systemUsername: shareInfo.owner_system_username
                    };
                    return next();
                }
            }

            // 3. No access
            req.flash('error', req.t('projects:errors.notFound'));
            return res.redirect('/projects');
        } catch (error) {
            logger.error('Error checking project access', {
                error: error.message,
                stack: error.stack,
                userId: req.session?.user?.id,
                projectName: req.params.name
            });
            req.flash('error', req.t('projects:errors.loadError'));
            return res.redirect('/projects');
        }
    };
}

/**
 * Check if user has at least the specified permission level
 * @param {string} minLevel - Minimum permission level ('read', 'manage', 'full')
 */
function requirePermission(minLevel) {
    return (req, res, next) => {
        const access = req.projectAccess;
        if (!access) {
            req.flash('error', req.t('projects:errors.noAccess'));
            return res.redirect('/projects');
        }

        // Owner always has all permissions
        if (access.isOwner) {
            return next();
        }

        const userLevel = PERMISSION_LEVELS[access.permission] || 0;
        const requiredLevel = PERMISSION_LEVELS[minLevel] || 0;

        if (userLevel >= requiredLevel) {
            return next();
        }

        req.flash('error', req.t('projects:errors.noPermission'));
        const projectName = req.params.name || req.params.projectName;
        return res.redirect(`/projects/${projectName}`);
    };
}

module.exports = {
    getProjectAccess,
    requirePermission,
    PERMISSION_LEVELS
};
