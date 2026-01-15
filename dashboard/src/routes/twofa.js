/**
 * Two-Factor Authentication Routes
 *
 * Handles:
 * - 2FA verification during login
 * - 2FA setup and management in settings
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const userService = require('../services/user');
const twofaService = require('../services/twofa');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { logger } = require('../config/logger');

// Rate limiter for 2FA verification (5 attempts per 15 minutes)
const twoFaVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many verification attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ============================================
// Login 2FA Verification Routes
// ============================================

/**
 * Middleware to check for pending 2FA session
 */
function requirePendingTwoFa(req, res, next) {
    if (!req.session.pendingTwoFa) {
        return res.redirect('/login');
    }

    // Check if session has expired
    if (Date.now() > req.session.pendingTwoFa.expires) {
        delete req.session.pendingTwoFa;
        req.flash('error', req.t('security:errors.sessionExpired'));
        return res.redirect('/login');
    }

    next();
}

/**
 * Middleware to check for pending 2FA setup session (forced setup)
 */
function requirePendingTwoFaSetup(req, res, next) {
    // Allow if user is authenticated OR has pending setup
    if (req.session.user || req.session.pendingTwoFaSetup) {
        // Check expiry for pending setup
        if (req.session.pendingTwoFaSetup && Date.now() > req.session.pendingTwoFaSetup.expires) {
            delete req.session.pendingTwoFaSetup;
            req.flash('error', req.t('security:errors.sessionExpired'));
            return res.redirect('/login');
        }
        return next();
    }
    res.redirect('/login');
}

// GET /login/2fa - Show 2FA verification form
router.get('/login/2fa', requirePendingTwoFa, (req, res) => {
    res.render('auth/twofa-verify', {
        title: req.t('security:verify.title'),
        username: req.session.pendingTwoFa.username
    });
});

// POST /login/2fa/verify - Verify 2FA code
router.post('/login/2fa/verify', requirePendingTwoFa, twoFaVerifyLimiter, validate('twoFaCode'), async (req, res) => {
    const { code } = req.validatedBody || req.body;
    const { userId, username, systemUsername, isAdmin } = req.session.pendingTwoFa;

    try {
        const totpSettings = await userService.getTotpSettings(userId);

        if (!totpSettings || !totpSettings.secret) {
            logger.warn('2FA verification attempted but no secret found', { userId });
            delete req.session.pendingTwoFa;
            req.flash('error', req.t('security:errors.notConfigured'));
            return res.redirect('/login');
        }

        // Try TOTP code first
        let isValid = twofaService.verifyCode(code, totpSettings.secret);

        // If TOTP failed, try backup codes
        if (!isValid && totpSettings.backupCodes) {
            const backupResult = await twofaService.verifyBackupCode(code, totpSettings.backupCodes);
            if (backupResult.valid) {
                isValid = true;
                // Mark backup code as used
                const updatedCodes = twofaService.markBackupCodeUsed(totpSettings.backupCodes, backupResult.index);
                await userService.updateBackupCodes(userId, updatedCodes);
                logger.info('Backup code used for 2FA', { userId, remainingCodes: twofaService.countRemainingBackupCodes(updatedCodes) });
            }
        }

        if (!isValid) {
            logger.warn('Invalid 2FA code', { userId });
            req.flash('error', req.t('security:errors.invalidCode'));
            return res.redirect('/login/2fa');
        }

        // 2FA verified - create full session
        delete req.session.pendingTwoFa;
        req.session.user = {
            id: userId,
            username: username,
            system_username: systemUsername,
            is_admin: isAdmin
        };

        // Load user's language preference
        const userLanguage = await userService.getUserLanguage(userId);
        req.session.language = userLanguage;
        req.i18n.changeLanguage(userLanguage);

        logger.info('2FA verification successful', { userId, username });
        req.flash('success', req.t('auth:flash.welcomeBack', { username }));
        res.redirect('/dashboard');
    } catch (error) {
        logger.error('2FA verification error', { error: error.message, userId });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/login/2fa');
    }
});

// POST /login/2fa/cancel - Cancel 2FA and return to login
router.post('/login/2fa/cancel', requirePendingTwoFa, (req, res) => {
    delete req.session.pendingTwoFa;
    res.redirect('/login');
});

// ============================================
// Settings Security Routes
// ============================================

// GET /settings/security - Show security settings
router.get('/settings/security', requireAuth, async (req, res) => {
    try {
        const totpSettings = await userService.getTotpSettings(req.session.user.id);
        const remainingBackupCodes = totpSettings?.backupCodes
            ? twofaService.countRemainingBackupCodes(totpSettings.backupCodes)
            : 0;

        res.render('settings/security', {
            title: req.t('security:title'),
            totpEnabled: totpSettings?.enabled || false,
            remainingBackupCodes,
            twoFaRequired: userService.isTwoFaRequired()
        });
    } catch (error) {
        logger.error('Error loading security settings', { error: error.message, userId: req.session.user.id });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/dashboard');
    }
});

