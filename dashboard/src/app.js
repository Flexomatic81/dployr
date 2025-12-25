require('dotenv').config();

const express = require('express');
const session = require('express-session');
const flash = require('express-flash');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const path = require('path');

const { initDatabase } = require('./config/database');
const { setUserLocals } = require('./middleware/auth');
const autoDeployService = require('./services/autodeploy');

// Routes importieren
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const projectRoutes = require('./routes/projects');
const logRoutes = require('./routes/logs');
const databaseRoutes = require('./routes/databases');
const setupRoutes = require('./routes/setup');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Session Setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'change-this-secret',
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

// Git-Versionsinformationen laden (einmalig beim Start)
let versionInfo = { hash: null, date: null };
function loadVersionInfo() {
    try {
        const { execSync } = require('child_process');
        const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: '/app' }).trim();
        const dateStr = execSync('git log -1 --format=%ci', { encoding: 'utf8', cwd: '/app' }).trim();
        const date = new Date(dateStr);
        versionInfo = {
            hash,
            date: date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
        };
        console.log(`Version: ${versionInfo.hash} (${versionInfo.date})`);
    } catch (error) {
        console.log('Git-Versionsinformationen nicht verfügbar');
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
app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/projects', projectRoutes);
app.use('/logs', logRoutes);
app.use('/databases', databaseRoutes);
app.use('/admin', adminRoutes);

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
    console.error(err.stack);
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

    console.log('[AutoDeploy] Polling-Service gestartet (Intervall: 5 Minuten)');

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
            console.log('Setup bereits abgeschlossen - Normalmodus');

            // Auto-Deploy Polling starten
            startAutoDeployPolling();
        } else {
            console.log('Setup noch nicht abgeschlossen - Setup-Wizard aktiv');
        }

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Dashboard läuft auf http://0.0.0.0:${PORT}`);
            if (!setupComplete) {
                console.log('Öffne im Browser: http://<SERVER-IP>:3000/setup');
            }
        });
    } catch (error) {
        // Bei DB-Fehler trotzdem starten (für Setup-Wizard)
        console.log('Starte im Setup-Modus (DB nicht verfügbar)');
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Dashboard läuft auf http://0.0.0.0:${PORT}`);
            console.log('Öffne im Browser: http://<SERVER-IP>:3000/setup');
        });
    }
}

start();
