/**
 * Project Sharing Routes
 * Handles project sharing with other users
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../../middleware/auth');
const { getProjectAccess } = require('../../middleware/projectAccess');
const sharingService = require('../../services/sharing');
const { logger } = require('../../config/logger');

// Share project - Create new share (owner only)
router.post('/', requireAuth, getProjectAccess(), async (req, res) => {
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
router.post('/:userId/update', requireAuth, getProjectAccess(), async (req, res) => {
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
router.post('/:userId/delete', requireAuth, getProjectAccess(), async (req, res) => {
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
