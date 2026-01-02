/**
 * Admin Update Routes
 * Handles system updates and version management
 */

const express = require('express');
const router = express.Router();
const updateService = require('../../services/update');
const { logger } = require('../../config/logger');

/**
 * GET /admin/updates
 * Show updates page
 */
router.get('/', async (req, res) => {
    try {
        const updateInfo = await updateService.checkForUpdates();

        res.render('admin/updates', {
            title: req.t('admin:updates.title'),
            updateInfo
        });
    } catch (error) {
        logger.error('Error loading updates page', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

/**
 * GET /admin/updates/check
 * API: Check for available updates
 */
router.get('/check', async (req, res) => {
    try {
        const force = req.query.force === 'true';
        const updateInfo = await updateService.checkForUpdates(force);

        res.json({
            success: true,
            ...updateInfo
        });
    } catch (error) {
        logger.error('Error checking for updates', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /admin/updates/version
 * API: Get current version info
 */
router.get('/version', async (req, res) => {
    try {
        const version = await updateService.getCurrentVersion();

        res.json({
            success: true,
            version
        });
    } catch (error) {
        logger.error('Error getting version', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /admin/updates/install
 * API: Perform the update
 */
router.post('/install', async (req, res) => {
    try {
        logger.info('Update requested by admin', { userId: req.session.userId });

        // Send initial response
        res.json({
            success: true,
            message: req.t('admin:updates.updateStarted'),
            note: req.t('admin:updates.restartNote')
        });

        // Perform update in background (will restart the container)
        // Small delay to ensure response is sent
        setTimeout(async () => {
            try {
                await updateService.performUpdate();
            } catch (error) {
                logger.error('Update failed', { error: error.message });
            }
        }, 1000);
    } catch (error) {
        logger.error('Error starting update', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /admin/updates/status
 * API: Get cached update status (for navbar badge)
 */
router.get('/status', (req, res) => {
    const status = updateService.getCachedUpdateStatus();
    res.json({
        success: true,
        ...status
    });
});

/**
 * GET /admin/updates/channel
 * API: Get current update channel
 */
router.get('/channel', async (req, res) => {
    try {
        const channel = await updateService.getUpdateChannel();
        res.json({
            success: true,
            channel,
            channels: Object.keys(updateService.UPDATE_CHANNELS)
        });
    } catch (error) {
        logger.error('Error getting update channel', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /admin/updates/channel
 * API: Set update channel
 */
router.post('/channel', async (req, res) => {
    try {
        const { channel } = req.body;

        if (!channel || !updateService.UPDATE_CHANNELS[channel]) {
            return res.status(400).json({
                success: false,
                error: 'Invalid channel. Must be "stable" or "beta".'
            });
        }

        await updateService.setUpdateChannel(channel);
        logger.info('Update channel changed', { userId: req.session.userId, channel });

        res.json({
            success: true,
            channel,
            message: req.t('admin:updates.channelChanged')
        });
    } catch (error) {
        logger.error('Error setting update channel', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
