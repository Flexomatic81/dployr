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
            req.flash('error', 'Invalid username or password');
            return res.redirect('/login');
        }

        const validPassword = await userService.verifyPassword(user, password);

        if (!validPassword) {
            req.flash('error', 'Invalid username or password');
            return res.redirect('/login');
        }

        // Check if user is approved
        if (!user.approved) {
            req.flash('warning', 'Your account has not been approved yet. Please wait for confirmation from an administrator.');
            return res.redirect('/login');
        }

        // Create session
        req.session.user = {
            id: user.id,
            username: user.username,
            system_username: user.system_username,
            is_admin: user.is_admin
        };

        req.flash('success', `Welcome back, ${user.username}!`);
        res.redirect('/dashboard');
    } catch (error) {
        logger.error('Login error', { error: error.message });
        req.flash('error', 'An error occurred');
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
            req.flash('error', 'Username already taken');
            return res.redirect('/register');
        }

        // Create user (not yet approved)
        await userService.createUser(username, password, system_username, false);

        req.flash('info', 'Registration received! An administrator must approve your account first.');
        res.redirect('/login');
    } catch (error) {
        logger.error('Registration error', { error: error.message });
        req.flash('error', 'An error occurred');
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

module.exports = router;
