/**
 * Projects Routes Index
 * Combines all project sub-routers
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { getProjectAccess, requirePermission } = require('../../middleware/projectAccess');
const { validate } = require('../../middleware/validation');
const projectService = require('../../services/project');
const dockerService = require('../../services/docker');
const gitService = require('../../services/git');
const zipService = require('../../services/zip');
const autoDeployService = require('../../services/autodeploy');
const sharingService = require('../../services/sharing');
const proxyService = require('../../services/proxy');
const backupService = require('../../services/backup');
const workspaceService = require('../../services/workspace');
const composeValidator = require('../../services/compose-validator');
const upload = require('../../middleware/upload');
const { validateZipMiddleware } = require('../../middleware/upload');
const { logger } = require('../../config/logger');

// Import sub-routers
const gitRouter = require('./git');
const autoDeployRouter = require('./autodeploy');
const webhookRouter = require('./webhook');
const sharingRouter = require('./sharing');

// Filter out requests for static files that shouldn't reach project routes
// These are typically browser DevTools or extensions looking for source maps
router.use('/:name', (req, res, next) => {
    const name = req.params.name;
    // Reject requests that look like static file requests (e.g., *.css.map, *.js.map)
    if (name && /\.(css|js|map|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/i.test(name)) {
        return res.status(404).send('Not found');
    }
    next();
});

// Show all projects
router.get('/', requireAuth, async (req, res) => {
    try {
        const systemUsername = req.session.user.system_username;
        const userId = req.session.user.id;

        // Load own projects
        const projects = await projectService.getUserProjects(systemUsername);

        // Add Git status for each project
        for (const project of projects) {
            project.gitConnected = gitService.isGitRepository(project.path);
        }

        // Load shared projects (parallel loading to avoid N+1)
        const sharedProjectInfos = await sharingService.getSharedProjects(userId);
        const sharedProjectPromises = sharedProjectInfos.map(async (share) => {
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
                return project;
            }
            return null;
        });
        const sharedProjects = (await Promise.all(sharedProjectPromises)).filter(p => p !== null);

        res.render('projects/index', {
            title: 'Projects',
            projects,
            sharedProjects
        });
    } catch (error) {
        logger.error('Error loading projects', { error: error.message });
        req.flash('error', req.t('projects:errors.loadError'));
        res.redirect('/dashboard');
    }
});

// Create new project - Form
router.get('/create', requireAuth, async (req, res) => {
    try {
        const templates = await projectService.getAvailableTemplates();
        const nextPort = await projectService.getNextAvailablePort();

        res.render('projects/create', {
            title: 'New Project',
            templates,
            nextPort
        });
    } catch (error) {
        logger.error('Error loading form', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/projects');
    }
});

// Create new project - Processing
router.post('/', requireAuth, validate('createProject'), async (req, res) => {
    try {
        const { name, template, port } = req.validatedBody || req.body;
        const systemUsername = req.session.user.system_username;

        const project = await projectService.createProject(
            systemUsername,
            name,
            template,
            { port: parseInt(port) }
        );

        req.flash('success', req.t('projects:flash.created', { name }));
        res.redirect(`/projects/${name}`);
    } catch (error) {
        logger.error('Error creating project', { error: error.message });
        req.flash('error', error.message || req.t('common:errors.createError'));
        res.redirect('/projects/create');
    }
});

// Create new project from ZIP - Processing
router.post('/from-zip', requireAuth, upload.single('zipfile'), validateZipMiddleware, validate('createProjectFromZip'), async (req, res) => {
    try {
        const { name, port } = req.validatedBody || req.body;
        const systemUsername = req.session.user.system_username;

        // Check if file was uploaded
        if (!req.file) {
            req.flash('error', req.t('common:errors.selectFile'));
            return res.redirect('/projects/create');
        }

        const result = await zipService.createProjectFromZip(
            systemUsername,
            name,
            req.file.path,
            parseInt(port)
        );

        const typeKey = `projects:types.${result.projectType}`;
        const typeName = req.t(typeKey) !== typeKey ? req.t(typeKey) : result.projectType;

        req.flash('success', req.t('projects:flash.created', { name }) + ' ' + req.t('common:labels.detectedAs', { type: typeName }));
        res.redirect(`/projects/${name}`);
    } catch (error) {
        logger.error('Error creating ZIP project', { error: error.message });
        req.flash('error', error.message || req.t('common:errors.createError'));
        res.redirect('/projects/create');
    }
});

// Create new project from Git - Processing
router.post('/from-git', requireAuth, validate('createProjectFromGit'), async (req, res) => {
    const startTime = Date.now();
    const { name, repo_url, access_token, port } = req.validatedBody || req.body;
    const systemUsername = req.session.user.system_username;
    const userId = req.session.user.id;

    try {

        if (!gitService.isValidGitUrl(repo_url)) {
            req.flash('error', req.t('common:errors.invalidGitUrl'));
            return res.redirect('/projects/create');
        }

        const result = await gitService.createProjectFromGit(
            systemUsername,
            name,
            repo_url,
            access_token || null,
            parseInt(port)
        );

        // Create deployment log for clone
        try {
            await autoDeployService.logDeployment(userId, name, 'clone', {
                status: 'success',
                newCommitHash: result.commitHash || null,
                commitMessage: `Repository cloned: ${repo_url.replace(/\/\/[^:]+:[^@]+@/, '//')}`,
                durationMs: Date.now() - startTime
            });
        } catch (logError) {
            logger.warn('Could not create deployment log', { error: logError.message });
        }

        const typeKey = `projects:types.${result.projectType}`;
        const typeName = req.t(typeKey) !== typeKey ? req.t(typeKey) : result.projectType;

        req.flash('success', req.t('projects:flash.created', { name }) + ' ' + req.t('common:labels.detectedAs', { type: typeName }));
        res.redirect(`/projects/${name}`);
    } catch (error) {
        // Log failed clone
        try {
            await autoDeployService.logDeployment(userId, name, 'clone', {
                status: 'failed',
                errorMessage: error.message,
                durationMs: Date.now() - startTime
            });
        } catch (logError) {
            // Ignore if logging fails
        }

        logger.error('Error creating Git project', { error: error.message });
        req.flash('error', error.message || req.t('common:errors.createError'));
        res.redirect('/projects/create');
    }
});

// Show single project
router.get('/:name', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        const access = req.projectAccess;
        const project = access.project;
        const systemUsername = access.systemUsername;

        // Fetch Git status
        const gitStatus = await gitService.getGitStatus(project.path);

        // Auto-detect project type and compare with current
        const detectedType = gitService.detectProjectType(project.path);

        // Mapping from detected types to template names
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

        // Load environment variables
        const envContent = await projectService.readEnvFile(systemUsername, req.params.name);

        // Check for .env.example
        const envExample = await projectService.checkEnvExample(systemUsername, req.params.name);

        // Load user's databases (only for owner or manage/full permission)
        let userDatabases = [];
        if (access.isOwner || access.permission === 'manage' || access.permission === 'full') {
            userDatabases = await projectService.getUserDbCredentials(req.session.user.system_username);
        }

        // Load auto-deploy and webhook config (only for owner with Git projects)
        let autoDeployConfig = null;
        let deploymentHistory = [];
        let webhookConfig = null;
        let webhookSecret = null;
        if (access.isOwner && gitStatus && gitStatus.connected) {
            // Auto-deploy (polling) and webhook are independent features
            autoDeployConfig = await autoDeployService.getAutoDeployConfig(req.session.user.id, req.params.name);
            webhookConfig = await autoDeployService.getWebhookConfig(req.session.user.id, req.params.name);

            // Load deployment history if either auto-deploy or webhook is configured
            if (autoDeployConfig || webhookConfig) {
                deploymentHistory = await autoDeployService.getDeploymentHistory(req.session.user.id, req.params.name, 5);
            }

            // Check for one-time secret display from session
            if (req.session.webhookSecret && req.session.webhookSecret.projectName === req.params.name) {
                webhookSecret = req.session.webhookSecret;
                delete req.session.webhookSecret; // Clear after displaying once
            }
        }

        // Load sharing information (only for owner)
        let projectShares = [];
        let availableUsers = [];
        if (access.isOwner) {
            projectShares = await sharingService.getProjectShares(req.session.user.id, req.params.name);
            availableUsers = await sharingService.getAllUsersExcept(req.session.user.id);
            // Remove users who already have access from the list
            const sharedUserIds = projectShares.map(s => s.shared_with_id);
            availableUsers = availableUsers.filter(u => !sharedUserIds.includes(u.id));
        }

        // Load NPM domains (only for owner or full permission)
        const npmEnabled = proxyService.isEnabled();
        let projectDomains = [];
        if (npmEnabled && (access.isOwner || access.permission === 'full')) {
            const ownerId = access.isOwner ? req.session.user.id : access.ownerId;
            projectDomains = await proxyService.getProjectDomains(ownerId, req.params.name);
        }

        // Load backup history (for manage permission or higher)
        let projectBackups = [];
        let databaseBackups = [];
        let linkedDatabase = null;
        if (access.isOwner || access.permission === 'manage' || access.permission === 'full') {
            projectBackups = await backupService.getProjectBackups(req.session.user.id, req.params.name, 3);

            // Detect linked database from project .env
            linkedDatabase = await projectService.getLinkedDatabase(
                req.session.user.system_username,
                req.params.name,
                userDatabases
            );

            // Load database backups only for linked database
            if (linkedDatabase) {
                databaseBackups = await backupService.getDatabaseBackups(req.session.user.id, [linkedDatabase.database], 3);
            }
        }

        // Load workspace for this project (if exists)
        const workspace = await workspaceService.getWorkspace(req.session.user.id, req.params.name);

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
            webhookConfig,
            webhookSecret,
            // Sharing data
            projectAccess: access,
            projectShares,
            availableUsers,
            permissionLabels: {
                read: 'View',
                manage: 'Manage',
                full: 'Full Access'
            },
            // NPM data
            npmEnabled,
            projectDomains,
            // Backup data
            projectBackups,
            databaseBackups,
            linkedDatabase,
            formatFileSize: backupService.formatFileSize,
            // Workspace data
            workspace
        });
    } catch (error) {
        logger.error('Error loading project', { error: error.message });
        req.flash('error', req.t('projects:errors.loadError'));
        res.redirect('/projects');
    }
});

// Get project status (API endpoint for polling)
router.get('/:name/status', requireAuth, getProjectAccess(), requirePermission('read'), async (req, res) => {
    try {
        const project = req.projectAccess.project;
        const systemUsername = req.projectAccess.systemUsername;
        const projectInfo = await projectService.getProjectInfo(systemUsername, req.params.name);

        res.json({
            status: projectInfo?.status || 'unknown',
            runningContainers: projectInfo?.runningContainers || 0,
            totalContainers: projectInfo?.totalContainers || 0,
            services: projectInfo?.services || []
        });
    } catch (error) {
        logger.error('Error getting project status', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Start project - async API (manage or higher)
router.post('/:name/start', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    const project = req.projectAccess.project;
    const isAsync = req.query.async === 'true';

    if (isAsync) {
        // Start in background and return immediately
        dockerService.startProject(project.path, { build: project.isCustom })
            .then(() => {
                logger.info('Project started successfully (async)', { name: req.params.name });
            })
            .catch(error => {
                logger.error('Error starting project (async)', { name: req.params.name, error: error.message });
            });

        return res.json({ status: 'starting', message: 'Project is starting...' });
    }

    // Synchronous start (legacy behavior)
    try {
        await dockerService.startProject(project.path, { build: project.isCustom });
        req.flash('success', req.t('projects:flash.started', { name: req.params.name }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error starting project', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('common:buttons.start'), error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Stop project - async API (manage or higher)
router.post('/:name/stop', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    const project = req.projectAccess.project;
    const isAsync = req.query.async === 'true';

    if (isAsync) {
        dockerService.stopProject(project.path)
            .then(() => {
                logger.info('Project stopped successfully (async)', { name: req.params.name });
            })
            .catch(error => {
                logger.error('Error stopping project (async)', { name: req.params.name, error: error.message });
            });

        return res.json({ status: 'stopping', message: 'Project is stopping...' });
    }

    try {
        await dockerService.stopProject(project.path);
        req.flash('success', req.t('projects:flash.stopped', { name: req.params.name }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error stopping project', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('common:buttons.stop'), error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Restart project - async API (manage or higher)
router.post('/:name/restart', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    const project = req.projectAccess.project;
    const isAsync = req.query.async === 'true';

    if (isAsync) {
        dockerService.restartProject(project.path)
            .then(() => {
                logger.info('Project restarted successfully (async)', { name: req.params.name });
            })
            .catch(error => {
                logger.error('Error restarting project (async)', { name: req.params.name, error: error.message });
            });

        return res.json({ status: 'restarting', message: 'Project is restarting...' });
    }

    try {
        await dockerService.restartProject(project.path);
        req.flash('success', req.t('projects:flash.restarted', { name: req.params.name }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error restarting project', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('common:buttons.restart'), error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Rebuild project with --build flag (manage or higher, useful for custom docker-compose)
router.post('/:name/rebuild', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    const project = req.projectAccess.project;
    const systemUsername = req.projectAccess.systemUsername;
    const isAsync = req.query.async === 'true';

    // For custom projects, re-import docker-compose.yml from html/ before rebuild
    // This allows users to update their docker-compose.yml and have changes applied
    if (project.templateType === 'custom') {
        const containerPrefix = `${systemUsername}-${project.name}`;
        const basePort = parseInt(project.port, 10) || 10000;

        const reimportResult = composeValidator.reimportUserCompose(
            project.path,
            containerPrefix,
            basePort
        );

        if (reimportResult.success) {
            logger.info('Re-imported docker-compose.yml before rebuild', {
                name: project.name,
                services: reimportResult.services
            });
        } else if (!reimportResult.notFound) {
            // Only warn if there was an actual error (not just missing file)
            logger.warn('Failed to re-import docker-compose.yml, proceeding with existing config', {
                name: project.name,
                error: reimportResult.error || reimportResult.errors
            });
        }
    }

    if (isAsync) {
        // Start rebuild in background and return immediately
        dockerService.rebuildProject(project.path)
            .then(() => {
                logger.info('Project rebuilt successfully (async)', { name: req.params.name });
            })
            .catch(error => {
                logger.error('Error rebuilding project (async)', { name: req.params.name, error: error.message });
            });

        return res.json({ status: 'rebuilding', message: 'Project is being rebuilt...' });
    }

    try {
        await dockerService.rebuildProject(project.path);
        req.flash('success', req.t('projects:flash.rebuilt', { name: req.params.name }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error rebuilding project', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: 'Rebuild', error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Restart specific service in multi-container project (manage or higher)
router.post('/:name/services/:service/restart', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const project = req.projectAccess.project;
        const serviceName = req.params.service;
        await dockerService.restartService(project.path, serviceName);
        req.flash('success', req.t('projects:flash.serviceRestarted', { service: serviceName }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error restarting service', { service: req.params.service, error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('common:buttons.restart'), error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Get logs for specific service in multi-container project (API)
router.get('/:name/services/:service/logs', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        const project = req.projectAccess.project;
        const serviceName = req.params.service;
        const lines = parseInt(req.query.lines) || 100;
        const logs = await dockerService.getServiceLogs(project.path, serviceName, lines);
        res.json({ success: true, logs });
    } catch (error) {
        logger.error('Error fetching service logs', { service: req.params.service, error: error.message });
        res.json({ success: false, error: error.message });
    }
});

// Change project type (full or owner)
router.post('/:name/change-type', requireAuth, getProjectAccess(), requirePermission('full'), async (req, res) => {
    try {
        const systemUsername = req.projectAccess.systemUsername;
        const { type } = req.body;

        const validTypes = ['static', 'php', 'nodejs', 'laravel', 'nodejs-static', 'nextjs'];

        if (!validTypes.includes(type)) {
            req.flash('error', req.t('projects:errors.invalidType'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        await projectService.changeProjectType(systemUsername, req.params.name, type);
        const typeName = req.t(`projects:types.${type}`);
        req.flash('success', req.t('projects:flash.typeChanged', { type: typeName }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error changing project type', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('common:labels.change'), error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Save environment variables (manage or higher)
router.post('/:name/env', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const systemUsername = req.projectAccess.systemUsername;
        const { envContent } = req.body;

        await projectService.writeEnvFile(systemUsername, req.params.name, envContent);
        req.flash('success', req.t('projects:flash.envSaved'));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error saving environment variables', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('common:buttons.save'), error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Copy .env.example to .env (manage or higher)
router.post('/:name/env/copy-example', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const systemUsername = req.projectAccess.systemUsername;

        await projectService.copyEnvExample(systemUsername, req.params.name);
        req.flash('success', req.t('projects:flash.envCopied'));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error copying .env.example', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Intelligently insert database credentials into .env (manage or higher)
// Uses .env.example as template if available and replaces known DB variables
router.post('/:name/env/add-db', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const systemUsername = req.projectAccess.systemUsername;
        const { database } = req.body;

        // Load all DB credentials of the current user
        const credentials = await projectService.getUserDbCredentials(req.session.user.system_username);
        const dbCredentials = credentials.find(c => c.database === database);

        if (!dbCredentials) {
            req.flash('error', req.t('databases:errors.notFound'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        await projectService.mergeDbCredentials(systemUsername, req.params.name, dbCredentials);
        req.flash('success', req.t('projects:flash.dbConfigured'));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error setting up DB credentials', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Clone project (owner only)
router.post('/:name/clone', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        // Only owner can clone
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const systemUsername = req.projectAccess.systemUsername;
        const { newName } = req.body;

        if (!newName || !/^[a-z0-9-]+$/.test(newName)) {
            req.flash('error', req.t('projects:errors.invalidName'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const clonedProject = await projectService.cloneProject(
            systemUsername,
            req.params.name,
            newName
        );

        req.flash('success', req.t('projects:flash.cloned', { source: req.params.name, name: newName }));
        res.redirect(`/projects/${clonedProject.name}`);
    } catch (error) {
        logger.error('Error cloning project', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('projects:clone.action'), error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Delete project (owner only)
router.delete('/:name', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        // Only owner can delete
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const systemUsername = req.projectAccess.systemUsername;

        // Delete all shares for this project
        await sharingService.deleteAllSharesForProject(req.session.user.id, req.params.name);

        // Delete auto-deploy data
        await autoDeployService.deleteAutoDeploy(req.session.user.id, req.params.name);

        await projectService.deleteProject(systemUsername, req.params.name);
        req.flash('success', req.t('projects:flash.deleted', { name: req.params.name }));
        res.redirect('/projects');
    } catch (error) {
        logger.error('Error deleting project', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('common:buttons.delete'), error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Mount sub-routers
router.use('/:name/git', gitRouter);
router.use('/:name/autodeploy', autoDeployRouter);
router.use('/:name/webhook', webhookRouter);
router.use('/:name/shares', sharingRouter);

module.exports = router;
