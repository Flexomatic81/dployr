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
const { i18next, i18nMiddleware } = require('./config/i18n');

const { createProxyMiddleware } = require('http-proxy-middleware');
const httpProxy = require('http-proxy');
const { initDatabase, getPool } = require('./config/database');
const { setUserLocals, requireAuth } = require('./middleware/auth');
const autoDeployService = require('./services/autodeploy');
const proxyService = require('./services/proxy');
const updateService = require('./services/update');
const workspaceService = require('./services/workspace');
const previewService = require('./services/preview');
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
const proxyRoutes = require('./routes/proxy');
const webhookRoutes = require('./routes/webhooks');
const profileRoutes = require('./routes/profile');
const backupRoutes = require('./routes/backups');
const workspaceRoutes = require('./routes/workspaces');
const apiKeyRoutes = require('./routes/api-keys');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy when behind reverse proxy (NPM/nginx)
// Required for correct IP detection and rate limiting
app.set('trust proxy', 1);

// Security: Helmet for HTTP security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "data:"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"],
            frameSrc: ["'self'", "http:", "https:"],
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

// Security: General rate limiting (skip for setup routes)
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/setup')
});

// Security: Webhook rate limiting (more permissive for CI/CD)
const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute per IP
    message: { error: 'Too many webhook requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Security: Workspace operations rate limiting
const workspaceLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // 10 operations per minute
    message: { error: 'Too many workspace operations. Please try again later.' },
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

// Health check endpoint - no auth required, used for update readiness checks
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// Webhook route - MUST be registered BEFORE express.json() middleware
// Webhooks need raw body for HMAC signature validation
// Also registered before session/CSRF (authenticated via signature, not session)
app.use('/api/webhooks', webhookLimiter, webhookRoutes);

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

// i18n Middleware
app.use(i18nMiddleware.handle(i18next));

// Make translation function available in views
app.use((req, res, next) => {
    res.locals.t = req.t;
    res.locals.currentLanguage = req.language || 'de';
    res.locals.languages = ['de', 'en'];
    next();
});

// User locals for views
app.use(setUserLocals);

// CSRF Protection (after session, before routes)
// Skip CSRF for setup routes - during setup, session store is MemoryStore which doesn't persist reliably
app.use((req, res, next) => {
    if (req.path.startsWith('/setup')) {
        return next();
    }
    csrfTokenMiddleware(req, res, next);
});
app.use((req, res, next) => {
    if (req.path.startsWith('/setup')) {
        return next();
    }
    csrfSynchronisedProtection(req, res, next);
});

// Load setup data from marker file (cached)
let cachedSetupData = null;
async function getSetupData() {
    if (cachedSetupData) return cachedSetupData;
    try {
        const fs = require('fs').promises;
        const setupContent = await fs.readFile('/app/infrastructure/.setup-complete', 'utf8');
        cachedSetupData = JSON.parse(setupContent);
    } catch {
        cachedSetupData = {};
    }
    return cachedSetupData;
}

async function getServerIp() {
    // Prefer dashboard domain (NPM) over server IP for external URLs
    if (process.env.NPM_DASHBOARD_DOMAIN) {
        return process.env.NPM_DASHBOARD_DOMAIN;
    }
    const data = await getSetupData();
    return data.serverIp || process.env.SERVER_IP || 'localhost';
}

async function getDefaultLanguage() {
    const data = await getSetupData();
    return data.defaultLanguage || 'de';
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
    // Update status for navbar badge (only for admins, from cache - no API call)
    res.locals.updateStatus = updateService.getCachedUpdateStatus();
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
app.use('/proxy', proxyRoutes);
app.use('/profile', profileRoutes);
app.use('/backups', backupRoutes);

// Workspace routes
app.use('/workspaces', requireAuth, workspaceRoutes);
app.use('/settings/api-keys', requireAuth, apiKeyRoutes);

// Apply rate limiting to workspace actions
app.use('/workspaces/:projectName/start', workspaceLimiter);
app.use('/workspaces/:projectName/stop', workspaceLimiter);
app.use('/workspaces/:projectName/sync/:direction', workspaceLimiter);

// Workspace IDE Proxy - proxies requests to the workspace container
// This allows access to code-server through the dashboard without exposing ports directly
app.use('/workspace-proxy', requireAuth, async (req, res, next) => {
    try {
        // Extract projectName from the URL path (first segment after /workspace-proxy/)
        const pathParts = req.path.split('/').filter(p => p);
        let projectName = pathParts[0];

        // If no projectName in path, check session for active workspace
        if (!projectName || projectName.startsWith('_') || projectName === 'static' || projectName === 'vscode') {
            projectName = req.session.activeWorkspace;
            if (!projectName) {
                logger.warn('Workspace proxy: No project name in path or session');
                return res.status(400).json({ error: 'Project name required' });
            }
        }

        const userId = req.session.user.id;
        const workspace = await workspaceService.getWorkspace(userId, projectName);

        if (!workspace) {
            return res.status(404).json({ error: 'Workspace not found' });
        }

        if (workspace.status !== 'running') {
            return res.status(400).json({ error: 'Workspace is not running' });
        }

        if (!workspace.container_id) {
            return res.status(500).json({ error: 'Workspace container not found' });
        }

        // Store active workspace in session
        req.session.activeWorkspace = projectName;

        // Get container IP from Docker
        const containerIp = await workspaceService.getContainerIp(workspace.container_id);
        if (!containerIp) {
            logger.error('Workspace proxy: Could not get container IP', { containerId: workspace.container_id });
            return res.status(500).json({ error: 'Could not determine container IP' });
        }

        logger.info('Workspace proxy request', {
            projectName,
            containerIp,
            path: req.path,
            originalUrl: req.originalUrl,
            method: req.method
        });

        // Proxy to workspace container with proper redirect handling
        const basePath = `/workspace-proxy/${projectName}`;
        const targetPath = req.path.startsWith(basePath)
            ? req.path.replace(basePath, '') || '/'
            : req.path.replace(/^\/workspace-proxy/, '') || '/';

        logger.info('Workspace proxy target', {
            target: `http://${containerIp}:8080`,
            targetPath,
            basePath
        });

        const proxy = createProxyMiddleware({
            target: `http://${containerIp}:8080`,
            changeOrigin: true,
            ws: true,
            timeout: 30000,
            proxyTimeout: 30000,
            followRedirects: false,
            pathRewrite: (path) => {
                // path here is req.path which is relative to the mount point (/workspace-proxy)
                // So for /workspace-proxy/tetris/, path = /tetris/
                // We need to strip the project name prefix to get the code-server path
                const rewritten = path.replace(new RegExp(`^/${projectName}`), '') || '/';
                logger.info('Workspace proxy pathRewrite', { original: path, rewritten, projectName });
                return rewritten;
            },
            onProxyReq: (proxyReq, req) => {
                proxyReq.removeHeader('origin');
                logger.info('Workspace proxy onProxyReq', {
                    path: proxyReq.path,
                    method: proxyReq.method
                });
            },
            onProxyRes: (proxyRes, req, res) => {
                logger.info('Workspace proxy onProxyRes', {
                    statusCode: proxyRes.statusCode,
                    headers: proxyRes.headers
                });
                // Rewrite Location header for redirects
                const location = proxyRes.headers['location'];
                if (location) {
                    // Handle relative redirects (like "./?folder=/workspace")
                    if (location.startsWith('./') || location.startsWith('?')) {
                        proxyRes.headers['location'] = `${basePath}/${location.replace('./', '')}`;
                    } else if (location.startsWith('/') && !location.startsWith(basePath)) {
                        // Handle absolute paths
                        proxyRes.headers['location'] = `${basePath}${location}`;
                    }
                    logger.info('Workspace proxy redirect rewritten', {
                        original: location,
                        rewritten: proxyRes.headers['location']
                    });
                }
            },
            onError: (err, req, res) => {
                logger.error('Workspace proxy error', {
                    error: err.message,
                    code: err.code,
                    projectName,
                    path: req.path
                });
                if (!res.headersSent) {
                    res.status(502).json({ error: 'Workspace unavailable: ' + err.message });
                }
            }
        });

        return proxy(req, res, next);
    } catch (error) {
        logger.error('Workspace proxy setup error', { error: error.message, stack: error.stack });
        return res.status(500).json({ error: 'Proxy error' });
    }
});

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

/**
 * Initialize NPM default host
 * Creates a catch-all proxy host that redirects unknown domains to the dashboard
 * This prevents the default NPM "Congratulations" page from showing
 */
async function initializeNpmDefaultHost() {
    if (!proxyService.isEnabled()) {
        logger.debug('NPM integration disabled, skipping default host setup');
        return;
    }

    // Wait a bit for NPM to be fully ready after startup
    setTimeout(async () => {
        try {
            // Check if NPM API is reachable
            const isReady = await proxyService.waitForApi(5, 2000);
            if (!isReady) {
                logger.warn('NPM API not ready, will retry default host setup later');
                return;
            }

            // Create or verify default host exists
            const result = await proxyService.ensureDefaultHost();
            if (result.success) {
                if (result.existed) {
                    logger.info('NPM default host already configured');
                } else {
                    logger.info('NPM default host created - unknown domains will redirect to dashboard');
                }
            } else {
                logger.warn('Failed to setup NPM default host', { error: result.error });
            }
        } catch (error) {
            logger.warn('Error initializing NPM default host', { error: error.message });
        }
    }, 10000); // Wait 10 seconds after startup
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

            // Initialize NPM default host (async, non-blocking)
            initializeNpmDefaultHost();

            // Initialize update checker (daily auto-check)
            updateService.initUpdateChecker();

            // Workspace: Cleanup orphaned containers on startup
            try {
                await workspaceService.cleanupOrphanedWorkspaces();
                logger.info('Workspace orphan cleanup completed');
            } catch (error) {
                logger.warn('Workspace orphan cleanup failed', { error: error.message });
            }

            // Workspace: Start idle timeout cron (every 5 minutes)
            setInterval(async () => {
                try {
                    await workspaceService.checkIdleWorkspaces();
                } catch (error) {
                    logger.warn('Workspace idle check failed', { error: error.message });
                }
            }, 5 * 60 * 1000);
            logger.info('Workspace idle timeout cron started');

            // Preview: Start cleanup cron (every 5 minutes)
            setInterval(async () => {
                try {
                    await previewService.cleanupExpiredPreviews();
                } catch (error) {
                    logger.warn('Preview cleanup failed', { error: error.message });
                }
            }, 5 * 60 * 1000);
            logger.info('Preview cleanup cron started');
        } else {
            logger.info('Setup not yet completed - setup wizard active');
        }

        const server = app.listen(PORT, '0.0.0.0', () => {
            logger.info('Dashboard started', { port: PORT, url: `http://0.0.0.0:${PORT}` });
            if (!setupComplete) {
                logger.info('Setup wizard available at http://<SERVER-IP>:3000/setup');
            }
        });

        // Handle WebSocket upgrades for workspace proxy
        server.on('upgrade', async (req, socket, head) => {
            const url = req.url || '';
            logger.info('WebSocket upgrade request', { url, headers: req.headers });

            const match = url.match(/^\/workspace-proxy\/([^/?]+)/);
            if (!match) {
                logger.warn('WebSocket upgrade: not a workspace proxy request', { url });
                socket.destroy();
                return;
            }

            const projectName = match[1];
            logger.info('WebSocket upgrade for workspace', { projectName, url });

            // Parse session cookie for authentication
            const cookies = req.headers.cookie || '';
            if (!cookies.includes('connect.sid')) {
                logger.warn('WebSocket upgrade: no session cookie');
                socket.destroy();
                return;
            }

            try {
                const pool = getPool();
                const [rows] = await pool.query(
                    'SELECT container_id, status FROM workspaces WHERE project_name = ?',
                    [projectName]
                );

                if (!rows.length || rows[0].status !== 'running' || !rows[0].container_id) {
                    logger.warn('WebSocket upgrade: workspace not running', { projectName });
                    socket.destroy();
                    return;
                }

                const containerIp = await workspaceService.getContainerIp(rows[0].container_id);
                if (!containerIp) {
                    logger.error('WebSocket upgrade: could not get container IP', { projectName });
                    socket.destroy();
                    return;
                }

                // Rewrite the URL to remove the proxy prefix
                const rewrittenPath = url.replace(`/workspace-proxy/${projectName}`, '') || '/';
                req.url = rewrittenPath;

                logger.info('WebSocket proxy', {
                    projectName,
                    containerIp,
                    originalUrl: url,
                    rewrittenUrl: rewrittenPath
                });

                // Create proxy for this WebSocket connection
                const wsProxy = httpProxy.createProxyServer({
                    target: `http://${containerIp}:8080`,
                    ws: true,
                    changeOrigin: true,
                    xfwd: true
                });

                // Preserve WebSocket headers and add forwarding info
                if (req.headers['sec-websocket-protocol']) {
                    logger.info('WebSocket protocols requested', {
                        protocols: req.headers['sec-websocket-protocol']
                    });
                }

                // Log outgoing proxy request
                wsProxy.on('proxyReqWs', (proxyReq, req, socket, options, head) => {
                    logger.info('WebSocket proxy request sent', {
                        projectName,
                        target: options.target.href,
                        path: proxyReq.path
                    });
                });

                // Handle proxy errors
                wsProxy.on('error', (err, req, res) => {
                    logger.error('WebSocket proxy error', {
                        error: err.message,
                        code: err.code,
                        projectName
                    });
                    if (socket && !socket.destroyed) {
                        socket.destroy();
                    }
                });

                // Handle proxy open
                wsProxy.on('open', (proxySocket) => {
                    logger.info('WebSocket proxy connection opened', { projectName });
                });

                // Handle proxy close
                wsProxy.on('close', (res, socket, head) => {
                    logger.info('WebSocket proxy connection closed', { projectName });
                });

                // Keep socket alive
                socket.setTimeout(0);
                socket.setNoDelay(true);
                socket.setKeepAlive(true, 10000);

                // Proxy the WebSocket request
                wsProxy.ws(req, socket, head);
            } catch (error) {
                logger.error('WebSocket proxy setup error', { error: error.message, projectName });
                if (socket && !socket.destroyed) {
                    socket.destroy();
                }
            }
        });
    } catch (error) {
        // Start anyway on DB error (for setup wizard)
        logger.warn('Starting in setup mode (DB not available)', { error: error.message });
        const server = app.listen(PORT, '0.0.0.0', () => {
            logger.info('Dashboard started in setup mode', { port: PORT });
        });
    }
}

start();
