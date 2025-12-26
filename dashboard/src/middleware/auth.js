// Middleware: Check if user is logged in
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    req.flash('error', 'Please log in first');
    res.redirect('/login');
}

// Middleware: Check if user is admin
function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.is_admin) {
        return next();
    }
    req.flash('error', 'Admin permission required');
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
    res.locals.user = req.session ? req.session.user : null;
    res.locals.isAuthenticated = !!(req.session && req.session.user);
    next();
}

module.exports = {
    requireAuth,
    requireAdmin,
    redirectIfAuth,
    setUserLocals
};
