const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getProjectAccess, requirePermission } = require('../middleware/projectAccess');
const projectService = require('../services/project');
const dockerService = require('../services/docker');
const gitService = require('../services/git');
const zipService = require('../services/zip');
const autoDeployService = require('../services/autodeploy');
const sharingService = require('../services/sharing');
const upload = require('../middleware/upload');
const { logger } = require('../config/logger');

// Alle Projekte anzeigen
router.get('/', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const userId = req.session.user.id;

        // Eigene Projekte laden
        const projects = await projectService.getUserProjects(systemUsername);

        // Git-Status für jedes Projekt hinzufügen
        for (const project of projects) {
            project.gitConnected = gitService.isGitRepository(project.path);
        }

        // Geteilte Projekte laden
        const sharedProjectInfos = await sharingService.getSharedProjects(userId);
        const sharedProjects = [];

        for (const share of sharedProjectInfos) {
            const project = await projectService.getProjectInfo(share.owner_system_username, share.project_name);
            if (project) {
                project.gitConnected = gitService.isGitRepository(project.path);
                project.shareInfo = {
                    permission: share.permission,
                    permissionLabel: sharingService.getPermissionLabel(share.permission),
                    permissionIcon: sharingService.getPermissionIcon(share.permission),
                    ownerUsername: share.owner_username,
                    ownerSystemUsername: share.owner_system_username
                };
                sharedProjects.push(project);
            }
        }

        res.render('projects/index', {
            title: 'Projekte',
            projects,
            sharedProjects
        });
    } catch (error) {
        logger.error('Fehler beim Laden der Projekte', { error: error.message });
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
        logger.error('Fehler beim Laden des Formulars', { error: error.message });
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
        logger.error('Fehler beim Erstellen des Projekts', { error: error.message });
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
        logger.error('Fehler beim Erstellen des ZIP-Projekts', { error: error.message });
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
        logger.error('Fehler beim Erstellen des Git-Projekts', { error: error.message });
        req.flash('error', error.message || 'Fehler beim Erstellen des Projekts');
        res.redirect('/projects/create');
    }
});

// Einzelnes Projekt anzeigen
router.get('/:name', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        const access = req.projectAccess;
        const project = access.project;
        const systemUsername = access.systemUsername;

        // Git-Status abrufen
        const gitStatus = await gitService.getGitStatus(project.path);

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

        // Datenbanken des Users laden (nur für Besitzer oder manage/full)
        let userDatabases = [];
        if (access.isOwner || access.permission === 'manage' || access.permission === 'full') {
            userDatabases = await projectService.getUserDbCredentials(req.session.user.system_username);
        }

        // Auto-Deploy Konfiguration laden (nur für Besitzer bei Git-Projekten)
        let autoDeployConfig = null;
        let deploymentHistory = [];
        if (access.isOwner && gitStatus && gitStatus.connected) {
            autoDeployConfig = await autoDeployService.getAutoDeployConfig(req.session.user.id, req.params.name);
            if (autoDeployConfig) {
                deploymentHistory = await autoDeployService.getDeploymentHistory(req.session.user.id, req.params.name, 5);
            }
        }

        // Sharing-Informationen laden (nur für Besitzer)
        let projectShares = [];
        let availableUsers = [];
        if (access.isOwner) {
            projectShares = await sharingService.getProjectShares(req.session.user.id, req.params.name);
            availableUsers = await sharingService.getAllUsersExcept(req.session.user.id);
            // User die bereits Zugriff haben aus der Liste entfernen
            const sharedUserIds = projectShares.map(s => s.shared_with_id);
            availableUsers = availableUsers.filter(u => !sharedUserIds.includes(u.id));
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
            deploymentHistory,
            // Sharing-Daten
            projectAccess: access,
            projectShares,
            availableUsers,
            permissionLabels: {
                read: 'Ansehen',
                manage: 'Verwalten',
                full: 'Vollzugriff'
            }
        });
    } catch (error) {
        logger.error('Fehler beim Laden des Projekts', { error: error.message });
        req.flash('error', 'Fehler beim Laden des Projekts');
        res.redirect('/projects');
    }
});

