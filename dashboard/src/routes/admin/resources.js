/**
 * Admin Resource Management Routes
 *
 * Base path: /admin/resources
 */

const express = require('express');
const router = express.Router();
const { logger } = require('../../config/logger');
const workspaceService = require('../../services/workspace');
const previewService = require('../../services/preview');

// ============================================================
// RESOURCE OVERVIEW
// ============================================================

/**
 * GET /admin/resources - Resource overview
 */
router.get('/', async (req, res) => {
    try {
        // Get all workspaces and previews via services
        const workspaces = await workspaceService.getAdminWorkspaces();
        const previews = await previewService.getAdminPreviews();

        // Calculate stats
        const stats = {
            totalWorkspaces: workspaces.length,
            runningWorkspaces: workspaces.filter(w => w.status === 'running').length,
            totalPreviews: previews.length,
            expiringPreviews: previews.filter(p => {
                const expiresIn = (new Date(p.expires_at) - new Date()) / (1000 * 60 * 60);
                return expiresIn < 2 && expiresIn > 0;
            }).length,
            activeUsers: new Set([...workspaces.map(w => w.user_id)]).size,
            allocatedPorts: [...workspaces, ...previews].filter(x => x.assigned_port).length
        };

        // Get global limits
        const globalLimits = await workspaceService.getGlobalLimits();

        // Port range
        const portRange = {
            start: process.env.WORKSPACE_PORT_RANGE_START || 10000,
            end: process.env.WORKSPACE_PORT_RANGE_END || 10100
        };

        res.render('admin/resources', {
            title: req.t('admin:resources.title'),
            workspaces,
            previews,
            stats,
            globalLimits,
            portRange,
            user: req.session.user
        });

    } catch (error) {
        logger.error('Failed to load resource overview', { error: error.message });
        req.flash('error', req.t('admin:resources.loadError'));
        res.redirect('/admin');
    }
});

// ============================================================
// GLOBAL LIMITS
// ============================================================

/**
 * POST /admin/resources/limits - Update global limits
 */
router.post('/limits', async (req, res) => {
    try {
        await workspaceService.setGlobalLimits(req.body);

        req.flash('success', req.t('admin:resources.limitsUpdated'));
        res.redirect('/admin/resources');

    } catch (error) {
        logger.error('Failed to update global limits', { error: error.message });
        req.flash('error', req.t('admin:resources.updateLimitsFailed'));
        res.redirect('/admin/resources');
    }
});

// ============================================================
// USER-SPECIFIC LIMITS
// ============================================================

/**
 * GET /admin/resources/users/:userId - Get user-specific limits
 */
router.get('/users/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const limits = await workspaceService.getUserLimits(userId);

        res.json({
            success: true,
            limits: limits
        });

    } catch (error) {
        logger.error('Failed to get user limits', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /admin/resources/users/:userId - Set user-specific limits
 */
router.post('/users/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        await workspaceService.setUserLimits(userId, req.body);

        res.json({
            success: true,
            message: req.t('admin:resources.userLimitsUpdated')
        });

    } catch (error) {
        logger.error('Failed to set user limits', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// WORKSPACE ACTIONS
// ============================================================

/**
 * POST /admin/resources/workspaces/:id/stop - Force stop workspace
 */
router.post('/workspaces/:id/stop', async (req, res) => {
    try {
        const workspaceId = parseInt(req.params.id);
        const adminUserId = req.session.user.id;

        // Get workspace info
        const workspace = await workspaceService.getWorkspaceById(workspaceId);

        if (!workspace) {
            req.flash('error', req.t('workspaces:errors.notFound'));
            return res.redirect('/admin/resources');
        }

        // Stop workspace
        await workspaceService.stopWorkspace(workspace.user_id, workspace.project_name);

        // Log admin action
        await workspaceService.logWorkspaceAction(
            workspaceId,
            adminUserId,
            workspace.project_name,
            'admin_force_stop',
            { admin_username: req.session.user.username }
        );

        req.flash('success', req.t('admin:resources.workspaceStopped'));
        res.redirect('/admin/resources');

    } catch (error) {
        logger.error('Failed to force stop workspace', { error: error.message });
        req.flash('error', req.t('admin:resources.stopWorkspaceFailed'));
        res.redirect('/admin/resources');
    }
});

// ============================================================
// PREVIEW ACTIONS
// ============================================================

/**
 * POST /admin/resources/previews/:id/delete - Delete preview
 */
router.post('/previews/:id/delete', async (req, res) => {
    try {
        const previewId = parseInt(req.params.id);

        // Get preview info
        const preview = await previewService.getPreviewById(previewId);

        if (!preview) {
            req.flash('error', req.t('workspaces:preview.notFound'));
            return res.redirect('/admin/resources');
        }

        // Delete preview
        await previewService.deletePreview(previewId, preview.user_id);

        req.flash('success', req.t('admin:resources.previewDeleted'));
        res.redirect('/admin/resources');

    } catch (error) {
        logger.error('Failed to delete preview', { error: error.message });
        req.flash('error', req.t('admin:resources.deletePreviewFailed'));
        res.redirect('/admin/resources');
    }
});

module.exports = router;
