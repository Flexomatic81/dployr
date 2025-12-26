require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const flash = require('express-flash');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { csrfSynchronisedProtection, csrfTokenMiddleware, csrfErrorHandler } = require('./middleware/csrf');

const { initDatabase, getPool } = require('./config/database');
const { setUserLocals } = require('./middleware/auth');
const autoDeployService = require('./services/autodeploy');
const { logger, requestLogger } = require('./config/logger');

// Import routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const projectRoutes = require('./routes/projects');
const logRoutes = require('./routes/logs');
const databaseRoutes = require('./routes/databases');
const setupRoutes = require('./routes/setup');
const adminRoutes = require('./routes/admin');
const helpRoutes = require('./routes/help');

const app = express();
const PORT = process.env.PORT || 3000;

// Security: Helmet for HTTP security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "data:"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: null
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    hsts: false
}));

// Security: Rate limiting for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    message: 'Too many login attempts. Please try again in 15 minutes.',
    standardHeaders: true,
    legacyHeaders: false
});

// Security: General rate limiting
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    standardHeaders: true,
    legacyHeaders: false
});

app.use(generalLimiter);

// Request Logging
app.use(requestLogger);

// View Engine Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET || 'change-this-secret'));
app.use(methodOverride('_method'));

// Session Store - initialized later when DB is available
let sessionStore = null;
let setupComplete = false;

async function checkSetupComplete() {
    try {
        const fs = require('fs').promises;
        await fs.access('/app/infrastructure/.setup-complete');
        return true;
    } catch {
        return false;
    }
}

function createSessionStore() {
    if (sessionStore) return sessionStore;

    // Don't try to connect to DB if setup is not complete
    if (!setupComplete) {
        logger.info('Setup not complete - using Memory Session Store');
        return null; // Fallback to Memory-Store
    }

    try {
        const pool = getPool();
        sessionStore = new MySQLStore({
            clearExpired: true,
            checkExpirationInterval: 900000, // 15 minutes
            expiration: 86400000, // 24 hours
            createDatabaseTable: false, // Table is created in initDatabase
            schema: {
                tableName: 'sessions',
                columnNames: {
                    session_id: 'session_id',
                    expires: 'expires',
                    data: 'data'
                }
            }
        }, pool);
        logger.info('MySQL Session Store initialized');
        return sessionStore;
    } catch (error) {
        logger.warn('Session Store fallback to Memory Store', { error: error.message });
        return null; // Fallback to Memory Store
    }
}

// Session Setup - initially with memory store, upgraded after setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'change-this-secret',
    store: null, // Start with memory store, will be upgraded in start()
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production' && process.env.USE_HTTPS === 'true',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Flash Messages
app.use(flash());

// User locals for views
app.use(setUserLocals);

// CSRF Protection (after session, before routes)
app.use(csrfTokenMiddleware);
app.use(csrfSynchronisedProtection);

// Load server IP from setup marker (cached)
let cachedServerIp = null;
async function getServerIp() {
    if (cachedServerIp) return cachedServerIp;
    try {
        const fs = require('fs').promises;
        const setupData = await fs.readFile('/app/infrastructure/.setup-complete', 'utf8');
        const data = JSON.parse(setupData);
        cachedServerIp = data.serverIp || process.env.SERVER_IP || 'localhost';
    } catch {
        cachedServerIp = process.env.SERVER_IP || 'localhost';
    }
    return cachedServerIp;
}

// Load version information (from version.json, created during Docker build)
let versionInfo = { hash: null, date: null };
function loadVersionInfo() {
    try {
        const fs = require('fs');
        const versionPath = path.join(__dirname, '..', 'version.json');
        if (fs.existsSync(versionPath)) {
            const data = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
            if (data.hash && data.hash !== 'unknown') {
                versionInfo = data;
                logger.info('Version loaded', { hash: versionInfo.hash, date: versionInfo.date });
            }
        }
    } catch (error) {
        logger.debug('Version information not available');
    }
}
loadVersionInfo();

