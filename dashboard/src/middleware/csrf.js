const { csrfSync } = require('csrf-sync');
const { logger } = require('../config/logger');

// CSRF Protection with csrf-sync (Synchronizer Token Pattern for session-based apps)
const {
    csrfSynchronisedProtection,
    generateToken
} = csrfSync({
    getTokenFromRequest: (req) => {
        // Read token from body, header or query
        return req.body._csrf || req.headers['x-csrf-token'] || req.query._csrf;
    },
    getTokenFromState: (req) => {
        // Read token from session
        return req.session?.csrfToken;
    },
    storeTokenInState: (req, token) => {
        // Store token in session
        if (req.session) {
            req.session.csrfToken = token;
        }
    },
    size: 64
});

// Middleware that makes CSRF token available in res.locals
function csrfTokenMiddleware(req, res, next) {
    // Generate token if not present in session
    let token = req.session?.csrfToken;
    if (!token && req.session) {
        token = generateToken(req);
        // Explicitly store token in session (generateToken calls storeTokenInState internally,
        // but we ensure it's set here for consistency)
        req.session.csrfToken = token;
        // Force session save to ensure token is persisted before page renders
        req.session.save((err) => {
            if (err) {
                logger.error('Failed to save session for CSRF token', { error: err.message });
            }
            res.locals.csrfToken = token;
            res.locals.csrfInput = `<input type="hidden" name="_csrf" value="${token}">`;
            next();
        });
        return;
    }

    res.locals.csrfToken = token || '';
    res.locals.csrfInput = `<input type="hidden" name="_csrf" value="${token || ''}">`;

    next();
}

// Error handler for CSRF errors
function csrfErrorHandler(err, req, res, next) {
    if (err.code === 'EBADCSRFTOKEN' ||
        err.message === 'invalid csrf token' ||
        err.message?.includes('CSRF')) {

        logger.warn('Invalid CSRF token', {
            ip: req.ip,
            url: req.originalUrl,
            method: req.method,
            userAgent: req.get('User-Agent')
        });

        // Return JSON for AJAX requests
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(403).json({
                success: false,
                error: 'Invalid security token. Please reload the page.'
            });
        }

        // Flash message and redirect for normal requests
        req.flash('error', req.t('common:errors.csrfInvalid'));
        const referrer = req.get('Referrer');
        return res.redirect(referrer || '/');
    }

    next(err);
}

module.exports = {
    csrfSynchronisedProtection,
    generateToken,
    csrfTokenMiddleware,
    csrfErrorHandler
};
