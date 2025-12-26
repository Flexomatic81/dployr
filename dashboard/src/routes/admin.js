const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { createReadStream } = require('fs');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const userService = require('../services/user');
const projectService = require('../services/project');
const { logger } = require('../config/logger');
const pool = require('../config/database');

const LOG_DIR = process.env.LOG_DIR || '/app/logs';

// Alle Admin-Routen erfordern Admin-Rechte
router.use(requireAuth);
router.use(requireAdmin);

// Admin Dashboard - Übersicht
router.get('/', async (req, res) => {
    try {
        // Alle Counts parallel abrufen
        const [userCount, adminCount, pendingCount, users] = await Promise.all([
            userService.getUserCount(),
            userService.getAdminCount(),
            userService.getPendingCount(),
            userService.getAllUsers()
        ]);

        // Alle Projekt-Counts parallel abrufen
        const projectCounts = await Promise.all(
            users.map(user => projectService.getUserProjects(user.system_username))
        );
        const totalProjects = projectCounts.reduce((sum, projects) => sum + projects.length, 0);

        res.render('admin/index', {
            title: 'Admin-Bereich',
            stats: {
                users: userCount,
                admins: adminCount,
                projects: totalProjects,
                pending: pendingCount
            }
        });
    } catch (error) {
        logger.error('Fehler im Admin-Dashboard', { error: error.message });
        req.flash('error', 'Fehler beim Laden der Admin-Übersicht');
        res.redirect('/dashboard');
    }
});

// Ausstehende Registrierungen anzeigen
router.get('/pending', async (req, res) => {
    try {
        const pendingUsers = await userService.getPendingUsers();

        res.render('admin/pending', {
            title: 'Ausstehende Registrierungen',
            pendingUsers
        });
    } catch (error) {
        logger.error('Fehler beim Laden der ausstehenden Registrierungen', { error: error.message });
        req.flash('error', 'Fehler beim Laden der ausstehenden Registrierungen');
        res.redirect('/admin');
    }
});

// User freischalten
router.post('/users/:id/approve', async (req, res) => {
    try {
        const user = await userService.approveUser(req.params.id);

        if (user) {
            req.flash('success', `User "${user.username}" wurde freigeschaltet`);
        } else {
            req.flash('error', 'User nicht gefunden');
        }

        res.redirect('/admin/pending');
    } catch (error) {
        logger.error('Fehler beim Freischalten', { error: error.message });
        req.flash('error', 'Fehler beim Freischalten: ' + error.message);
        res.redirect('/admin/pending');
    }
});

// User-Registrierung ablehnen
router.post('/users/:id/reject', async (req, res) => {
    try {
        await userService.rejectUser(req.params.id);
        req.flash('success', 'Registrierung wurde abgelehnt');
        res.redirect('/admin/pending');
    } catch (error) {
        logger.error('Fehler beim Ablehnen', { error: error.message });
        req.flash('error', 'Fehler beim Ablehnen: ' + error.message);
        res.redirect('/admin/pending');
    }
});

// User-Verwaltung - Liste
router.get('/users', async (req, res) => {
    try {
        const users = await userService.getAllUsers();

        // Projekte pro User parallel zählen
        const projectCounts = await Promise.all(
            users.map(user => projectService.getUserProjects(user.system_username))
        );

        users.forEach((user, index) => {
            user.projectCount = projectCounts[index].length;
        });

        res.render('admin/users', {
            title: 'User-Verwaltung',
            users
        });
    } catch (error) {
        logger.error('Fehler beim Laden der User', { error: error.message });
        req.flash('error', 'Fehler beim Laden der User-Liste');
        res.redirect('/admin');
    }
});

// Neuen User erstellen - Formular
router.get('/users/create', (req, res) => {
    res.render('admin/users-create', {
        title: 'Neuer User'
    });
});

