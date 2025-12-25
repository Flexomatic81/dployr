const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const projectService = require('../services/project');
const dockerService = require('../services/docker');
const gitService = require('../services/git');
const zipService = require('../services/zip');
const autoDeployService = require('../services/autodeploy');
const upload = require('../middleware/upload');

// Alle Projekte anzeigen
router.get('/', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const projects = await projectService.getUserProjects(systemUsername);

        // Git-Status für jedes Projekt hinzufügen
        for (const project of projects) {
            project.gitConnected = gitService.isGitRepository(project.path);
        }

        res.render('projects/index', {
            title: 'Projekte',
            projects
        });
    } catch (error) {
        console.error('Fehler beim Laden der Projekte:', error);
        req.flash('error', 'Fehler beim Laden der Projekte');
        res.redirect('/dashboard');
    }
});

// Neues Projekt erstellen - Formular
router.get('/create', requireAuth, async (req, res) => {
    try {
        const templates = await projectService.getAvailableTemplates();
        const nextPort = await projectService.getNextAvailablePort();

        res.render('projects/create', {
            title: 'Neues Projekt',
            templates,
            nextPort
        });
    } catch (error) {
        console.error('Fehler beim Laden des Formulars:', error);
        req.flash('error', 'Fehler beim Laden des Formulars');
        res.redirect('/projects');
    }
});

// Neues Projekt erstellen - Verarbeitung
router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, template, port } = req.body;
        const systemUsername = req.session.user.system_username;

        const project = await projectService.createProject(
            systemUsername,
            name,
            template,
            { port: parseInt(port) }
        );

        req.flash('success', `Projekt "${name}" erfolgreich erstellt!`);
        res.redirect(`/projects/${name}`);
    } catch (error) {
        console.error('Fehler beim Erstellen des Projekts:', error);
        req.flash('error', error.message || 'Fehler beim Erstellen des Projekts');
        res.redirect('/projects/create');
    }
});

// Neues Projekt von ZIP erstellen - Verarbeitung
router.post('/from-zip', requireAuth, upload.single('zipfile'), async (req, res) => {
    try {
        const { name, port } = req.body;
        const systemUsername = req.session.user.system_username;

        // Prüfen ob Datei hochgeladen wurde
        if (!req.file) {
            req.flash('error', 'Bitte wähle eine ZIP-Datei aus');
            return res.redirect('/projects/create');
        }

        // Validierung
        if (!/^[a-z0-9-]+$/.test(name)) {
            req.flash('error', 'Projektname darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten');
            return res.redirect('/projects/create');
        }

        const result = await zipService.createProjectFromZip(
            systemUsername,
            name,
            req.file.path,
            parseInt(port)
        );

        const typeNames = {
            static: 'Statische Website',
            php: 'PHP Website',
            nodejs: 'Node.js App',
            laravel: 'Laravel/Symfony',
            'nodejs-static': 'React/Vue (Static Build)',
            nextjs: 'Next.js (SSR)'
        };

        req.flash('success', `Projekt "${name}" erfolgreich aus ZIP erstellt! Erkannt als: ${typeNames[result.projectType] || result.projectType}`);
        res.redirect(`/projects/${name}`);
    } catch (error) {
        console.error('Fehler beim Erstellen des ZIP-Projekts:', error);
        req.flash('error', error.message || 'Fehler beim Erstellen des Projekts');
        res.redirect('/projects/create');
    }
});

