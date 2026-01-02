/**
 * Admin Routes Index
 * Combines all admin sub-routers
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../../middleware/auth');
const userService = require('../../services/user');
const projectService = require('../../services/project');
const { logger } = require('../../config/logger');

// Import sub-routers
const usersRouter = require('./users');
const logsRouter = require('./logs');
const settingsRouter = require('./settings');
const updatesRouter = require('./updates');

// All admin routes require admin privileges
router.use(requireAuth);
router.use(requireAdmin);

// Admin Dashboard - Overview
router.get('/', async (req, res) => {
    try {
        // Fetch all counts in parallel
        const [userCount, adminCount, pendingCount, users] = await Promise.all([
            userService.getUserCount(),
            userService.getAdminCount(),
            userService.getPendingCount(),
            userService.getAllUsers()
        ]);

        // Fetch all project counts in parallel
        const projectCounts = await Promise.all(
            users.map(user => projectService.getUserProjects(user.system_username))
        );
        const totalProjects = projectCounts.reduce((sum, projects) => sum + projects.length, 0);

        res.render('admin/index', {
            title: 'Admin Area',
            stats: {
                users: userCount,
                admins: adminCount,
                projects: totalProjects,
                pending: pendingCount
            }
        });
    } catch (error) {
        logger.error('Error in admin dashboard', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/dashboard');
    }
});

// Show all projects of all users
router.get('/projects', async (req, res) => {
    try {
        const users = await userService.getAllUsers();

        // Fetch all projects in parallel
        const projectsPerUser = await Promise.all(
            users.map(user => projectService.getUserProjects(user.system_username))
        );

        // Merge projects with owner info
        const allProjects = users.flatMap((user, index) =>
            projectsPerUser[index].map(project => ({
                ...project,
                ownerUsername: user.username,
                ownerSystemUsername: user.system_username
            }))
        );

        res.render('admin/projects', {
            title: 'All Projects',
            projects: allProjects
        });
    } catch (error) {
        logger.error('Error loading projects', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

// Legacy route redirects for backwards compatibility
router.get('/pending', (req, res) => res.redirect('/admin/users/pending'));
router.get('/deployments', (req, res) => res.redirect('/admin/logs/deployments'));

// Mount sub-routers
router.use('/users', usersRouter);
router.use('/logs', logsRouter);
router.use('/settings', settingsRouter);
router.use('/updates', updatesRouter);

module.exports = router;