// Make flash messages and global variables available for views
app.use(async (req, res, next) => {
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    res.locals.warning = req.flash('warning');
    res.locals.info = req.flash('info');
    res.locals.serverIp = await getServerIp();
    res.locals.version = versionInfo;
    next();
});

// Setup route (before other routes, without setup check)
app.use('/setup', setupRoutes);

// Setup check middleware for all other routes
app.use(async (req, res, next) => {
    // Skip setup route
    if (req.path.startsWith('/setup')) {
        return next();
    }

    try {
        const { isSetupComplete } = require('./routes/setup');
        const setupComplete = await isSetupComplete();

        if (!setupComplete) {
            return res.redirect('/setup');
        }
        next();
    } catch (error) {
        // On error (e.g., DB not reachable) redirect to setup
        logger.debug('Setup check error, redirecting to setup', { error: error.message });
        return res.redirect('/setup');
    }
});

// Routes
// Auth routes with special rate limiter
app.use('/login', authLimiter);
app.use('/register', authLimiter);
app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/projects', projectRoutes);
app.use('/logs', logRoutes);
app.use('/databases', databaseRoutes);
app.use('/admin', adminRoutes);
app.use('/help', helpRoutes);

// Home Route
app.get('/', async (req, res) => {
    try {
        const { isSetupComplete } = require('./routes/setup');
        const setupComplete = await isSetupComplete();

        if (!setupComplete) {
            return res.redirect('/setup');
        }

        if (req.session && req.session.user) {
            res.redirect('/dashboard');
        } else {
            res.redirect('/login');
        }
    } catch (error) {
        res.redirect('/setup');
    }
});

// 404 Handler
app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Nicht gefunden',
        message: 'Die angeforderte Seite wurde nicht gefunden.'
    });
});

// CSRF Error Handler (vor allgemeinem Error Handler)
app.use(csrfErrorHandler);

// Error Handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack, url: req.originalUrl });

    // Ensure isAuthenticated and user are defined for layout
    if (typeof res.locals.isAuthenticated === 'undefined') {
        res.locals.isAuthenticated = false;
    }
    if (typeof res.locals.user === 'undefined') {
        res.locals.user = null;
    }

    res.status(500).render('error', {
        title: 'Fehler',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Ein Fehler ist aufgetreten.'
    });
});

// Auto-Deploy polling interval (5 minutes)
const AUTO_DEPLOY_INTERVAL = 5 * 60 * 1000;
let autoDeployInterval = null;

function startAutoDeployPolling() {
    if (autoDeployInterval) {
        clearInterval(autoDeployInterval);
    }

    logger.info('AutoDeploy polling service started', { interval: '5 minutes' });

    // First cycle after 30 seconds (to allow server startup)
    setTimeout(() => {
        autoDeployService.runPollingCycle();
    }, 30000);

    // Then every 5 minutes
    autoDeployInterval = setInterval(() => {
        autoDeployService.runPollingCycle();
    }, AUTO_DEPLOY_INTERVAL);
}

// Start server
async function start() {
    try {
        // Check if setup is complete (via file check, not DB)
        setupComplete = await checkSetupComplete();

        if (setupComplete) {
            // Initialize database only when setup is complete
            await initDatabase();
            logger.info('Setup already completed - normal mode');

            // Start Auto-Deploy polling
            startAutoDeployPolling();
        } else {
            logger.info('Setup not yet completed - setup wizard active');
        }

        app.listen(PORT, '0.0.0.0', () => {
            logger.info('Dashboard started', { port: PORT, url: `http://0.0.0.0:${PORT}` });
            if (!setupComplete) {
                logger.info('Setup wizard available at http://<SERVER-IP>:3000/setup');
            }
        });
    } catch (error) {
        // Start anyway on DB error (for setup wizard)
        logger.warn('Starting in setup mode (DB not available)', { error: error.message });
        app.listen(PORT, '0.0.0.0', () => {
            logger.info('Dashboard started in setup mode', { port: PORT });
        });
    }
}

start();
