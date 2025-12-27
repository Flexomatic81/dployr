const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getProjectAccess } = require('../middleware/projectAccess');
const dockerService = require('../services/docker');
const { logger } = require('../config/logger');

// Show logs for a project
router.get('/:projectName', requireAuth, getProjectAccess('projectName'), async (req, res) => {
    try {
        const project = req.projectAccess.project;

        // Collect logs for all containers of the project
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
        logger.error('Error loading logs', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        return res.redirect('/projects');
    }
});

// API: Fetch logs as JSON (for auto-refresh)
router.get('/:projectName/api', requireAuth, getProjectAccess('projectName'), async (req, res) => {
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
        logger.error('API log error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
