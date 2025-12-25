const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getProjectAccess } = require('../middleware/projectAccess');
const dockerService = require('../services/docker');

// Logs für ein Projekt anzeigen
router.get('/:projectName', requireAuth, getProjectAccess('projectName'), async (req, res) => {
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
        return res.redirect('/projects');
    }
});

// API: Logs als JSON abrufen (für Auto-Refresh)
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
        console.error('API Log-Fehler:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
