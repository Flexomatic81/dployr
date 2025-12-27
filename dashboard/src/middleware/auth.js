// Middleware: Check if user is logged in
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    req.flash('error', req.t('auth:flash.loginRequired'));
    res.redirect('/login');
}

// Middleware: Check if user is admin
function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.is_admin) {
        return next();
    }
    req.flash('error', req.t('auth:flash.adminRequired'));
    res.redirect('/dashboard');
}

// Middleware: Redirect if already logged in
function redirectIfAuth(req, res, next) {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    next();
}

// Middleware: Make user data available in views
function setUserLocals(req, res, next) {
    // Safely access session (may be undefined during setup or on errors)
    const session = req.session || {};
    res.locals.user = session.user || null;
    res.locals.isAuthenticated = !!(session.user);
    next();
}

module.exports = {
    requireAuth,
    requireAdmin,
    redirectIfAuth,
    setUserLocals
};
