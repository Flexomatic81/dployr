/**
 * Git Operations Routes
 * Handles Git pull, disconnect, auto-deploy, and webhooks
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../../middleware/auth');
const { getProjectAccess, requirePermission } = require('../../middleware/projectAccess');
const gitService = require('../../services/git');
const autoDeployService = require('../../services/autodeploy');
const composeValidator = require('../../services/compose-validator');
const projectPorts = require('../../services/projectPorts');
const { logger } = require('../../config/logger');

// Perform Git pull (manage or higher)
router.post('/pull', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
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

        // For custom projects with changes, re-import docker-compose.yml from html/
        const project = req.projectAccess.project;
        if (result.hasChanges && project.templateType === 'custom') {
            const containerPrefix = `${systemUsername}-${projectName}`;
            const basePort = parseInt(project.port, 10) || 10000;
            const usedPorts = await projectPorts.getAllUsedPorts();

            const reimportResult = composeValidator.reimportUserCompose(
                projectPath,
                containerPrefix,
                basePort,
                usedPorts
            );

            if (reimportResult.success) {
                logger.info('Re-imported docker-compose.yml after Git pull', {
                    name: projectName,
                    services: reimportResult.services
                });

                // Update port registrations
                try {
                    if (reimportResult.portMappings && reimportResult.portMappings.length > 0) {
                        await projectPorts.registerPorts(userId, projectName, reimportResult.portMappings);
                    }
                } catch (portErr) {
                    logger.warn('Failed to update port registrations', { error: portErr.message });
                }
            } else if (!reimportResult.notFound) {
                logger.warn('Failed to re-import docker-compose.yml after Git pull', {
                    name: projectName,
                    error: reimportResult.error || reimportResult.errors
                });
            }
        }

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
router.post('/disconnect', requireAuth, getProjectAccess(), async (req, res) => {
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

module.exports = router;
