const express = require('express');
const router = express.Router();
const userService = require('../services/user');
const { redirectIfAuth, requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { logger } = require('../config/logger');

// Show login page
router.get('/login', redirectIfAuth, (req, res) => {
    res.render('login', { title: 'Login' });
});

// Process login
router.post('/login', redirectIfAuth, validate('login'), async (req, res) => {
    const { username, password } = req.validatedBody || req.body;

    try {
        const user = await userService.getUserByUsername(username);

        if (!user) {
            req.flash('error', req.t('auth:errors.invalidCredentials'));
            return res.redirect('/login');
        }

        const validPassword = await userService.verifyPassword(user, password);

        if (!validPassword) {
            req.flash('error', req.t('auth:errors.invalidCredentials'));
            return res.redirect('/login');
        }

        // Check if user is approved
        if (!user.approved) {
            req.flash('warning', req.t('auth:errors.notApproved'));
            return res.redirect('/login');
        }

        // Create session
        req.session.user = {
            id: user.id,
            username: user.username,
            system_username: user.system_username,
            is_admin: user.is_admin
        };

        // Load user's language preference
        const userLanguage = await userService.getUserLanguage(user.id);
        req.session.language = userLanguage;
        req.i18n.changeLanguage(userLanguage);

        req.flash('success', req.t('auth:flash.welcomeBack', { username: user.username }));
        res.redirect('/dashboard');
    } catch (error) {
        logger.error('Login error', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/login');
    }
});

// Show registration page
router.get('/register', redirectIfAuth, (req, res) => {
    res.render('register', { title: 'Registrieren' });
});

// Process registration
router.post('/register', redirectIfAuth, validate('register'), async (req, res) => {
    const { username, password } = req.validatedBody || req.body;
    // System username is identical to the username
    const system_username = username;

    try {
        // Check if username already exists
        if (await userService.existsUsernameOrSystemUsername(username, system_username)) {
            req.flash('error', req.t('auth:errors.usernameExists'));
            return res.redirect('/register');
        }

        // Create user (not yet approved)
        await userService.createUser(username, password, system_username, false);

        req.flash('info', req.t('auth:flash.registrationPending'));
        res.redirect('/login');
    } catch (error) {
        logger.error('Registration error', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/register');
    }
});

// Logout
router.post('/logout', requireAuth, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            logger.error('Logout error', { error: err.message });
        }
        res.redirect('/login');
    });
});

// GET route for logout (fallback)
router.get('/logout', requireAuth, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            logger.error('Logout error', { error: err.message });
        }
        res.redirect('/login');
    });
});

// Change language
router.post('/language', async (req, res) => {
    const { language } = req.body;
    const supportedLanguages = ['de', 'en'];

    if (!supportedLanguages.includes(language)) {
        return res.status(400).json({ error: 'Unsupported language' });
    }

    try {
        // Update session
        req.session.language = language;

        // Update i18next language
        req.i18n.changeLanguage(language);

        // Save to database if user is logged in
        if (req.session.user) {
            await userService.updateUserLanguage(req.session.user.id, language);
        }

        // Redirect back or to referrer
        const referer = req.get('Referer') || '/';
        res.redirect(referer);
    } catch (error) {
        logger.error('Language change error', { error: error.message });
        const referer = req.get('Referer') || '/';
        res.redirect(referer);
    }
});

module.exports = router;