// GET /settings/security/setup - Show 2FA setup page (also works for forced setup)
router.get('/settings/security/setup', requirePendingTwoFaSetup, async (req, res) => {
    try {
        // Get user ID from session or pending setup
        const userId = req.session.user?.id || req.session.pendingTwoFaSetup?.userId;
        const username = req.session.user?.username || req.session.pendingTwoFaSetup?.username;

        // Generate new secret
        const secret = twofaService.generateSecret();
        const qrCode = await twofaService.generateQRCode(username, secret);

        // Store secret temporarily in session for verification
        req.session.pendingTotpSecret = secret;

        res.render('settings/security-setup', {
            title: req.t('security:setup.title'),
            qrCode,
            secret,
            isForced: !!req.session.pendingTwoFaSetup
        });
    } catch (error) {
        logger.error('Error generating 2FA setup', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect(req.session.user ? '/settings/security' : '/login');
    }
});

// POST /settings/security/enable - Enable 2FA
router.post('/settings/security/enable', requirePendingTwoFaSetup, validate('twoFaCode'), async (req, res) => {
    const { code } = req.validatedBody || req.body;
    const userId = req.session.user?.id || req.session.pendingTwoFaSetup?.userId;
    const secret = req.session.pendingTotpSecret;

    if (!secret) {
        req.flash('error', req.t('security:errors.setupExpired'));
        return res.redirect(req.session.user ? '/settings/security/setup' : '/login');
    }

    try {
        // Verify the code with the pending secret
        if (!twofaService.verifyCode(code, secret)) {
            req.flash('error', req.t('security:errors.invalidCode'));
            return res.redirect('/settings/security/setup');
        }

        // Generate backup codes
        const backupCodes = twofaService.generateBackupCodes();
        const hashedBackupCodes = await twofaService.hashBackupCodes(backupCodes);

        // Save secret and enable 2FA
        await userService.saveTotpSecret(userId, secret);
        await userService.enableTotp(userId, hashedBackupCodes);

        // Clean up session
        delete req.session.pendingTotpSecret;

        // If this was a forced setup, complete the login
        if (req.session.pendingTwoFaSetup) {
            const { username, systemUsername, isAdmin } = req.session.pendingTwoFaSetup;
            delete req.session.pendingTwoFaSetup;

            req.session.user = {
                id: userId,
                username,
                system_username: systemUsername,
                is_admin: isAdmin
            };

            // Load user's language preference
            const userLanguage = await userService.getUserLanguage(userId);
            req.session.language = userLanguage;
            req.i18n.changeLanguage(userLanguage);
        }

        logger.info('2FA enabled', { userId });

        // Show backup codes (store in session for one-time display)
        req.session.backupCodesToShow = twofaService.formatBackupCodesForDisplay(backupCodes);
        res.redirect('/settings/security/backup-codes');
    } catch (error) {
        logger.error('Error enabling 2FA', { error: error.message, userId });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/settings/security/setup');
    }
});

// GET /settings/security/backup-codes - Show backup codes (one-time display)
router.get('/settings/security/backup-codes', requireAuth, (req, res) => {
    const backupCodes = req.session.backupCodesToShow;

    if (!backupCodes) {
        return res.redirect('/settings/security');
    }

    // Clear from session after retrieving (one-time view)
    delete req.session.backupCodesToShow;

    res.render('settings/security-backup-codes', {
        title: req.t('security:backupCodes.title'),
        backupCodes
    });
});

// POST /settings/security/disable - Disable 2FA
router.post('/settings/security/disable', requireAuth, validate('twoFaDisable'), async (req, res) => {
    const { code, password } = req.validatedBody || req.body;
    const userId = req.session.user.id;

    try {
        // Verify password
        const user = await userService.getUserByUsername(req.session.user.username);
        const validPassword = await userService.verifyPassword(user, password);

        if (!validPassword) {
            req.flash('error', req.t('security:errors.invalidPassword'));
            return res.redirect('/settings/security');
        }

        // Verify 2FA code
        const totpSettings = await userService.getTotpSettings(userId);

        if (!totpSettings || !totpSettings.enabled) {
            req.flash('error', req.t('security:errors.notEnabled'));
            return res.redirect('/settings/security');
        }

        // Try TOTP code first
        let isValid = twofaService.verifyCode(code, totpSettings.secret);

        // If TOTP failed, try backup codes
        if (!isValid && totpSettings.backupCodes) {
            const backupResult = await twofaService.verifyBackupCode(code, totpSettings.backupCodes);
            isValid = backupResult.valid;
        }

        if (!isValid) {
            req.flash('error', req.t('security:errors.invalidCode'));
            return res.redirect('/settings/security');
        }

        // Check if 2FA is required and user is not admin
        if (userService.isTwoFaRequired() && !req.session.user.is_admin) {
            req.flash('error', req.t('security:errors.cannotDisable'));
            return res.redirect('/settings/security');
        }

        // Disable 2FA
        await userService.disableTotp(userId);

        logger.info('2FA disabled', { userId });
        req.flash('success', req.t('security:flash.disabled'));
        res.redirect('/settings/security');
    } catch (error) {
        logger.error('Error disabling 2FA', { error: error.message, userId });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/settings/security');
    }
});

// POST /settings/security/regenerate-backup-codes - Generate new backup codes
router.post('/settings/security/regenerate-backup-codes', requireAuth, validate('twoFaCode'), async (req, res) => {
    const { code } = req.validatedBody || req.body;
    const userId = req.session.user.id;

    try {
        const totpSettings = await userService.getTotpSettings(userId);

        if (!totpSettings || !totpSettings.enabled) {
            req.flash('error', req.t('security:errors.notEnabled'));
            return res.redirect('/settings/security');
        }

        // Verify current 2FA code
        if (!twofaService.verifyCode(code, totpSettings.secret)) {
            req.flash('error', req.t('security:errors.invalidCode'));
            return res.redirect('/settings/security');
        }

        // Generate new backup codes
        const backupCodes = twofaService.generateBackupCodes();
        const hashedBackupCodes = await twofaService.hashBackupCodes(backupCodes);

        await userService.updateBackupCodes(userId, hashedBackupCodes);

        logger.info('Backup codes regenerated', { userId });

        // Show new backup codes
        req.session.backupCodesToShow = twofaService.formatBackupCodesForDisplay(backupCodes);
        res.redirect('/settings/security/backup-codes');
    } catch (error) {
        logger.error('Error regenerating backup codes', { error: error.message, userId });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/settings/security');
    }
});

module.exports = router;