// Neues Projekt von Git erstellen - Verarbeitung
router.post('/from-git', requireAuth, async (req, res) => {
    try {
        const { name, repo_url, access_token, port } = req.body;
        const systemUsername = req.session.user.system_username;

        // Validierung
        if (!/^[a-z0-9-]+$/.test(name)) {
            req.flash('error', 'Projektname darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten');
            return res.redirect('/projects/create');
        }

        if (!gitService.isValidGitUrl(repo_url)) {
            req.flash('error', 'Ungültige Repository-URL. Unterstützt werden GitHub, GitLab und Bitbucket HTTPS-URLs.');
            return res.redirect('/projects/create');
        }

        const result = await gitService.createProjectFromGit(
            systemUsername,
            name,
            repo_url,
            access_token || null,
            parseInt(port)
        );

        const typeNames = {
            static: 'Statische Website',
            php: 'PHP Website',
            nodejs: 'Node.js App',
            laravel: 'Laravel/Symfony',
            'nodejs-static': 'React/Vue (Static Build)',
            nextjs: 'Next.js (SSR)'
        };

        req.flash('success', `Projekt "${name}" erfolgreich von Git erstellt! Erkannt als: ${typeNames[result.projectType] || result.projectType}`);
        res.redirect(`/projects/${name}`);
    } catch (error) {
        console.error('Fehler beim Erstellen des Git-Projekts:', error);
        req.flash('error', error.message || 'Fehler beim Erstellen des Projekts');
        res.redirect('/projects/create');
    }
});

// Einzelnes Projekt anzeigen
router.get('/:name', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const project = await projectService.getProjectInfo(systemUsername, req.params.name);

        if (!project) {
            req.flash('error', 'Projekt nicht gefunden');
            return res.redirect('/projects');
        }

        // Git-Status abrufen
        const gitStatus = gitService.getGitStatus(project.path);

        // Projekttyp automatisch erkennen und mit aktuellem vergleichen
        const detectedType = gitService.detectProjectType(project.path);

        // Mapping von erkannten Typen zu Template-Namen
        const typeToTemplate = {
            static: 'static-website',
            php: 'php-website',
            nodejs: 'nodejs-app',
            laravel: 'laravel',
            'nodejs-static': 'nodejs-static',
            nextjs: 'nextjs'
        };

        const detectedTemplateType = typeToTemplate[detectedType] || 'static-website';
        const typeMismatch = project.templateType !== detectedTemplateType;

        // Umgebungsvariablen laden
        const envContent = await projectService.readEnvFile(systemUsername, req.params.name);

        // .env.example prüfen
        const envExample = await projectService.checkEnvExample(systemUsername, req.params.name);

        // Datenbanken des Users laden
        const userDatabases = await projectService.getUserDbCredentials(systemUsername);

        // Auto-Deploy Konfiguration laden (nur für Git-Projekte)
        let autoDeployConfig = null;
        let deploymentHistory = [];
        if (gitStatus && gitStatus.connected) {
            autoDeployConfig = await autoDeployService.getAutoDeployConfig(req.session.user.id, req.params.name);
            if (autoDeployConfig) {
                deploymentHistory = await autoDeployService.getDeploymentHistory(req.session.user.id, req.params.name, 5);
            }
        }

        res.render('projects/show', {
            title: project.name,
            project,
            gitStatus,
            detectedType,
            detectedTemplateType,
            typeMismatch,
            envContent,
            envExample,
            userDatabases,
            autoDeployConfig,
            deploymentHistory
        });
    } catch (error) {
        console.error('Fehler beim Laden des Projekts:', error);
        req.flash('error', 'Fehler beim Laden des Projekts');
        res.redirect('/projects');
    }
});

