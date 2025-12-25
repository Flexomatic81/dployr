/**
 * Middleware für Projekt-Zugriffsprüfung
 * Zentrale Stelle für Berechtigungsprüfung bei Projekten
 */

const projectService = require('../services/project');
const sharingService = require('../services/sharing');
const { PERMISSION_LEVELS } = require('../config/constants');

/**
 * Middleware: Prüft Projekt-Zugriff (eigenes oder geteiltes Projekt)
 * Setzt req.projectAccess mit Berechtigungsinformationen
 *
 * @param {string} paramName - Name des URL-Parameters für den Projektnamen (default: 'name')
 */
function getProjectAccess(paramName = 'name') {
    return async (req, res, next) => {
        const projectName = req.params[paramName];
        const userId = req.session.user.id;
        const systemUsername = req.session.user.system_username;

        try {
            // 1. Prüfen ob eigenes Projekt
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

            // 2. Prüfen ob geteiltes Projekt
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

            // 3. Kein Zugriff
            req.flash('error', 'Projekt nicht gefunden');
            return res.redirect('/projects');
        } catch (error) {
            console.error('Fehler bei Projektzugriffsprüfung:', error);
            req.flash('error', 'Fehler beim Laden des Projekts');
            return res.redirect('/projects');
        }
    };
}

/**
 * Prüft ob User mindestens die angegebene Berechtigung hat
 * @param {string} minLevel - Mindestberechtigungsstufe ('read', 'manage', 'full')
 */
function requirePermission(minLevel) {
    return (req, res, next) => {
        const access = req.projectAccess;
        if (!access) {
            req.flash('error', 'Kein Zugriff');
            return res.redirect('/projects');
        }

        // Owner hat immer alle Rechte
        if (access.isOwner) {
            return next();
        }

        const userLevel = PERMISSION_LEVELS[access.permission] || 0;
        const requiredLevel = PERMISSION_LEVELS[minLevel] || 0;

        if (userLevel >= requiredLevel) {
            return next();
        }

        req.flash('error', 'Keine Berechtigung für diese Aktion');
        const projectName = req.params.name || req.params.projectName;
        return res.redirect(`/projects/${projectName}`);
    };
}

module.exports = {
    getProjectAccess,
    requirePermission,
    PERMISSION_LEVELS
};