// Neuen User erstellen - Verarbeitung
router.post('/users', async (req, res) => {
    try {
        const { username, password, system_username, is_admin } = req.body;

        // Validierung
        if (!username || !password || !system_username) {
            req.flash('error', 'Alle Pflichtfelder müssen ausgefüllt sein');
            return res.redirect('/admin/users/create');
        }

        if (!/^[a-z0-9_-]+$/.test(username)) {
            req.flash('error', 'Benutzername darf nur Kleinbuchstaben, Zahlen, Unterstriche und Bindestriche enthalten');
            return res.redirect('/admin/users/create');
        }

        if (!/^[a-z0-9_-]+$/.test(system_username)) {
            req.flash('error', 'System-Username darf nur Kleinbuchstaben, Zahlen, Unterstriche und Bindestriche enthalten');
            return res.redirect('/admin/users/create');
        }

        // Prüfen ob User existiert
        if (await userService.existsUsernameOrSystemUsername(username, system_username)) {
            req.flash('error', 'Benutzername oder System-Username existiert bereits');
            return res.redirect('/admin/users/create');
        }

        // Admin-erstellte User werden automatisch freigeschaltet
        await userService.createUser(username, password, system_username, is_admin === 'on', true);

        req.flash('success', `User "${username}" erfolgreich erstellt`);
        res.redirect('/admin/users');
    } catch (error) {
        logger.error('Fehler beim Erstellen des Users', { error: error.message });
        req.flash('error', 'Fehler beim Erstellen des Users');
        res.redirect('/admin/users/create');
    }
});

// User bearbeiten - Formular
router.get('/users/:id/edit', async (req, res) => {
    try {
        const editUser = await userService.getUserById(req.params.id);

        if (!editUser) {
            req.flash('error', 'User nicht gefunden');
            return res.redirect('/admin/users');
        }

        res.render('admin/users-edit', {
            title: 'User bearbeiten',
            editUser
        });
    } catch (error) {
        logger.error('Fehler beim Laden des Users', { error: error.message });
        req.flash('error', 'Fehler beim Laden des Users');
        res.redirect('/admin/users');
    }
});

// User bearbeiten - Verarbeitung
router.put('/users/:id', async (req, res) => {
    try {
        const { username, password, system_username, is_admin } = req.body;
        const userId = req.params.id;

        // Validierung
        if (!username || !system_username) {
            req.flash('error', 'Benutzername und System-Username sind erforderlich');
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        // Prüfen ob Username/System-Username bereits verwendet wird
        if (await userService.existsUsernameOrSystemUsername(username, system_username, userId)) {
            req.flash('error', 'Benutzername oder System-Username wird bereits verwendet');
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        await userService.updateUser(userId, {
            username,
            password: password || null,
            systemUsername: system_username,
            isAdmin: is_admin === 'on'
        });

        req.flash('success', 'User erfolgreich aktualisiert');
        res.redirect('/admin/users');
    } catch (error) {
        logger.error('Fehler beim Aktualisieren des Users', { error: error.message });
        req.flash('error', 'Fehler beim Aktualisieren des Users');
        res.redirect(`/admin/users/${req.params.id}/edit`);
    }
});

// User löschen
router.delete('/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;

        // Eigenen Account nicht löschen
        if (parseInt(userId) === req.session.user.id) {
            req.flash('error', 'Sie können Ihren eigenen Account nicht löschen');
            return res.redirect('/admin/users');
        }

        // Prüfen ob es der letzte Admin ist
        if (await userService.isLastAdmin(userId)) {
            req.flash('error', 'Der letzte Admin-Account kann nicht gelöscht werden');
            return res.redirect('/admin/users');
        }

        await userService.deleteUser(userId);

        req.flash('success', 'User erfolgreich gelöscht');
        res.redirect('/admin/users');
    } catch (error) {
        logger.error('Fehler beim Löschen des Users', { error: error.message });
        req.flash('error', 'Fehler beim Löschen des Users');
        res.redirect('/admin/users');
    }
});

// Alle Projekte aller User anzeigen
router.get('/projects', async (req, res) => {
    try {
        const users = await userService.getAllUsers();

        // Alle Projekte parallel abrufen
        const projectsPerUser = await Promise.all(
            users.map(user => projectService.getUserProjects(user.system_username))
        );

        // Projekte mit Owner-Infos zusammenführen
        const allProjects = users.flatMap((user, index) =>
            projectsPerUser[index].map(project => ({
                ...project,
                ownerUsername: user.username,
                ownerSystemUsername: user.system_username
            }))
        );

        res.render('admin/projects', {
            title: 'Alle Projekte',
            projects: allProjects
        });
    } catch (error) {
        logger.error('Fehler beim Laden der Projekte', { error: error.message });
        req.flash('error', 'Fehler beim Laden der Projekte');
        res.redirect('/admin');
    }
});

// ============================================
// System-Logs
// ============================================

