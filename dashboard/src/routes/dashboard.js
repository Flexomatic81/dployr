const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const projectService = require('../services/project');
const databaseService = require('../services/database');
const userService = require('../services/user');
const sharingService = require('../services/sharing');

// Dashboard Hauptseite
router.get('/', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const userId = req.session.user.id;
        const isAdmin = req.session.user.is_admin;

        // Eigene Projekte laden
        const projects = await projectService.getUserProjects(systemUsername);

        // Geteilte Projekte laden
        const sharedProjectInfos = await sharingService.getSharedProjects(userId);
        const sharedProjects = [];

        for (const share of sharedProjectInfos) {
            const project = await projectService.getProjectInfo(share.owner_system_username, share.project_name);
            if (project) {
                project.shareInfo = {
                    permission: share.permission,
                    permissionLabel: sharingService.getPermissionLabel(share.permission),
                    permissionIcon: sharingService.getPermissionIcon(share.permission),
                    ownerUsername: share.owner_username
                };
                sharedProjects.push(project);
            }
        }

        // Datenbanken laden
        const databases = await databaseService.getUserDatabases(systemUsername);

        // Statistiken berechnen (inkl. geteilte Projekte)
        const allProjects = [...projects, ...sharedProjects];
        const stats = {
            totalProjects: projects.length,
            sharedProjects: sharedProjects.length,
            runningProjects: allProjects.filter(p => p.status === 'running').length,
            stoppedProjects: allProjects.filter(p => p.status === 'stopped').length,
            totalDatabases: databases.length
        };

        // Für Admins: Anzahl ausstehender Registrierungen
        const pendingUsersCount = isAdmin ? await userService.getPendingCount() : 0;

        res.render('dashboard', {
            title: 'Dashboard',
            projects,
            sharedProjects,
            databases,
            stats,
            pendingUsersCount
        });
    } catch (error) {
        console.error('Dashboard-Fehler:', error);
        req.flash('error', 'Fehler beim Laden des Dashboards');
        res.render('dashboard', {
            title: 'Dashboard',
            projects: [],
            sharedProjects: [],
            databases: [],
            stats: { totalProjects: 0, sharedProjects: 0, runningProjects: 0, stoppedProjects: 0, totalDatabases: 0 },
            pendingUsersCount: 0
        });
    }
});

module.exports = router;
