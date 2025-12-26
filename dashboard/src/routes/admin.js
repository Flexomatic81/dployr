const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const userService = require('../services/user');
const projectService = require('../services/project');

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
        console.error('Fehler im Admin-Dashboard:', error);
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
        console.error('Fehler beim Laden der ausstehenden Registrierungen:', error);
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
        console.error('Fehler beim Freischalten:', error);
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
        console.error('Fehler beim Ablehnen:', error);
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
        console.error('Fehler beim Laden der User:', error);
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
        console.error('Fehler beim Erstellen des Users:', error);
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
        console.error('Fehler beim Laden des Users:', error);
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
        console.error('Fehler beim Aktualisieren des Users:', error);
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
        console.error('Fehler beim Löschen des Users:', error);
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
        console.error('Fehler beim Laden der Projekte:', error);
        req.flash('error', 'Fehler beim Laden der Projekte');
        res.redirect('/admin');
    }
});

module.exports = router;
