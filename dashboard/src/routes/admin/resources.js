/**
 * Admin Resource Management Routes
 *
 * Base path: /admin/resources
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../../config/database');
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
        // Get all workspaces
        const [workspaces] = await pool.query(`
            SELECT w.*, u.username
            FROM workspaces w
            JOIN dashboard_users u ON w.user_id = u.id
            WHERE w.status IN ('running', 'starting', 'stopping')
            ORDER BY w.started_at DESC
        `);

        // Get all active previews
        const [previews] = await pool.query(`
            SELECT p.*, u.username
            FROM preview_environments p
            JOIN dashboard_users u ON p.user_id = u.id
            WHERE p.status IN ('creating', 'running')
            ORDER BY p.expires_at ASC
        `);

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
        const [limitsRows] = await pool.query(
            'SELECT * FROM resource_limits WHERE user_id IS NULL'
        );
        const globalLimits = limitsRows[0] || {
            max_workspaces: 2,
            default_cpu: '1',
            default_ram: '2g',
            default_idle_timeout: 30,
            max_previews_per_workspace: 3,
            default_preview_lifetime_hours: 24
        };

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
        const {
            max_workspaces,
            default_cpu,
            default_ram,
            default_idle_timeout,
            max_previews_per_workspace,
            default_preview_lifetime_hours
        } = req.body;

        // Update or insert global limits
        await pool.query(`
            INSERT INTO resource_limits
                (user_id, max_workspaces, default_cpu, default_ram,
                 default_idle_timeout, max_previews_per_workspace,
                 default_preview_lifetime_hours)
            VALUES (NULL, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                max_workspaces = VALUES(max_workspaces),
                default_cpu = VALUES(default_cpu),
                default_ram = VALUES(default_ram),
                default_idle_timeout = VALUES(default_idle_timeout),
                max_previews_per_workspace = VALUES(max_previews_per_workspace),
                default_preview_lifetime_hours = VALUES(default_preview_lifetime_hours)
        `, [
            max_workspaces,
            default_cpu,
            default_ram,
            default_idle_timeout,
            max_previews_per_workspace,
            default_preview_lifetime_hours
        ]);

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

        const [limits] = await pool.query(
            'SELECT * FROM resource_limits WHERE user_id = ?',
            [userId]
        );

        res.json({
            success: true,
            limits: limits[0] || null
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
        const {
            max_workspaces,
            default_cpu,
            default_ram,
            default_idle_timeout,
            max_previews_per_workspace,
            default_preview_lifetime_hours
        } = req.body;

        await pool.query(`
            INSERT INTO resource_limits
                (user_id, max_workspaces, default_cpu, default_ram,
                 default_idle_timeout, max_previews_per_workspace,
                 default_preview_lifetime_hours)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                max_workspaces = VALUES(max_workspaces),
                default_cpu = VALUES(default_cpu),
                default_ram = VALUES(default_ram),
                default_idle_timeout = VALUES(default_idle_timeout),
                max_previews_per_workspace = VALUES(max_previews_per_workspace),
                default_preview_lifetime_hours = VALUES(default_preview_lifetime_hours)
        `, [
            userId,
            max_workspaces,
            default_cpu,
            default_ram,
            default_idle_timeout,
            max_previews_per_workspace,
            default_preview_lifetime_hours
        ]);

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
        const [workspaces] = await pool.query(
            'SELECT * FROM workspaces WHERE id = ?',
            [workspaceId]
        );

        if (workspaces.length === 0) {
            req.flash('error', req.t('workspaces:errors.notFound'));
            return res.redirect('/admin/resources');
        }

        const workspace = workspaces[0];

        // Stop workspace
        await workspaceService.stopWorkspace(workspace.user_id, workspace.project_name);

        // Log admin action
        await pool.query(`
            INSERT INTO workspace_logs
                (workspace_id, user_id, project_name, action, details)
            VALUES (?, ?, ?, 'admin_force_stop', ?)
        `, [
            workspaceId,
            adminUserId,
            workspace.project_name,
            JSON.stringify({ admin_username: req.session.user.username })
        ]);

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
        const [previews] = await pool.query(
            'SELECT * FROM preview_environments WHERE id = ?',
            [previewId]
        );

        if (previews.length === 0) {
            req.flash('error', req.t('workspaces:preview.notFound'));
            return res.redirect('/admin/resources');
        }

        const preview = previews[0];

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
