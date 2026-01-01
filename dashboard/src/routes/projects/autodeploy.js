/**
 * Auto-Deploy Routes
 * Handles polling-based auto-deploy configuration
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../../middleware/auth');
const { getProjectAccess, requirePermission } = require('../../middleware/projectAccess');
const gitService = require('../../services/git');
const autoDeployService = require('../../services/autodeploy');
const { logger } = require('../../config/logger');

// Enable auto-deploy (owner only)
router.post('/enable', requireAuth, getProjectAccess(), async (req, res) => {
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
router.post('/disable', requireAuth, getProjectAccess(), async (req, res) => {
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
router.post('/interval', requireAuth, getProjectAccess(), async (req, res) => {
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
router.post('/trigger', requireAuth, getProjectAccess(), requirePermission('manage'), async (req, res) => {
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
router.get('/history', requireAuth, getProjectAccess(), async (req, res) => {
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

module.exports = router;
