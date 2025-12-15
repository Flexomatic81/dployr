const express = require('express');
const router = express.Router();
const userService = require('../services/user');
const { redirectIfAuth, requireAuth } = require('../middleware/auth');

// Login-Seite anzeigen
router.get('/login', redirectIfAuth, (req, res) => {
    res.render('login', { title: 'Login' });
});

// Login verarbeiten
router.post('/login', redirectIfAuth, async (req, res) => {
    const { username, password } = req.body;

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
router.post('/register', redirectIfAuth, async (req, res) => {
    const { username, password, password_confirm, system_username } = req.body;

    // Validierung
    if (!username || !password || !system_username) {
        req.flash('error', 'Alle Felder müssen ausgefüllt werden');
        return res.redirect('/register');
    }

    if (password !== password_confirm) {
        req.flash('error', 'Passwörter stimmen nicht überein');
        return res.redirect('/register');
    }

    if (password.length < 6) {
        req.flash('error', 'Passwort muss mindestens 6 Zeichen lang sein');
        return res.redirect('/register');
    }

    if (!/^[a-z0-9_-]+$/.test(username)) {
        req.flash('error', 'Benutzername darf nur Kleinbuchstaben, Zahlen, - und _ enthalten');
        return res.redirect('/register');
    }

    if (!/^[a-z0-9_-]+$/.test(system_username)) {
        req.flash('error', 'System-Benutzername darf nur Kleinbuchstaben, Zahlen, - und _ enthalten');
        return res.redirect('/register');
    }

    try {
        // Prüfen ob Username bereits existiert
        if (await userService.existsUsernameOrSystemUsername(username, system_username)) {
            req.flash('error', 'Benutzername oder System-Username bereits vergeben');
            return res.redirect('/register');
        }

        // User erstellen
        await userService.createUser(username, password, system_username, false);

        req.flash('success', 'Registrierung erfolgreich! Bitte einloggen.');
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
