const { doubleCsrf } = require('csrf-csrf');
const { logger } = require('../config/logger');

// CSRF Protection mit csrf-csrf (Double Submit Cookie Pattern)
const isProduction = process.env.NODE_ENV === 'production' && process.env.USE_HTTPS === 'true';

const {
    generateCsrfToken,
    doubleCsrfProtection
} = doubleCsrf({
    getSecret: () => process.env.SESSION_SECRET || 'change-this-secret',
    // __Host- Prefix erfordert HTTPS, daher nur in Produktion verwenden
    cookieName: isProduction ? '__Host-dployr.x-csrf-token' : 'dployr.x-csrf-token',
    cookieOptions: {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: isProduction
    },
    size: 64,
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    getTokenFromRequest: (req) => {
        // Token aus Body, Header oder Query lesen
        return req.body._csrf || req.headers['x-csrf-token'] || req.query._csrf;
    }
});

// Middleware die CSRF-Token in res.locals verfügbar macht
function csrfTokenMiddleware(req, res, next) {
    // Token generieren und in locals speichern
    const token = generateCsrfToken(req, res);
    res.locals.csrfToken = token;

    // Hidden Input Helper für Views
    res.locals.csrfInput = `<input type="hidden" name="_csrf" value="${token}">`;

    next();
}

// Error Handler für CSRF-Fehler
function csrfErrorHandler(err, req, res, next) {
    if (err.code === 'EBADCSRFTOKEN' || err.message === 'invalid csrf token') {
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
    generateCsrfToken,
    doubleCsrfProtection,
    csrfTokenMiddleware,
    csrfErrorHandler
};
