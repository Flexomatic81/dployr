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
        const userCount = await userService.getUserCount();
        const adminCount = await userService.getAdminCount();

        // Alle Projekte aller User zählen
        const users = await userService.getAllUsers();
        let totalProjects = 0;

        for (const user of users) {
            const projects = await projectService.getUserProjects(user.system_username);
            totalProjects += projects.length;
        }

        res.render('admin/index', {
            title: 'Admin-Bereich',
            stats: {
                users: userCount,
                admins: adminCount,
                projects: totalProjects
            }
        });
    } catch (error) {
        console.error('Fehler im Admin-Dashboard:', error);
        req.flash('error', 'Fehler beim Laden der Admin-Übersicht');
        res.redirect('/dashboard');
    }
});

// User-Verwaltung - Liste
router.get('/users', async (req, res) => {
    try {
        const users = await userService.getAllUsers();

        // Projekte pro User zählen
        for (const user of users) {
            const projects = await projectService.getUserProjects(user.system_username);
            user.projectCount = projects.length;
        }

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

        await userService.createUser(username, password, system_username, is_admin === 'on');

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
        const allProjects = [];

        for (const user of users) {
            const projects = await projectService.getUserProjects(user.system_username);
            for (const project of projects) {
                allProjects.push({
                    ...project,
                    ownerUsername: user.username,
                    ownerSystemUsername: user.system_username
                });
            }
        }

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
