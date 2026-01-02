/**
 * Proxy Routes
 *
 * Domain management for Nginx Proxy Manager integration
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getProjectAccess, requirePermission } = require('../middleware/projectAccess');
const { validate } = require('../middleware/validation');
const proxyService = require('../services/proxy');
const projectService = require('../services/project');
const dockerService = require('../services/docker');
const { logger } = require('../config/logger');

/**
 * GET /proxy/status
 * Check if NPM integration is enabled
 */
router.get('/status', requireAuth, async (req, res) => {
    try {
        const enabled = proxyService.isEnabled();
        let connected = false;

        if (enabled) {
            connected = await proxyService.testConnection();
        }

        res.json({
            enabled,
            connected,
            configured: !!(process.env.NPM_API_EMAIL && process.env.NPM_API_PASSWORD)
        });
    } catch (error) {
        res.json({
            enabled: false,
            connected: false,
            configured: false,
            error: error.message
        });
    }
});

/**
 * GET /proxy/:name/domains
 * List domains for a project
 */
router.get('/:name/domains', requireAuth, getProjectAccess(), async (req, res) => {
    try {
        if (!proxyService.isEnabled()) {
            return res.json({ domains: [], enabled: false });
        }

        const userId = req.projectAccess.isOwner ? req.session.user.id : req.projectAccess.ownerId;
        const domains = await proxyService.getProjectDomains(userId, req.params.name);

        res.json({ domains, enabled: true });
    } catch (error) {
        logger.error('Error fetching domains', { error: error.message, project: req.params.name });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /proxy/:name/domains
 * Add domain to project (requires full permission or owner)
 */
router.post('/:name/domains', requireAuth, getProjectAccess(), requirePermission('full'), validate('addDomain'), async (req, res) => {
    try {
        if (!proxyService.isEnabled()) {
            req.flash('error', req.t('proxy:errors.notEnabled'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const { domain, ssl: enableSsl } = req.validatedBody;
        const projectName = req.params.name;
        const userId = req.projectAccess.isOwner ? req.session.user.id : req.projectAccess.ownerId;
        const systemUsername = req.projectAccess.isOwner
            ? req.session.user.system_username
            : req.projectAccess.ownerSystemUsername;

        const cleanDomain = domain.toLowerCase();

        // Get project info for container name and port
        const project = await projectService.getProjectInfo(systemUsername, projectName);
        if (!project) {
            req.flash('error', req.t('projects:errors.notFound'));
            return res.redirect('/projects');
        }

        // Get container info
        const containers = await dockerService.getUserContainers(systemUsername);
        const projectContainer = containers.find(c =>
            c.Names[0].replace('/', '').includes(projectName)
        );

        if (!projectContainer) {
            req.flash('error', req.t('proxy:errors.containerNotFound'));
            return res.redirect(`/projects/${projectName}`);
        }

        const containerName = projectContainer.Names[0].replace('/', '');
        const targetPort = project.port || 80;

        // Create proxy host in NPM
        const proxyHost = await proxyService.createProxyHost(
            containerName,
            cleanDomain,
            targetPort
        );

        // Handle SSL if requested
        let certificateId = null;
        if (enableSsl === 'true' || enableSsl === true) {
            try {
                const cert = await proxyService.requestCertificate(cleanDomain);
                certificateId = cert.id;
                await proxyService.enableSSL(proxyHost.id, certificateId);
                logger.info('SSL certificate created and enabled', { domain: cleanDomain });
            } catch (sslError) {
                logger.warn('SSL certificate request failed', {
                    domain: cleanDomain,
                    error: sslError.message
                });
                req.flash('warning', req.t('proxy:flash.domainAddedNoSsl'));
            }
        }

        // Save to database
        await proxyService.saveDomainMapping(
            userId,
            projectName,
            cleanDomain,
            proxyHost.id,
            certificateId
        );

        if (!req.flash('warning')?.length) {
            req.flash('success', req.t('proxy:flash.domainAdded', { domain: cleanDomain }));
        }

        res.redirect(`/projects/${projectName}`);
    } catch (error) {
        logger.error('Error adding domain', {
            error: error.message,
            project: req.params.name
        });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

/**
 * DELETE /proxy/:name/domains/:domain
 * Remove domain from project (requires full permission or owner)
 */
router.delete('/:name/domains/:domain', requireAuth, getProjectAccess(), requirePermission('full'), async (req, res) => {
    try {
        if (!proxyService.isEnabled()) {
            req.flash('error', req.t('proxy:errors.notEnabled'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const userId = req.projectAccess.isOwner ? req.session.user.id : req.projectAccess.ownerId;

        await proxyService.deleteDomainMapping(
            userId,
            req.params.name,
            req.params.domain
        );

        req.flash('success', req.t('proxy:flash.domainRemoved'));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error removing domain', {
            error: error.message,
            project: req.params.name,
            domain: req.params.domain
        });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

/**
 * POST /proxy/:name/domains/:domain/ssl
 * Request SSL certificate for existing domain (requires full permission or owner)
 */
router.post('/:name/domains/:domain/ssl', requireAuth, getProjectAccess(), requirePermission('full'), async (req, res) => {
    try {
        if (!proxyService.isEnabled()) {
            req.flash('error', req.t('proxy:errors.notEnabled'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        const userId = req.projectAccess.isOwner ? req.session.user.id : req.projectAccess.ownerId;
        const domainRecord = await proxyService.getDomainRecord(userId, req.params.name, req.params.domain);

        if (!domainRecord) {
            req.flash('error', req.t('proxy:errors.domainNotFound'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        if (domainRecord.ssl_enabled) {
            req.flash('info', req.t('proxy:flash.sslAlreadyEnabled'));
            return res.redirect(`/projects/${req.params.name}`);
        }

        // Request certificate
        const cert = await proxyService.requestCertificate(req.params.domain);

        // Enable SSL on proxy host
        await proxyService.enableSSL(domainRecord.proxy_host_id, cert.id);

        // Update database
        await proxyService.updateDomainSSL(userId, req.params.name, req.params.domain, cert.id);

        req.flash('success', req.t('proxy:flash.sslEnabled', { domain: req.params.domain }));
        res.redirect(`/projects/${req.params.name}`);
    } catch (error) {
        logger.error('Error enabling SSL', {
            error: error.message,
            project: req.params.name,
            domain: req.params.domain
        });
        req.flash('error', error.message);
        res.redirect(`/projects/${req.params.name}`);
    }
});

module.exports = router;
