const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const projectService = require('../services/project');
const databaseService = require('../services/database');
const userService = require('../services/user');
const sharingService = require('../services/sharing');
const { logger } = require('../config/logger');

// Dashboard main page
router.get('/', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const userId = req.session.user.id;
        const isAdmin = req.session.user.is_admin;

        // Load own projects
        const projects = await projectService.getUserProjects(systemUsername);

        // Load shared projects
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

        // Load databases
        const databases = await databaseService.getUserDatabases(systemUsername);

        // Calculate statistics (including shared projects)
        const allProjects = [...projects, ...sharedProjects];
        const stats = {
            totalProjects: projects.length,
            sharedProjects: sharedProjects.length,
            runningProjects: allProjects.filter(p => p.status === 'running').length,
            stoppedProjects: allProjects.filter(p => p.status === 'stopped').length,
            totalDatabases: databases.length
        };

        // For admins: count of pending registrations
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
        logger.error('Dashboard error', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
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
