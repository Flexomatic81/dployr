/**
 * Admin Update Routes
 * Handles system updates and version management
 */

const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const updateService = require('../../services/update');
const { logger } = require('../../config/logger');

// Path to deploy script
const DPLOYR_PATH = process.env.HOST_DPLOYR_PATH || '/opt/dployr';
const DEPLOY_SCRIPT = path.join(DPLOYR_PATH, 'deploy.sh');

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

/**
 * GET /admin/updates/install-stream
 * SSE: Stream update progress in real-time
 */
router.get('/install-stream', async (req, res) => {
    logger.info('Update stream requested by admin', { userId: req.session.userId });

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Helper to send SSE message
    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        // Get the update channel/branch
        const channel = await updateService.getUpdateChannel();
        const branch = updateService.UPDATE_CHANNELS[channel];

        // Send initial status
        sendEvent({ step: 'pull', status: 'starting', branch });

        // Spawn the deploy script with JSON output
        const deployProcess = spawn('bash', [DEPLOY_SCRIPT, '--branch', branch, '--json'], {
            cwd: DPLOYR_PATH,
            env: { ...process.env, PATH: process.env.PATH }
        });

        // Buffer for partial lines
        let buffer = '';

        deployProcess.stdout.on('data', (data) => {
            buffer += data.toString();

            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const parsed = JSON.parse(line);
                    // Forward the step information to the client
                    sendEvent(parsed);
                    logger.debug('Update progress', parsed);
                } catch {
                    // Non-JSON output, log it
                    logger.debug('Update output', { output: line });
                }
            }
        });

        deployProcess.stderr.on('data', (data) => {
            logger.warn('Update stderr', { output: data.toString() });
        });

        deployProcess.on('close', (code) => {
            logger.info('Deploy script finished', { exitCode: code });

            if (code === 0) {
                sendEvent({ status: 'complete', success: true });
            } else {
                sendEvent({ status: 'error', error: `Deploy script exited with code ${code}` });
            }

            // Keep connection open briefly to ensure message is sent
            setTimeout(() => {
                res.end();
            }, 500);
        });

        deployProcess.on('error', (error) => {
            logger.error('Deploy script error', { error: error.message });
            sendEvent({ status: 'error', error: error.message });
            res.end();
        });

        // Handle client disconnect
        req.on('close', () => {
            logger.info('Update stream client disconnected');
            // Don't kill the deploy process - let it complete
        });

    } catch (error) {
        logger.error('Error starting update stream', { error: error.message });
        sendEvent({ status: 'error', error: error.message });
        res.end();
    }
});

module.exports = router;
