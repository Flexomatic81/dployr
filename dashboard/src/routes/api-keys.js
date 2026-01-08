/**
 * API Key Management Routes
 *
 * Base path: /settings/api-keys
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const workspaceService = require('../services/workspace');
const { logger } = require('../config/logger');

// Rate limiter for API key test endpoint
const apiKeyTestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 test attempts per hour
    message: { success: false, error: 'Too many API key test attempts. Please try again in 1 hour.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ============================================================
// API KEY STATUS
// ============================================================

/**
 * GET /settings/api-keys - Show API key management page
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Check which keys are configured
        const hasAnthropicKey = await workspaceService.hasApiKey(userId, 'anthropic');
        const hasOpenAIKey = await workspaceService.hasApiKey(userId, 'openai');

        res.render('settings/api-keys', {
            title: req.t('workspaces:settings.apiKey'),
            hasAnthropicKey,
            hasOpenAIKey,
            user: req.session.user
        });
    } catch (error) {
        logger.error('Failed to load API key page', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/settings');
    }
});

// ============================================================
// ANTHROPIC API KEY
// ============================================================

/**
 * POST /settings/api-keys/anthropic - Set Anthropic API key
 */
router.post('/anthropic', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { api_key } = req.body;

        if (!api_key || api_key.trim().length === 0) {
            req.flash('error', req.t('workspaces:errors.apiKeyRequired'));
            return res.redirect('/settings/api-keys');
        }

        // Basic validation (Anthropic keys start with "sk-ant-")
        if (!api_key.startsWith('sk-ant-')) {
            req.flash('error', req.t('workspaces:errors.invalidApiKey'));
            return res.redirect('/settings/api-keys');
        }

        await workspaceService.setApiKey(userId, 'anthropic', api_key);

        req.flash('success', req.t('workspaces:messages.apiKeySaved'));
        res.redirect('/settings/api-keys');
    } catch (error) {
        logger.error('Failed to set Anthropic API key', { error: error.message });
        req.flash('error', req.t('workspaces:errors.apiKeySaveFailed'));
        res.redirect('/settings/api-keys');
    }
});

/**
 * DELETE /settings/api-keys/anthropic - Delete Anthropic API key
 */
router.delete('/anthropic', async (req, res) => {
    try {
        const userId = req.session.user.id;

        await workspaceService.deleteApiKey(userId, 'anthropic');

        res.json({
            success: true,
            message: req.t('workspaces:messages.apiKeyDeleted')
        });
    } catch (error) {
        logger.error('Failed to delete Anthropic API key', { error: error.message });
        res.status(500).json({
            success: false,
            error: req.t('workspaces:errors.apiKeyDeleteFailed')
        });
    }
});

/**
 * POST /settings/api-keys/anthropic/test - Test Anthropic API key
 */
router.post('/anthropic/test', apiKeyTestLimiter, async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Log test attempt for security audit
        logger.warn('API key test attempted', { userId, provider: 'anthropic' });

        const apiKey = await workspaceService.getDecryptedApiKey(userId, 'anthropic');
        if (!apiKey) {
            return res.json({
                success: false,
                error: req.t('workspaces:errors.noApiKey')
            });
        }

        // Test the API key by making a simple request
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic({ apiKey });

        try {
            // Simple test: List models (or any lightweight endpoint)
            await anthropic.messages.create({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 10,
                messages: [{ role: 'user', content: 'test' }]
            });

            logger.info('API key test successful', { userId, provider: 'anthropic' });

            res.json({
                success: true,
                message: req.t('workspaces:messages.apiKeyValid')
            });
        } catch (apiError) {
            logger.warn('API key test failed - invalid key', { userId, provider: 'anthropic' });

            res.json({
                success: false,
                error: req.t('workspaces:errors.apiKeyInvalid')
            });
        }
    } catch (error) {
        logger.error('Failed to test Anthropic API key', { error: error.message });
        res.status(500).json({
            success: false,
            error: req.t('workspaces:errors.apiKeyTestFailed')
        });
    }
});

// ============================================================
// OPENAI API KEY (Future)
// ============================================================

/**
 * POST /settings/api-keys/openai - Set OpenAI API key
 */
router.post('/openai', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { api_key } = req.body;

        if (!api_key || api_key.trim().length === 0) {
            req.flash('error', req.t('workspaces:errors.apiKeyRequired'));
            return res.redirect('/settings/api-keys');
        }

        await workspaceService.setApiKey(userId, 'openai', api_key);

        req.flash('success', req.t('workspaces:messages.apiKeySaved'));
        res.redirect('/settings/api-keys');
    } catch (error) {
        logger.error('Failed to set OpenAI API key', { error: error.message });
        req.flash('error', req.t('workspaces:errors.apiKeySaveFailed'));
        res.redirect('/settings/api-keys');
    }
});

/**
 * DELETE /settings/api-keys/openai - Delete OpenAI API key
 */
router.delete('/openai', async (req, res) => {
    try {
        const userId = req.session.user.id;

        await workspaceService.deleteApiKey(userId, 'openai');

        res.json({
            success: true,
            message: req.t('workspaces:messages.apiKeyDeleted')
        });
    } catch (error) {
        logger.error('Failed to delete OpenAI API key', { error: error.message });
        res.status(500).json({
            success: false,
            error: req.t('workspaces:errors.apiKeyDeleteFailed')
        });
    }
});

module.exports = router;
