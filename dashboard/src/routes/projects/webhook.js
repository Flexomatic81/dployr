/**
 * Webhook Routes
 * Handles webhook configuration for Git deployments
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../../middleware/auth');
const { getProjectAccess } = require('../../middleware/projectAccess');
const gitService = require('../../services/git');
const autoDeployService = require('../../services/autodeploy');
const { logger } = require('../../config/logger');

// Enable webhook (owner only)
router.post('/enable', requireAuth, getProjectAccess(), async (req, res) => {
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
router.post('/disable', requireAuth, getProjectAccess(), async (req, res) => {
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
router.post('/regenerate', requireAuth, getProjectAccess(), async (req, res) => {
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

module.exports = router;
