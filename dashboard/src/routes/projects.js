const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const projectService = require('../services/project');
const dockerService = require('../services/docker');
const gitService = require('../services/git');

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

        res.render('projects/show', {
            title: project.name,
            project,
            gitStatus
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

// Projekt löschen
router.delete('/:name', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;

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

        gitService.disconnectRepository(projectPath);
        req.flash('success', 'Git-Verbindung getrennt');
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        console.error('Git disconnect error:', error);
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

module.exports = router;
