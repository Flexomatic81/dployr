const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const projectService = require('../services/project');
const dockerService = require('../services/docker');
const sharingService = require('../services/sharing');

/**
 * Middleware: Prüft Projekt-Zugriff für Logs (eigenes oder geteiltes Projekt)
 * Alle Berechtigungsstufen (read, manage, full) dürfen Logs sehen
 */
async function getProjectAccessForLogs(req, res, next) {
    const { projectName } = req.params;
    const userId = req.session.user.id;
    const systemUsername = req.session.user.system_username;

    try {
        // 1. Prüfen ob eigenes Projekt
        const ownProject = await projectService.getProjectInfo(systemUsername, projectName);
        if (ownProject) {
            req.projectAccess = {
                isOwner: true,
                project: ownProject,
                systemUsername: systemUsername
            };
            return next();
        }

        // 2. Prüfen ob geteiltes Projekt (alle Berechtigungen erlauben Logs)
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
        console.error('Fehler bei Projektzugriffsprüfung für Logs:', error);
        req.flash('error', 'Fehler beim Laden der Logs');
        return res.redirect('/projects');
    }
}

// Logs für ein Projekt anzeigen
router.get('/:projectName', requireAuth, getProjectAccessForLogs, async (req, res) => {
    try {
        const project = req.projectAccess.project;

        // Logs für alle Container des Projekts sammeln
        const containerLogs = [];

        for (const container of project.containers) {
            const logs = await dockerService.getContainerLogs(container.Id, 200);
            containerLogs.push({
                name: container.Names[0].replace('/', ''),
                state: container.State,
                logs
            });
        }

        res.render('logs', {
            title: `Logs - ${project.name}`,
            project,
            containerLogs,
            lines: 200,
            projectAccess: req.projectAccess
        });
    } catch (error) {
        console.error('Fehler beim Laden der Logs:', error);
        req.flash('error', 'Fehler beim Laden der Logs');
        res.redirect('/projects');
    }
});

// API: Logs als JSON abrufen (für Auto-Refresh)
router.get('/:projectName/api', requireAuth, getProjectAccessForLogs, async (req, res) => {
    try {
        const project = req.projectAccess.project;
        const lines = parseInt(req.query.lines) || 100;
        const containerLogs = [];

        for (const container of project.containers) {
            const logs = await dockerService.getContainerLogs(container.Id, lines);
            containerLogs.push({
                name: container.Names[0].replace('/', ''),
                state: container.State,
                logs
            });
        }

        res.json({ containerLogs });
    } catch (error) {
        console.error('API Log-Fehler:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