// Projekt starten (manage oder höher)
router.post('/:name/start', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const project = req.projectAccess.project;
        await dockerService.startProject(project.path);
        req.flash('success', `Projekt "${req.params.name}" gestartet`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Fehler beim Starten', { error: error.message });
        req.flash('error', 'Fehler beim Starten: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Projekt stoppen (manage oder höher)
router.post('/:name/stop', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const project = req.projectAccess.project;
        await dockerService.stopProject(project.path);
        req.flash('success', `Projekt "${req.params.name}" gestoppt`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Fehler beim Stoppen', { error: error.message });
        req.flash('error', 'Fehler beim Stoppen: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Projekt neustarten (manage oder höher)
router.post('/:name/restart', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const project = req.projectAccess.project;
        await dockerService.restartProject(project.path);
        req.flash('success', `Projekt "${req.params.name}" neugestartet`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Fehler beim Neustarten', { error: error.message });
        req.flash('error', 'Fehler beim Neustarten: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Projekttyp ändern (full oder Besitzer)
router.post('/:name/change-type', requireAuth, getProjectAccess(), requirePermission('full'), async (req, res) => {
    try {
        const systemUsername = req.projectAccess.systemUsername;
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
        logger.error('Fehler beim Ändern des Projekttyps', { error: error.message });
        req.flash('error', 'Fehler beim Ändern: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Umgebungsvariablen speichern (manage oder höher)
router.post('/:name/env', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const systemUsername = req.projectAccess.systemUsername;
        const { envContent } = req.body;

        await projectService.writeEnvFile(systemUsername, req.params.name, envContent);
        req.flash('success', 'Umgebungsvariablen gespeichert. Container-Neustart empfohlen.');
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Fehler beim Speichern der Umgebungsvariablen', { error: error.message });
        req.flash('error', 'Fehler beim Speichern: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// .env.example zu .env kopieren (manage oder höher)
router.post('/:name/env/copy-example', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const systemUsername = req.projectAccess.systemUsername;

        const result = await projectService.copyEnvExample(systemUsername, req.params.name);
        req.flash('success', `${result.filename} wurde zu .env kopiert. Container-Neustart empfohlen.`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Fehler beim Kopieren der .env.example', { error: error.message });
        req.flash('error', 'Fehler: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Datenbank-Credentials zu .env hinzufügen (manage oder höher)
router.post('/:name/env/add-db', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const systemUsername = req.projectAccess.systemUsername;
        const { database } = req.body;

        // Alle DB-Credentials des aktuellen Users laden
        const credentials = await projectService.getUserDbCredentials(req.session.user.system_username);
        const dbCredentials = credentials.find(c => c.database === database);

        if (!dbCredentials) {
            req.flash('error', 'Datenbank nicht gefunden');
            return res.redirect(`/projects/${req.params.name}`);
        }

        await projectService.appendDbCredentials(systemUsername, req.params.name, dbCredentials);
        req.flash('success', 'Datenbank-Credentials wurden zur .env hinzugefügt. Container-Neustart empfohlen.');
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Fehler beim Hinzufügen der DB-Credentials', { error: error.message });
        req.flash('error', 'Fehler: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Projekt löschen (nur Besitzer)
router.delete('/:name', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        // Nur Besitzer darf löschen
        if (!req.projectAccess.isOwner) {
            req.flash('error', 'Nur der Besitzer kann das Projekt löschen');
            return res.redirect(`/projects/${req.params.name}`);
        }

        const systemUsername = req.projectAccess.systemUsername;

        // Alle Shares für dieses Projekt löschen
        await sharingService.deleteAllSharesForProject(req.session.user.id, req.params.name);

        // Auto-Deploy Daten löschen
        await autoDeployService.deleteAutoDeploy(req.session.user.id, req.params.name);

        await projectService.deleteProject(systemUsername, req.params.name);
        req.flash('success', `Projekt "${req.params.name}" gelöscht`);
        res.redirect('/projects');
    } catch (error) {
        logger.error('Fehler beim Löschen', { error: error.message });
        req.flash('error', 'Fehler beim Löschen: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Git Pull durchführen (manage oder höher)
router.post('/:name/git/pull', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const systemUsername = req.projectAccess.systemUsername;
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
        logger.error('Git pull error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Git Verbindung trennen (nur Besitzer)
router.post('/:name/git/disconnect', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        // Nur Besitzer darf Git trennen
        if (!req.projectAccess.isOwner) {
            req.flash('error', 'Nur der Besitzer kann die Git-Verbindung trennen');
            return res.redirect(`/projects/${req.params.name}`);
        }

        const systemUsername = req.projectAccess.systemUsername;
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
        logger.error('Git disconnect error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Auto-Deploy aktivieren (nur Besitzer)
router.post('/:name/autodeploy/enable', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        // Nur Besitzer darf Auto-Deploy konfigurieren
        if (!req.projectAccess.isOwner) {
            req.flash('error', 'Nur der Besitzer kann Auto-Deploy konfigurieren');
            return res.redirect(`/projects/${req.params.name}`);
        }

        const systemUsername = req.projectAccess.systemUsername;
        const projectPath = gitService.getProjectPath(systemUsername, req.params.name);

        if (!gitService.isGitRepository(projectPath)) {
            req.flash('error', 'Auto-Deploy ist nur für Git-Projekte verfügbar');
            return res.redirect(`/projects/${req.params.name}`);
        }

        // Branch aus Git-Status holen
        const gitStatus = await gitService.getGitStatus(projectPath);
        const branch = gitStatus?.branch || 'main';

        await autoDeployService.enableAutoDeploy(req.session.user.id, req.params.name, branch);
        req.flash('success', `Auto-Deploy aktiviert. Prüft alle 5 Minuten auf Updates.`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Auto-Deploy enable error', { error: error.message });
        req.flash('error', 'Fehler beim Aktivieren: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Auto-Deploy deaktivieren (nur Besitzer)
router.post('/:name/autodeploy/disable', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', 'Nur der Besitzer kann Auto-Deploy konfigurieren');
            return res.redirect(`/projects/${req.params.name}`);
        }

        await autoDeployService.disableAutoDeploy(req.session.user.id, req.params.name);
        req.flash('success', 'Auto-Deploy deaktiviert');
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Auto-Deploy disable error', { error: error.message });
        req.flash('error', 'Fehler beim Deaktivieren: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Auto-Deploy Intervall ändern (nur Besitzer)
router.post('/:name/autodeploy/interval', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', 'Nur der Besitzer kann Auto-Deploy konfigurieren');
            return res.redirect(`/projects/${req.params.name}`);
        }

        const interval = parseInt(req.body.interval);
        await autoDeployService.updateInterval(req.session.user.id, req.params.name, interval);
        req.flash('success', `Intervall auf ${interval} Minuten gesetzt`);
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Auto-Deploy interval error', { error: error.message });
        req.flash('error', 'Fehler beim Ändern des Intervalls: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Auto-Deploy manuell triggern (manage oder höher - auch für geteilte User)
router.post('/:name/autodeploy/trigger', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const systemUsername = req.projectAccess.systemUsername;
        const projectPath = gitService.getProjectPath(systemUsername, req.params.name);

        if (!gitService.isGitRepository(projectPath)) {
            req.flash('error', 'Kein Git-Repository verbunden');
            return res.redirect(`/projects/${req.params.name}`);
        }

        // Für geteilte Projekte: Owner-ID verwenden
        const ownerId = req.projectAccess.isOwner ? req.session.user.id : req.projectAccess.ownerId;

        const result = await autoDeployService.executeDeploy(
            ownerId,
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
        logger.error('Auto-Deploy trigger error', { error: error.message });
        req.flash('error', 'Fehler: ' + error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Deployment-Historie abrufen (JSON API) - read oder höher
router.get('/:name/autodeploy/history', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        const ownerId = req.projectAccess.isOwner ? req.session.user.id : req.projectAccess.ownerId;
        const history = await autoDeployService.getDeploymentHistory(
            ownerId,
            req.params.name,
            parseInt(req.query.limit) || 10
        );
        res.json(history);
    } catch (error) {
        logger.error('Deployment history error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// ============================
// PROJEKT-SHARING ENDPUNKTE
// ============================

// Projekt teilen - Neuen Share erstellen (nur Besitzer)
router.post('/:name/shares', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', 'Nur der Besitzer kann das Projekt teilen');
            return res.redirect(`/projects/${req.params.name}`);
        }

        const { userId, permission } = req.body;
        const sharedWithId = parseInt(userId);

        if (!sharedWithId || !['read', 'manage', 'full'].includes(permission)) {
            req.flash('error', 'Ungültige Eingabe');
            return res.redirect(`/projects/${req.params.name}`);
        }

        await sharingService.shareProject(
            req.session.user.id,
            req.session.user.system_username,
            req.params.name,
            sharedWithId,
            permission
        );

        req.flash('success', 'Projekt erfolgreich geteilt');
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Share error', { error: error.message });
        req.flash('error', error.message || 'Fehler beim Teilen');
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Share-Berechtigung ändern (nur Besitzer)
router.post('/:name/shares/:userId/update', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', 'Nur der Besitzer kann Berechtigungen ändern');
            return res.redirect(`/projects/${req.params.name}`);
        }

        const { permission } = req.body;
        const sharedWithId = parseInt(req.params.userId);

        if (!['read', 'manage', 'full'].includes(permission)) {
            req.flash('error', 'Ungültige Berechtigung');
            return res.redirect(`/projects/${req.params.name}`);
        }

        await sharingService.updateSharePermission(
            req.session.user.id,
            req.params.name,
            sharedWithId,
            permission
        );

        req.flash('success', 'Berechtigung aktualisiert');
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Update share error', { error: error.message });
        req.flash('error', error.message || 'Fehler beim Aktualisieren');
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Share entfernen (nur Besitzer)
router.post('/:name/shares/:userId/delete', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', 'Nur der Besitzer kann Freigaben entfernen');
            return res.redirect(`/projects/${req.params.name}`);
        }

        const sharedWithId = parseInt(req.params.userId);

        await sharingService.unshareProject(
            req.session.user.id,
            req.params.name,
            sharedWithId
        );

        req.flash('success', 'Freigabe entfernt');
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Delete share error', { error: error.message });
        req.flash('error', error.message || 'Fehler beim Entfernen');
        res.redirect(`/projects/${req.params.name}`);
    }
});

module.exports = router;