// Projekt starten
router.post('/:name/start', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const project = await projectService.getProjectInfo(systemUsername, req.params.name);

        if (!project) {
            req.flash('error', 'Projekt nicht gefunden');
            return res.redirect('/projects');
        }

        await dockerService.startProject(project.path);
        req.flash('success', `Projekt "${req.params.name}" gestartet`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Fehler beim Starten:', error);
        req.flash('error', 'Fehler beim Starten: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Projekt stoppen
router.post('/:name/stop', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const project = await projectService.getProjectInfo(systemUsername, req.params.name);

        if (!project) {
            req.flash('error', 'Projekt nicht gefunden');
            return res.redirect('/projects');
        }

        await dockerService.stopProject(project.path);
        req.flash('success', `Projekt "${req.params.name}" gestoppt`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Fehler beim Stoppen:', error);
        req.flash('error', 'Fehler beim Stoppen: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Projekt neustarten
router.post('/:name/restart', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const project = await projectService.getProjectInfo(systemUsername, req.params.name);

        if (!project) {
            req.flash('error', 'Projekt nicht gefunden');
            return res.redirect('/projects');
        }

        await dockerService.restartProject(project.path);
        req.flash('success', `Projekt "${req.params.name}" neugestartet`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Fehler beim Neustarten:', error);
        req.flash('error', 'Fehler beim Neustarten: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Projekttyp ändern
router.post('/:name/change-type', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const { type } = req.body;

        const typeNames = {
            static: 'Statische Website',
            php: 'PHP Website',
            nodejs: 'Node.js App',
            laravel: 'Laravel/Symfony',
            'nodejs-static': 'React/Vue (Static Build)',
            nextjs: 'Next.js (SSR)'
        };

        if (!typeNames[type]) {
            req.flash('error', 'Ungültiger Projekttyp');
            return res.redirect(`/projects/${req.params.name}`);
        }

        const result = await projectService.changeProjectType(systemUsername, req.params.name, type);
        req.flash('success', `Projekttyp auf "${typeNames[type]}" geändert. Container wurde neu gestartet.`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Fehler beim Ändern des Projekttyps:', error);
        req.flash('error', 'Fehler beim Ändern: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Umgebungsvariablen speichern
router.post('/:name/env', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const { envContent } = req.body;

        await projectService.writeEnvFile(systemUsername, req.params.name, envContent);
        req.flash('success', 'Umgebungsvariablen gespeichert. Container-Neustart empfohlen.');
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Fehler beim Speichern der Umgebungsvariablen:', error);
        req.flash('error', 'Fehler beim Speichern: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// .env.example zu .env kopieren
router.post('/:name/env/copy-example', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;

        const result = await projectService.copyEnvExample(systemUsername, req.params.name);
        req.flash('success', `${result.filename} wurde zu .env kopiert. Container-Neustart empfohlen.`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Fehler beim Kopieren der .env.example:', error);
        req.flash('error', 'Fehler: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Datenbank-Credentials zu .env hinzufügen
router.post('/:name/env/add-db', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const { database } = req.body;

        // Alle DB-Credentials des Users laden
        const credentials = await projectService.getUserDbCredentials(systemUsername);
        const dbCredentials = credentials.find(c => c.database === database);

        if (!dbCredentials) {
            req.flash('error', 'Datenbank nicht gefunden');
            return res.redirect(`/projects/${req.params.name}`);
        }

        await projectService.appendDbCredentials(systemUsername, req.params.name, dbCredentials);
        req.flash('success', 'Datenbank-Credentials wurden zur .env hinzugefügt. Container-Neustart empfohlen.');
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Fehler beim Hinzufügen der DB-Credentials:', error);
        req.flash('error', 'Fehler: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Projekt löschen
router.delete('/:name', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;

        // Auto-Deploy Daten löschen
        await autoDeployService.deleteAutoDeploy(req.session.user.id, req.params.name);

        await projectService.deleteProject(systemUsername, req.params.name);
        req.flash('success', `Projekt "${req.params.name}" gelöscht`);
        res.redirect('/projects');
    } catch (error) {
        console.error('Fehler beim Löschen:', error);
        req.flash('error', 'Fehler beim Löschen: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Git Pull durchführen
router.post('/:name/git/pull', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const projectPath = gitService.getProjectPath(systemUsername, req.params.name);

        if (!gitService.isGitRepository(projectPath)) {
            req.flash('error', 'Kein Git-Repository verbunden');
            return res.redirect(`/projects/${req.params.name}`);
        }

        const result = await gitService.pullChanges(projectPath);

        if (result.hasChanges) {
            req.flash('success', 'Änderungen erfolgreich gepullt! Neustart des Projekts empfohlen.');
        } else {
            req.flash('info', 'Keine neuen Änderungen vorhanden.');
        }

        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Git pull error:', error);
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Git Verbindung trennen
router.post('/:name/git/disconnect', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const projectPath = gitService.getProjectPath(systemUsername, req.params.name);

        if (!gitService.isGitRepository(projectPath)) {
            req.flash('error', 'Kein Git-Repository verbunden');
            return res.redirect(`/projects/${req.params.name}`);
        }

        // Auto-Deploy deaktivieren wenn Git getrennt wird
        await autoDeployService.deleteAutoDeploy(req.session.user.id, req.params.name);

        gitService.disconnectRepository(projectPath);
        req.flash('success', 'Git-Verbindung getrennt');
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Git disconnect error:', error);
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Auto-Deploy aktivieren
router.post('/:name/autodeploy/enable', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const projectPath = gitService.getProjectPath(systemUsername, req.params.name);

        if (!gitService.isGitRepository(projectPath)) {
            req.flash('error', 'Auto-Deploy ist nur für Git-Projekte verfügbar');
            return res.redirect(`/projects/${req.params.name}`);
        }

        // Branch aus Git-Status holen
        const gitStatus = gitService.getGitStatus(projectPath);
        const branch = gitStatus?.branch || 'main';

        await autoDeployService.enableAutoDeploy(req.session.user.id, req.params.name, branch);
        req.flash('success', `Auto-Deploy aktiviert. Prüft alle 5 Minuten auf Updates.`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Auto-Deploy enable error:', error);
        req.flash('error', 'Fehler beim Aktivieren: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Auto-Deploy deaktivieren
router.post('/:name/autodeploy/disable', requireAuth, async (req, res) => {
    try {
        await autoDeployService.disableAutoDeploy(req.session.user.id, req.params.name);
        req.flash('success', 'Auto-Deploy deaktiviert');
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Auto-Deploy disable error:', error);
        req.flash('error', 'Fehler beim Deaktivieren: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Auto-Deploy Intervall ändern
router.post('/:name/autodeploy/interval', requireAuth, async (req, res) => {
    try {
        const interval = parseInt(req.body.interval);
        await autoDeployService.updateInterval(req.session.user.id, req.params.name, interval);
        req.flash('success', `Intervall auf ${interval} Minuten gesetzt`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Auto-Deploy interval error:', error);
        req.flash('error', 'Fehler beim Ändern des Intervalls: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Auto-Deploy manuell triggern
router.post('/:name/autodeploy/trigger', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const projectPath = gitService.getProjectPath(systemUsername, req.params.name);

        if (!gitService.isGitRepository(projectPath)) {
            req.flash('error', 'Kein Git-Repository verbunden');
            return res.redirect(`/projects/${req.params.name}`);
        }

        const result = await autoDeployService.executeDeploy(
            req.session.user.id,
            systemUsername,
            req.params.name,
            'manual'
        );

        if (result.skipped) {
            req.flash('info', 'Ein Deployment läuft bereits');
        } else if (result.success) {
            if (result.hasChanges) {
                req.flash('success', `Deployment erfolgreich: ${result.oldCommit} → ${result.newCommit}`);
            } else {
                req.flash('info', 'Keine Änderungen vorhanden');
            }
        } else {
            req.flash('error', 'Deployment fehlgeschlagen: ' + result.error);
        }

        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Auto-Deploy trigger error:', error);
        req.flash('error', 'Fehler: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Deployment-Historie abrufen (JSON API)
router.get('/:name/autodeploy/history', requireAuth, async (req, res) => {
    try {
        const history = await autoDeployService.getDeploymentHistory(
            req.session.user.id,
            req.params.name,
            parseInt(req.query.limit) || 10
        );
        res.json(history);
    } catch (error) {
        console.error('Deployment history error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
