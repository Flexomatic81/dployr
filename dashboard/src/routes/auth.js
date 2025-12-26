const express = require('express');
const router = express.Router();
const userService = require('../services/user');
const { redirectIfAuth, requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// Login-Seite anzeigen
router.get('/login', redirectIfAuth, (req, res) => {
    res.render('login', { title: 'Login' });
});

// Login verarbeiten
router.post('/login', redirectIfAuth, validate('login'), async (req, res) => {
    const { username, password } = req.validatedBody || req.body;

    try {
        const user = await userService.getUserByUsername(username);

        if (!user) {
            req.flash('error', 'Ungültiger Benutzername oder Passwort');
            return res.redirect('/login');
        }

        const validPassword = await userService.verifyPassword(user, password);

        if (!validPassword) {
            req.flash('error', 'Ungültiger Benutzername oder Passwort');
            return res.redirect('/login');
        }

        // Prüfen ob User freigeschaltet ist
        if (!user.approved) {
            req.flash('warning', 'Ihr Konto wurde noch nicht freigeschaltet. Bitte warten Sie auf die Bestätigung durch einen Administrator.');
            return res.redirect('/login');
        }

        // Session erstellen
        req.session.user = {
            id: user.id,
            username: user.username,
            system_username: user.system_username,
            is_admin: user.is_admin
        };

        req.flash('success', `Willkommen zurück, ${user.username}!`);
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Login-Fehler:', error);
        req.flash('error', 'Ein Fehler ist aufgetreten');
        res.redirect('/login');
    }
});

// Registrierungs-Seite anzeigen
router.get('/register', redirectIfAuth, (req, res) => {
    res.render('register', { title: 'Registrieren' });
});

// Registrierung verarbeiten
router.post('/register', redirectIfAuth, validate('register'), async (req, res) => {
    const { username, password } = req.validatedBody || req.body;
    // System-Username ist identisch mit dem Benutzernamen
    const system_username = username;

    try {
        // Prüfen ob Username bereits existiert
        if (await userService.existsUsernameOrSystemUsername(username, system_username)) {
            req.flash('error', 'Benutzername bereits vergeben');
            return res.redirect('/register');
        }

        // User erstellen (noch nicht freigeschaltet)
        await userService.createUser(username, password, system_username, false);

        req.flash('info', 'Registrierung eingegangen! Ein Administrator muss Ihr Konto noch freischalten.');
        res.redirect('/login');
    } catch (error) {
        console.error('Registrierungs-Fehler:', error);
        req.flash('error', 'Ein Fehler ist aufgetreten');
        res.redirect('/register');
    }
});

// Logout
router.post('/logout', requireAuth, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout-Fehler:', err);
        }
        res.redirect('/login');
    });
});

// GET Route für Logout (Fallback)
router.get('/logout', requireAuth, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout-Fehler:', err);
        }
        res.redirect('/login');
    });
});

module.exports = router;
