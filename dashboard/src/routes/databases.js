const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const databaseService = require('../services/database');
const { logger } = require('../config/logger');

// Show all databases
router.get('/', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const databases = await databaseService.getUserDatabases(systemUsername);
        const dbTypes = databaseService.getAvailableTypes();
        const serverIp = process.env.SERVER_IP || 'localhost';

        // Check which DB types are present
        const hasMariaDB = databases.some(db => db.type !== 'postgresql');
        const hasPostgreSQL = databases.some(db => db.type === 'postgresql');

        res.render('databases/index', {
            title: 'Databases',
            databases,
            dbTypes,
            serverIp,
            hasMariaDB,
            hasPostgreSQL
        });
    } catch (error) {
        logger.error('Error loading databases', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        return res.redirect('/dashboard');
    }
});

// Create new database - Form
router.get('/create', requireAuth, (req, res) => {
    const dbTypes = databaseService.getAvailableTypes();
    res.render('databases/create', {
        title: 'New Database',
        dbTypes
    });
});

// Create new database - Processing
router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, type } = req.body;
        const systemUsername = req.session.user.system_username;

        const dbInfo = await databaseService.createDatabase(systemUsername, name, type || 'mariadb');

        req.flash('success', req.t('databases:flash.created', { name: dbInfo.database }));
        return res.redirect('/databases');
    } catch (error) {
        logger.error('Error creating database', { error: error.message });
        req.flash('error', error.message || req.t('common:errors.createError'));
        return res.redirect('/databases/create');
    }
});

// Delete database
router.delete('/:name', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;

        await databaseService.deleteDatabase(systemUsername, req.params.name);
        req.flash('success', req.t('databases:flash.deleted', { name: req.params.name }));
        return res.redirect('/databases');
    } catch (error) {
        logger.error('Error deleting database', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('common:buttons.delete'), error: error.message }));
        return res.redirect('/databases');
    }
});

module.exports = router;