// Hilfsfunktion: Letzte N Zeilen einer Datei lesen (effizient)
async function readLastLines(filePath, maxLines = 500) {
    return new Promise((resolve, reject) => {
        const lines = [];

        const rl = readline.createInterface({
            input: createReadStream(filePath),
            crlfDelay: Infinity
        });

        rl.on('line', (line) => {
            lines.push(line);
            // Nur die letzten maxLines behalten
            if (lines.length > maxLines) {
                lines.shift();
            }
        });

        rl.on('close', () => resolve(lines));
        rl.on('error', reject);
    });
}

// Hilfsfunktion: Log-Zeile parsen (JSON-Format von Winston)
function parseLogLine(line) {
    try {
        const parsed = JSON.parse(line);
        return {
            timestamp: parsed.timestamp || '',
            level: parsed.level || 'info',
            message: parsed.message || '',
            meta: { ...parsed, timestamp: undefined, level: undefined, message: undefined, service: undefined }
        };
    } catch {
        // Fallback für nicht-JSON Zeilen
        return {
            timestamp: '',
            level: 'info',
            message: line,
            meta: {}
        };
    }
}

// System-Logs anzeigen
router.get('/logs', async (req, res) => {
    try {
        const logType = req.query.type || 'combined'; // combined oder error
        const levelFilter = req.query.level || 'all'; // all, error, warn, info
        const limit = Math.min(parseInt(req.query.limit) || 200, 1000);

        const logFile = logType === 'error' ? 'error.log' : 'combined.log';
        const logPath = path.join(LOG_DIR, logFile);

        let logs = [];
        let error = null;

        try {
            const lines = await readLastLines(logPath, limit * 2); // Mehr lesen für Filter
            logs = lines
                .map(parseLogLine)
                .filter(log => {
                    if (levelFilter === 'all') return true;
                    return log.level === levelFilter;
                })
                .slice(-limit)
                .reverse(); // Neueste zuerst
        } catch (err) {
            if (err.code === 'ENOENT') {
                error = `Log-Datei nicht gefunden: ${logFile}`;
            } else {
                error = `Fehler beim Lesen der Logs: ${err.message}`;
            }
        }

        res.render('admin/logs', {
            title: 'System-Logs',
            logs,
            error,
            filters: {
                type: logType,
                level: levelFilter,
                limit
            }
        });
    } catch (error) {
        logger.error('Fehler beim Laden der System-Logs', { error: error.message });
        req.flash('error', 'Fehler beim Laden der System-Logs');
        res.redirect('/admin');
    }
});

// System-Logs als JSON API (für Live-Refresh)
router.get('/logs/api', async (req, res) => {
    try {
        const logType = req.query.type || 'combined';
        const levelFilter = req.query.level || 'all';
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);

        const logFile = logType === 'error' ? 'error.log' : 'combined.log';
        const logPath = path.join(LOG_DIR, logFile);

        const lines = await readLastLines(logPath, limit * 2);
        const logs = lines
            .map(parseLogLine)
            .filter(log => {
                if (levelFilter === 'all') return true;
                return log.level === levelFilter;
            })
            .slice(-limit)
            .reverse();

        res.json({ success: true, logs });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ============================================
// Deployment-Historie
// ============================================

// Deployment-Historie anzeigen
router.get('/deployments', async (req, res) => {
    try {
        const statusFilter = req.query.status || 'all';
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        let query = `
            SELECT
                dl.*,
                u.username,
                u.system_username
            FROM deployment_logs dl
            JOIN users u ON dl.user_id = u.id
        `;

        const params = [];
        if (statusFilter !== 'all') {
            query += ' WHERE dl.status = ?';
            params.push(statusFilter);
        }

        query += ' ORDER BY dl.deployed_at DESC LIMIT ?';
        params.push(limit);

        const [deployments] = await pool.execute(query, params);

        // Statistiken berechnen
        const [stats] = await pool.execute(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                AVG(duration_ms) as avg_duration
            FROM deployment_logs
            WHERE deployed_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `);

        res.render('admin/deployments', {
            title: 'Deployment-Historie',
            deployments,
            stats: stats[0],
            filters: {
                status: statusFilter,
                limit
            }
        });
    } catch (error) {
        logger.error('Fehler beim Laden der Deployment-Historie', { error: error.message });
        req.flash('error', 'Fehler beim Laden der Deployment-Historie');
        res.redirect('/admin');
    }
});

module.exports = router;
