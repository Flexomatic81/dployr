const { csrfSync } = require('csrf-sync');
const { logger } = require('../config/logger');

// CSRF Protection mit csrf-sync (Synchronizer Token Pattern für Session-basierte Apps)
const {
    csrfSynchronisedProtection,
    generateToken
} = csrfSync({
    getTokenFromRequest: (req) => {
        // Token aus Body, Header oder Query lesen
        return req.body._csrf || req.headers['x-csrf-token'] || req.query._csrf;
    },
    getTokenFromState: (req) => {
        // Token aus Session lesen
        return req.session?.csrfToken;
    },
    storeTokenInState: (req, token) => {
        // Token in Session speichern
        if (req.session) {
            req.session.csrfToken = token;
        }
    },
    size: 64
});

// Middleware die CSRF-Token in res.locals verfügbar macht
function csrfTokenMiddleware(req, res, next) {
    // Token generieren falls nicht vorhanden
    let token = req.session?.csrfToken;
    if (!token) {
        token = generateToken(req);
    }

    res.locals.csrfToken = token;
    res.locals.csrfInput = `<input type="hidden" name="_csrf" value="${token}">`;

    next();
}

// Error Handler für CSRF-Fehler
function csrfErrorHandler(err, req, res, next) {
    if (err.code === 'EBADCSRFTOKEN' ||
        err.message === 'invalid csrf token' ||
        err.message?.includes('CSRF')) {

        logger.warn('CSRF-Token ungültig', {
            ip: req.ip,
            url: req.originalUrl,
            method: req.method,
            userAgent: req.get('User-Agent')
        });

        // Bei AJAX-Requests JSON zurückgeben
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(403).json({
                success: false,
                error: 'Ungültiges Sicherheitstoken. Bitte Seite neu laden.'
            });
        }

        // Bei normalen Requests Flash-Message und Redirect
        req.flash('error', 'Sicherheitstoken ungültig oder abgelaufen. Bitte erneut versuchen.');
        return res.redirect('back');
    }

    next(err);
}

module.exports = {
    csrfSynchronisedProtection,
    generateToken,
    csrfTokenMiddleware,
    csrfErrorHandler
};
