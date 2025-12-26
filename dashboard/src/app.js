require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const flash = require('express-flash');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { initDatabase, getPool } = require('./config/database');
const { setUserLocals } = require('./middleware/auth');
const autoDeployService = require('./services/autodeploy');
const { logger, requestLogger } = require('./config/logger');

// Routes importieren
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

// Security: Helmet für HTTP Security Headers
// CSP vorübergehend deaktiviert für Debugging
app.use(helmet({
    contentSecurityPolicy: false
}));

// Security: Rate-Limiting für Auth-Routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Minuten
    max: 10, // 10 Versuche pro Fenster
    message: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.',
    standardHeaders: true,
    legacyHeaders: false
});

// Security: Allgemeines Rate-Limiting
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 Minute
    max: 100, // 100 Requests pro Minute
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
app.use(methodOverride('_method'));

// Session Store - wird später initialisiert wenn DB verfügbar
let sessionStore = null;

function createSessionStore() {
    if (sessionStore) return sessionStore;

    try {
        const pool = getPool();
        sessionStore = new MySQLStore({
            clearExpired: true,
            checkExpirationInterval: 900000, // 15 Minuten
            expiration: 86400000, // 24 Stunden
            createDatabaseTable: false, // Tabelle wird in initDatabase erstellt
            schema: {
                tableName: 'sessions',
                columnNames: {
                    session_id: 'session_id',
                    expires: 'expires',
                    data: 'data'
                }
            }
        }, pool);
        logger.info('MySQL Session-Store initialisiert');
        return sessionStore;
    } catch (error) {
        logger.warn('Session-Store fallback auf Memory-Store', { error: error.message });
        return null; // Fallback auf Memory-Store
    }
}

// Session Setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'change-this-secret',
    store: createSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production' && process.env.USE_HTTPS === 'true',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 Stunden
    }
}));

// Flash Messages
app.use(flash());

// User Locals für Views
app.use(setUserLocals);

// Server-IP aus Setup-Marker laden (gecached)
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

// Versionsinformationen laden (aus version.json, erstellt beim Docker-Build)
let versionInfo = { hash: null, date: null };
function loadVersionInfo() {
    try {
        const fs = require('fs');
        const versionPath = path.join(__dirname, '..', 'version.json');
        if (fs.existsSync(versionPath)) {
            const data = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
            if (data.hash && data.hash !== 'unknown') {
                versionInfo = data;
                console.log(`Version: ${versionInfo.hash} (${versionInfo.date})`);
            }
        }
    } catch (error) {
        console.log('Versionsinformationen nicht verfügbar');
    }
}
loadVersionInfo();

// Flash Messages und globale Variablen für Views verfügbar machen
app.use(async (req, res, next) => {
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    res.locals.warning = req.flash('warning');
    res.locals.info = req.flash('info');
    res.locals.serverIp = await getServerIp();
    res.locals.version = versionInfo;
    next();
});

// Setup Route (vor anderen Routes, ohne Setup-Check)
app.use('/setup', setupRoutes);

// Setup-Check Middleware für alle anderen Routes
app.use(async (req, res, next) => {
    // Setup-Route überspringen
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
        // Bei Fehler (z.B. DB nicht erreichbar) zum Setup weiterleiten
        console.log('Setup-Check Fehler, leite zum Setup weiter:', error.message);
        return res.redirect('/setup');
    }
});

// Routes
// Auth-Routes mit speziellem Rate-Limiter
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

// Error Handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).render('error', {
        title: 'Fehler',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Ein Fehler ist aufgetreten.'
    });
});

// Auto-Deploy Polling Intervall (5 Minuten)
const AUTO_DEPLOY_INTERVAL = 5 * 60 * 1000;
let autoDeployInterval = null;

function startAutoDeployPolling() {
    if (autoDeployInterval) {
        clearInterval(autoDeployInterval);
    }

    logger.info('AutoDeploy Polling-Service gestartet', { interval: '5 Minuten' });

    // Erster Zyklus nach 30 Sekunden (um Server-Start abzuwarten)
    setTimeout(() => {
        autoDeployService.runPollingCycle();
    }, 30000);

    // Dann alle 5 Minuten
    autoDeployInterval = setInterval(() => {
        autoDeployService.runPollingCycle();
    }, AUTO_DEPLOY_INTERVAL);
}

// Server starten
async function start() {
    try {
        // Prüfen ob Setup abgeschlossen ist
        const { isSetupComplete } = require('./routes/setup');
        const setupComplete = await isSetupComplete();

        if (setupComplete) {
            // Datenbank initialisieren nur wenn Setup fertig
            await initDatabase();
            logger.info('Setup bereits abgeschlossen - Normalmodus');

            // Auto-Deploy Polling starten
            startAutoDeployPolling();
        } else {
            logger.info('Setup noch nicht abgeschlossen - Setup-Wizard aktiv');
        }

        app.listen(PORT, '0.0.0.0', () => {
            logger.info('Dashboard gestartet', { port: PORT, url: `http://0.0.0.0:${PORT}` });
            if (!setupComplete) {
                logger.info('Setup-Wizard verfügbar unter http://<SERVER-IP>:3000/setup');
            }
        });
    } catch (error) {
        // Bei DB-Fehler trotzdem starten (für Setup-Wizard)
        logger.warn('Starte im Setup-Modus (DB nicht verfügbar)', { error: error.message });
        app.listen(PORT, '0.0.0.0', () => {
            logger.info('Dashboard gestartet im Setup-Modus', { port: PORT });
        });
    }
}

start();
