const express = require('express');
const router = express.Router();
const userService = require('../services/user');
const emailService = require('../services/email');
const { redirectIfAuth, requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { logger } = require('../config/logger');
const { sanitizeReturnUrl } = require('../services/utils/security');

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

        // Check 2FA status
        const totpSettings = await userService.getTotpSettings(user.id);
        const twoFaRequired = userService.isTwoFaRequired();

        if (totpSettings && totpSettings.enabled) {
            // User has 2FA enabled - require verification
            req.session.pendingTwoFa = {
                userId: user.id,
                username: user.username,
                systemUsername: user.system_username,
                isAdmin: user.is_admin,
                expires: Date.now() + 5 * 60 * 1000 // 5 minutes
            };
            return res.redirect('/login/2fa');
        }

        if (twoFaRequired && !user.is_admin) {
            // 2FA is required but user hasn't set it up - force setup
            req.session.pendingTwoFaSetup = {
                userId: user.id,
                username: user.username,
                systemUsername: user.system_username,
                isAdmin: user.is_admin,
                expires: Date.now() + 30 * 60 * 1000 // 30 minutes for setup
            };
            req.flash('warning', req.t('security:setup.required'));
            return res.redirect('/settings/security/setup');
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
    const { username, password, email } = req.validatedBody || req.body;
    // System username is identical to the username
    const system_username = username;

    try {
        // Check if username already exists
        if (await userService.existsUsernameOrSystemUsername(username, system_username)) {
            req.flash('error', req.t('auth:errors.usernameExists'));
            return res.redirect('/register');
        }

        // Check if email already exists
        if (email && await userService.emailExists(email)) {
            req.flash('error', req.t('auth:errors.emailExists'));
            return res.redirect('/register');
        }

        // Create user (not yet approved)
        const user = await userService.createUser(username, password, system_username, false, false, email);

        // Send verification email if email provided and email is enabled
        if (email && emailService.isEnabled() && user.verificationToken) {
            await emailService.sendVerificationEmail(email, username, user.verificationToken, req.language || 'de');
            logger.info('Verification email sent', { userId: user.id, email });
        }

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

        // Redirect back to referrer (sanitized to prevent open redirect)
        const referer = sanitizeReturnUrl(req.get('Referer'), '/');
        res.redirect(referer);
    } catch (error) {
        logger.error('Language change error', { error: error.message });
        const referer = sanitizeReturnUrl(req.get('Referer'), '/');
        res.redirect(referer);
    }
});

// ============================================
// Password Reset Routes
// ============================================

// Show forgot password page
router.get('/forgot-password', redirectIfAuth, (req, res) => {
    res.render('forgot-password', { title: req.t('auth:forgotPassword.title') });
});

// Process forgot password request
router.post('/forgot-password', redirectIfAuth, validate('forgotPassword'), async (req, res) => {
    const { email } = req.validatedBody || req.body;

    try {
        const user = await userService.getUserByEmail(email);

        // Always show success message to prevent email enumeration
        if (user && emailService.isEnabled()) {
            const token = await userService.createResetToken(user.id);
            const language = await userService.getUserLanguage(user.id);
            await emailService.sendPasswordResetEmail(email, user.username, token, language);
            logger.info('Password reset email sent', { email, userId: user.id });
        }

        req.flash('info', req.t('auth:flash.resetEmailSent'));
        res.redirect('/login');
    } catch (error) {
        logger.error('Forgot password error', { error: error.message, email });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/forgot-password');
    }
});

// Show reset password page
router.get('/reset-password', redirectIfAuth, async (req, res) => {
    const { token } = req.query;

    if (!token) {
        req.flash('error', req.t('auth:errors.invalidToken'));
        return res.redirect('/forgot-password');
    }

    const user = await userService.getUserByResetToken(token);
    if (!user) {
        req.flash('error', req.t('auth:errors.tokenExpired'));
        return res.redirect('/forgot-password');
    }

    res.render('reset-password', {
        title: req.t('auth:resetPassword.title'),
        token
    });
});

// Process reset password
router.post('/reset-password', redirectIfAuth, validate('resetPassword'), async (req, res) => {
    const { token, password } = req.validatedBody || req.body;

    try {
        const user = await userService.getUserByResetToken(token);

        if (!user) {
            req.flash('error', req.t('auth:errors.tokenExpired'));
            return res.redirect('/forgot-password');
        }

        await userService.updatePassword(user.id, password);
        await userService.clearResetToken(user.id);

        logger.info('Password reset successful', { userId: user.id });
        req.flash('success', req.t('auth:flash.passwordReset'));
        res.redirect('/login');
    } catch (error) {
        logger.error('Reset password error', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/forgot-password');
    }
});

// ============================================
// Email Verification Routes
// ============================================

// Verify email address
router.get('/verify-email', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        req.flash('error', req.t('auth:errors.invalidToken'));
        return res.redirect('/login');
    }

    try {
        const user = await userService.getUserByVerificationToken(token);

        if (!user) {
            req.flash('error', req.t('auth:errors.tokenExpired'));
            return res.redirect('/login');
        }

        await userService.verifyEmail(user.id);

        logger.info('Email verified', { userId: user.id });
        req.flash('success', req.t('auth:flash.emailVerified'));
        res.redirect('/login');
    } catch (error) {
        logger.error('Email verification error', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/login');
    }
});

// Resend verification email
router.post('/resend-verification', requireAuth, async (req, res) => {
    try {
        const user = await userService.getFullUserById(req.session.user.id);

        if (!user.email) {
            return res.json({ success: false, error: req.t('auth:errors.noEmail') });
        }

        if (user.email_verified) {
            return res.json({ success: false, error: req.t('auth:errors.alreadyVerified') });
        }

        const token = await userService.updateEmail(user.id, user.email);
        const language = await userService.getUserLanguage(user.id);
        await emailService.sendVerificationEmail(user.email, user.username, token, language);

        logger.info('Verification email resent', { userId: user.id, email: user.email });
        res.json({ success: true, message: req.t('auth:flash.verificationSent') });
    } catch (error) {
        logger.error('Resend verification error', { error: error.message });
        res.json({ success: false, error: error.message });
    }
});

module.exports = router;
