const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const databaseService = require('../services/database');

// Alle Datenbanken anzeigen
router.get('/', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const databases = await databaseService.getUserDatabases(systemUsername);
        const dbTypes = databaseService.getAvailableTypes();

        res.render('databases/index', {
            title: 'Datenbanken',
            databases,
            dbTypes
        });
    } catch (error) {
        console.error('Fehler beim Laden der Datenbanken:', error);
        req.flash('error', 'Fehler beim Laden der Datenbanken');
        res.redirect('/dashboard');
    }
});

// Neue Datenbank erstellen - Formular
router.get('/create', requireAuth, (req, res) => {
    const dbTypes = databaseService.getAvailableTypes();
    res.render('databases/create', {
        title: 'Neue Datenbank',
        dbTypes
    });
});

// Neue Datenbank erstellen - Verarbeitung
router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, type } = req.body;
        const systemUsername = req.session.user.system_username;

        const dbInfo = await databaseService.createDatabase(systemUsername, name, type || 'mariadb');

        const typeName = type === 'postgresql' ? 'PostgreSQL' : 'MariaDB';
        req.flash('success', `${typeName}-Datenbank "${dbInfo.database}" erfolgreich erstellt!`);
        res.redirect('/databases');
    } catch (error) {
        console.error('Fehler beim Erstellen der Datenbank:', error);
        req.flash('error', error.message || 'Fehler beim Erstellen der Datenbank');
        res.redirect('/databases/create');
    }
});

// Datenbank löschen
router.delete('/:name', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;

        await databaseService.deleteDatabase(systemUsername, req.params.name);
        req.flash('success', `Datenbank "${req.params.name}" gelöscht`);
        res.redirect('/databases');
    } catch (error) {
        console.error('Fehler beim Löschen:', error);
        req.flash('error', 'Fehler beim Löschen: ' + error.message);
        res.redirect('/databases');
    }
});

module.exports = router;
