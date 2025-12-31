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
const proxyService = require('../services/proxy');
const upload = require('../middleware/upload');
const { validateZipMiddleware } = require('../middleware/upload');
const { logger } = require('../config/logger');

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

        // Load shared projects
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

        req.flash('success', req.t('projects:flash.created', { name }));
        res.redirect(`/projects/${name}`);
    } catch (error) {
        logger.error('Error creating project', { error: error.message });
        req.flash('error', error.message || req.t('common:errors.createError'));
        res.redirect('/projects/create');
    }
});

// Create new project from ZIP - Processing
router.post('/from-zip', requireAuth, upload.single('zipfile'), validateZipMiddleware, async (req, res) => {
    try {
        const { name, port } = req.body;
        const systemUsername = req.session.user.system_username;

        // Check if file was uploaded
        if (!req.file) {
            req.flash('error', req.t('common:errors.selectFile'));
            return res.redirect('/projects/create');
        }

        // Validation
        if (!/^[a-z0-9-]+$/.test(name)) {
            req.flash('error', req.t('projects:errors.invalidName'));
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
router.post('/from-git', requireAuth, async (req, res) => {
    const startTime = Date.now();
    const { name, repo_url, access_token, port } = req.body;
    const systemUsername = req.session.user.system_username;
    const userId = req.session.user.id;

    try {
        // Validation
        if (!/^[a-z0-9-]+$/.test(name)) {
            req.flash('error', req.t('projects:errors.invalidName'));
            return res.redirect('/projects/create');
        }

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
            projectDomains
        });
    } catch (error) {
        logger.error('Error loading project', { error: error.message });
        req.flash('error', req.t('projects:errors.loadError'));
        res.redirect('/projects');
    }
});

// Start project (manage or higher)
router.post('/:name/start', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const project = req.projectAccess.project;
        await dockerService.startProject(project.path);
        req.flash('success', req.t('projects:flash.started', { name: req.params.name }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error starting project', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('common:buttons.start'), error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Stop project (manage or higher)
router.post('/:name/stop', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const project = req.projectAccess.project;
        await dockerService.stopProject(project.path);
        req.flash('success', req.t('projects:flash.stopped', { name: req.params.name }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error stopping project', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('common:buttons.stop'), error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Restart project (manage or higher)
router.post('/:name/restart', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const project = req.projectAccess.project;
        await dockerService.restartProject(project.path);
        req.flash('success', req.t('projects:flash.restarted', { name: req.params.name }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error restarting project', { error: error.message });
        req.flash('error', req.t('common:errors.actionFailed', { action: req.t('common:buttons.restart'), error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
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

// Perform Git pull (manage or higher)
router.post('/:name/git/pull', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    const startTime = Date.now();
    const projectName = req.params.name;
    const userId = req.session.user.id;

    try {
        const systemUsername = req.projectAccess.systemUsername;
        const projectPath = gitService.getProjectPath(systemUsername, projectName);

        if (!gitService.isGitRepository(projectPath)) {
            req.flash('error', req.t('projects:errors.noGitRepo'));
            return res.redirect(`/projects/${projectName}`);
        }

        // Save old commit hash
        const { execSync } = require('child_process');
        const gitPath = gitService.getGitPath(projectPath);
        let oldCommitHash = null;
        try {
            oldCommitHash = execSync('git rev-parse HEAD', {
                cwd: gitPath,
                encoding: 'utf-8',
                timeout: 5000
            }).trim().substring(0, 40);
        } catch (e) {}

        const result = await gitService.pullChanges(projectPath);

        // Get new commit hash and message
        let newCommitHash = null;
        let commitMessage = null;
        try {
            newCommitHash = execSync('git rev-parse HEAD', {
                cwd: gitPath,
                encoding: 'utf-8',
                timeout: 5000
            }).trim().substring(0, 40);

            commitMessage = execSync('git log -1 --format="%s"', {
                cwd: gitPath,
                encoding: 'utf-8',
                timeout: 5000
            }).trim();
        } catch (e) {}

        // Create deployment log
        try {
            await autoDeployService.logDeployment(userId, projectName, 'pull', {
                status: 'success',
                oldCommitHash,
                newCommitHash,
                commitMessage: result.hasChanges ? commitMessage : 'No changes',
                durationMs: Date.now() - startTime
            });
        } catch (logError) {
            logger.warn('Could not create deployment log', { error: logError.message });
        }

        if (result.hasChanges) {
            req.flash('success', req.t('projects:flash.gitPulled', { commits: result.commitCount || 1 }));
        } else {
            req.flash('info', req.t('projects:flash.gitPulledNoChanges'));
        }

        res.redirect(`/projects/${projectName}`);
    } catch (error) {
        // Log failed pull
        try {
            await autoDeployService.logDeployment(userId, projectName, 'pull', {
                status: 'failed',
                errorMessage: error.message,
                durationMs: Date.now() - startTime
            });
        } catch (logError) {
            // Ignore if logging fails
        }

        logger.error('Git pull error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${projectName}`);
    }
});

// Disconnect Git repository (owner only)
router.post('/:name/git/disconnect', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        // Only owner can disconnect Git
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const systemUsername = req.projectAccess.systemUsername;
        const projectPath = gitService.getProjectPath(systemUsername, req.params.name);

        if (!gitService.isGitRepository(projectPath)) {
            req.flash('error', req.t('projects:errors.noGitRepo'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        // Disable auto-deploy when Git is disconnected
        await autoDeployService.deleteAutoDeploy(req.session.user.id, req.params.name);

        gitService.disconnectRepository(projectPath);
        req.flash('success', req.t('projects:flash.gitDisconnected'));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Git disconnect error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Enable auto-deploy (owner only)
router.post('/:name/autodeploy/enable', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        // Only owner can configure auto-deploy
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const systemUsername = req.projectAccess.systemUsername;
        const projectPath = gitService.getProjectPath(systemUsername, req.params.name);

        if (!gitService.isGitRepository(projectPath)) {
            req.flash('error', req.t('projects:errors.noGitRepo'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        // Get branch from Git status
        const gitStatus = await gitService.getGitStatus(projectPath);
        const branch = gitStatus?.branch || 'main';

        await autoDeployService.enableAutoDeploy(req.session.user.id, req.params.name, branch);
        req.flash('success', req.t('projects:flash.autoDeployEnabled', { interval: 5 }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Auto-Deploy enable error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Disable auto-deploy (owner only)
router.post('/:name/autodeploy/disable', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        await autoDeployService.disableAutoDeploy(req.session.user.id, req.params.name);
        req.flash('success', req.t('projects:flash.autoDeployDisabled'));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Auto-Deploy disable error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Change auto-deploy interval (owner only)
router.post('/:name/autodeploy/interval', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const interval = parseInt(req.body.interval);
        await autoDeployService.updateInterval(req.session.user.id, req.params.name, interval);
        req.flash('success', req.t('projects:flash.autoDeployEnabled', { interval }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Auto-Deploy interval error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Manually trigger auto-deploy (manage or higher - also for shared users)
router.post('/:name/autodeploy/trigger', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const systemUsername = req.projectAccess.systemUsername;
        const projectPath = gitService.getProjectPath(systemUsername, req.params.name);

        if (!gitService.isGitRepository(projectPath)) {
            req.flash('error', req.t('projects:errors.noGitRepo'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        // For shared projects: use owner ID
        const ownerId = req.projectAccess.isOwner ? req.session.user.id : req.projectAccess.ownerId;

        const result = await autoDeployService.executeDeploy(
            ownerId,
            systemUsername,
            req.params.name,
            'manual'
        );

        if (result.skipped) {
            req.flash('info', req.t('common:status.deploymentRunning'));
        } else if (result.success) {
            if (result.hasChanges) {
                req.flash('success', req.t('projects:flash.deploySuccess'));
            } else {
                req.flash('info', req.t('projects:show.noChanges'));
            }
        } else {
            req.flash('error', req.t('projects:flash.deployFailed', { error: result.error }));
        }

        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Auto-Deploy trigger error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Fetch deployment history (JSON API) - read or higher
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
// WEBHOOK ENDPOINTS
// ============================

// Enable webhook (owner only)
router.post('/:name/webhook/enable', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const systemUsername = req.projectAccess.systemUsername;
        const projectPath = gitService.getProjectPath(systemUsername, req.params.name);

        if (!gitService.isGitRepository(projectPath)) {
            req.flash('error', req.t('projects:errors.noGitRepo'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        // Get branch from git status for webhook config
        const gitStatus = await gitService.getGitStatus(projectPath);
        const branch = gitStatus?.branch || 'main';

        // Enable webhook (independent of polling auto-deploy)
        const result = await autoDeployService.enableWebhook(req.session.user.id, req.params.name, branch);

        // Store secret in session temporarily for one-time display
        req.session.webhookSecret = {
            projectName: req.params.name,
            secret: result.secret,
            webhookId: result.webhookId
        };

        req.flash('success', req.t('projects:flash.webhookEnabled'));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Webhook enable error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Disable webhook (owner only)
router.post('/:name/webhook/disable', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        await autoDeployService.disableWebhook(req.session.user.id, req.params.name);
        req.flash('success', req.t('projects:flash.webhookDisabled'));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Webhook disable error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Regenerate webhook secret (owner only)
router.post('/:name/webhook/regenerate', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const secret = await autoDeployService.regenerateWebhookSecret(req.session.user.id, req.params.name);
        const webhookConfig = await autoDeployService.getWebhookConfig(req.session.user.id, req.params.name);

        // Store new secret in session for one-time display
        req.session.webhookSecret = {
            projectName: req.params.name,
            secret: secret,
            webhookId: webhookConfig?.id
        };

        req.flash('success', req.t('projects:flash.webhookRegenerated'));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Webhook regenerate error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// ============================
// PROJECT SHARING ENDPOINTS
// ============================

// Share project - Create new share (owner only)
router.post('/:name/shares', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const { userId, permission } = req.body;
        const sharedWithId = parseInt(userId);

        if (!sharedWithId || !['read', 'manage', 'full'].includes(permission)) {
            req.flash('error', req.t('common:errors.invalidInput'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        await sharingService.shareProject(
            req.session.user.id,
            req.session.user.system_username,
            req.params.name,
            sharedWithId,
            permission
        );

        req.flash('success', req.t('projects:flash.shareAdded', { username: '' }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Share error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Change share permission (owner only)
router.post('/:name/shares/:userId/update', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const { permission } = req.body;
        const sharedWithId = parseInt(req.params.userId);

        if (!['read', 'manage', 'full'].includes(permission)) {
            req.flash('error', req.t('common:errors.invalidInput'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        await sharingService.updateSharePermission(
            req.session.user.id,
            req.params.name,
            sharedWithId,
            permission
        );

        req.flash('success', req.t('projects:flash.shareUpdated', { username: '' }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Update share error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

// Remove share (owner only)
router.post('/:name/shares/:userId/delete', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!req.projectAccess.isOwner) {
            req.flash('error', req.t('projects:errors.ownerOnly'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const sharedWithId = parseInt(req.params.userId);

        await sharingService.unshareProject(
            req.session.user.id,
            req.params.name,
            sharedWithId
        );

        req.flash('success', req.t('projects:flash.shareRemoved', { username: '' }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Delete share error', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

module.exports = router;
