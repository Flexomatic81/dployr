/**
 * Workspace Routes
 *
 * Base path: /workspaces
 */

const express = require('express');
const router = express.Router();
const workspaceService = require('../services/workspace');
const previewService = require('../services/preview');
const {
    getWorkspaceAccess,
    requireWorkspace,
    requireRunningWorkspace,
    requireWorkspacePermission
} = require('../middleware/workspaceAccess');
const { requirePermission } = require('../middleware/projectAccess');
const { logger } = require('../config/logger');
const { pool } = require('../config/database');

// ============================================================
// LIST & OVERVIEW
// ============================================================

/**
 * GET /workspaces - List all user's workspaces
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const workspaces = await workspaceService.getUserWorkspaces(userId);

        res.render('workspaces/index', {
            title: req.t('workspaces:title'),
            workspaces,
            user: req.session.user
        });
    } catch (error) {
        logger.error('Failed to list workspaces', { error: error.message });
        req.flash('error', req.t('workspaces:errors.loadError'));
        res.redirect('/dashboard');
    }
});

// ============================================================
// WORKSPACE CRUD
// ============================================================

/**
 * POST /workspaces/:projectName - Create workspace
 */
router.post('/:projectName',
    getWorkspaceAccess(),
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const userId = req.session.user.id;
            const projectName = req.params.projectName;

            // Check if workspace already exists
            if (req.workspace) {
                req.flash('error', req.t('workspaces:errors.alreadyExists'));
                return res.redirect(`/projects/${projectName}`);
            }

            // Check if user can create workspace
            const canCreate = await workspaceService.canCreateWorkspace(userId);
            if (!canCreate) {
                req.flash('error', req.t('workspaces:errors.maxReached'));
                return res.redirect(`/projects/${projectName}`);
            }

            // Create workspace
            await workspaceService.createWorkspace(userId, projectName);

            req.flash('success', req.t('workspaces:messages.created'));
            res.redirect(`/workspaces/${projectName}`);
        } catch (error) {
            logger.error('Failed to create workspace', { error: error.message });
            req.flash('error', req.t('workspaces:errors.createFailed'));
            res.redirect(`/projects/${req.params.projectName}`);
        }
    }
);

/**
 * GET /workspaces/:projectName - Workspace details
 */
router.get('/:projectName',
    getWorkspaceAccess(),
    requireWorkspace,
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const projectName = req.params.projectName;

            res.render('workspaces/show', {
                title: `${req.t('workspaces:title')} - ${projectName}`,
                workspace: req.workspace,
                project: req.projectAccess.project,
                projectAccess: req.projectAccess,
                user: req.session.user
            });
        } catch (error) {
            logger.error('Failed to show workspace', { error: error.message });
            req.flash('error', req.t('workspaces:errors.loadError'));
            res.redirect('/workspaces');
        }
    }
);

/**
 * DELETE /workspaces/:projectName - Delete workspace
 */
router.delete('/:projectName',
    getWorkspaceAccess(),
    requireWorkspace,
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const userId = req.session.user.id;
            const projectName = req.params.projectName;

            await workspaceService.deleteWorkspace(userId, projectName);

            res.json({
                success: true,
                message: req.t('workspaces:messages.deleted')
            });
        } catch (error) {
            logger.error('Failed to delete workspace', { error: error.message });
            res.status(500).json({
                success: false,
                error: req.t('workspaces:errors.deleteFailed')
            });
        }
    }
);

// ============================================================
// WORKSPACE ACTIONS
// ============================================================

/**
 * POST /workspaces/:projectName/start - Start workspace
 */
router.post('/:projectName/start',
    getWorkspaceAccess(),
    requireWorkspace,
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const userId = req.session.user.id;
            const projectName = req.params.projectName;
            const systemUsername = req.projectAccess.systemUsername;

            const workspace = await workspaceService.startWorkspace(
                userId,
                projectName,
                systemUsername
            );

            res.json({
                success: true,
                message: req.t('workspaces:messages.started'),
                workspace
            });
        } catch (error) {
            logger.error('Failed to start workspace', { error: error.message });
            res.status(500).json({
                success: false,
                error: error.message || req.t('workspaces:errors.startFailed')
            });
        }
    }
);

/**
 * POST /workspaces/:projectName/stop - Stop workspace
 */
router.post('/:projectName/stop',
    getWorkspaceAccess(),
    requireWorkspace,
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const userId = req.session.user.id;
            const projectName = req.params.projectName;

            const workspace = await workspaceService.stopWorkspace(userId, projectName);

            res.json({
                success: true,
                message: req.t('workspaces:messages.stopped'),
                workspace
            });
        } catch (error) {
            logger.error('Failed to stop workspace', { error: error.message });
            res.status(500).json({
                success: false,
                error: req.t('workspaces:errors.stopFailed')
            });
        }
    }
);

/**
 * POST /workspaces/:projectName/sync/to-project - Sync workspace to project
 */
router.post('/:projectName/sync/to-project',
    getWorkspaceAccess(),
    requireWorkspace,
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const userId = req.session.user.id;
            const projectName = req.params.projectName;
            const systemUsername = req.projectAccess.systemUsername;

            const result = await workspaceService.syncToProject(
                userId,
                projectName,
                systemUsername
            );

            res.json({
                success: true,
                message: req.t('workspaces:messages.synced'),
                result
            });
        } catch (error) {
            logger.error('Failed to sync to project', { error: error.message });
            res.status(500).json({
                success: false,
                error: req.t('workspaces:errors.syncFailed')
            });
        }
    }
);

/**
 * POST /workspaces/:projectName/sync/from-project - Sync project to workspace
 */
router.post('/:projectName/sync/from-project',
    getWorkspaceAccess(),
    requireWorkspace,
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const userId = req.session.user.id;
            const projectName = req.params.projectName;

            const result = await workspaceService.syncFromProject(userId, projectName);

            res.json({
                success: true,
                message: req.t('workspaces:messages.synced'),
                result
            });
        } catch (error) {
            logger.error('Failed to sync from project', { error: error.message });
            res.status(500).json({
                success: false,
                error: req.t('workspaces:errors.syncFailed')
            });
        }
    }
);

/**
 * POST /workspaces/:projectName/activity - Update activity (heartbeat)
 */
router.post('/:projectName/activity',
    getWorkspaceAccess(),
    requireWorkspace,
    requireRunningWorkspace,
    async (req, res) => {
        try {
            const userId = req.session.user.id;

            await workspaceService.updateActivity(req.workspace.id, userId);

            res.json({ success: true });
        } catch (error) {
            logger.error('Failed to update activity', { error: error.message });
            res.status(500).json({ success: false });
        }
    }
);

// ============================================================
// WORKSPACE IDE ACCESS
// ============================================================

/**
 * GET /workspaces/:projectName/ide - IDE view
 */
router.get('/:projectName/ide',
    getWorkspaceAccess(),
    requireWorkspace,
    requireRunningWorkspace,
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const userId = req.session.user.id;

            // Update last accessed
            await workspaceService.updateActivity(req.workspace.id, userId);

            // Check for concurrent access
            const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
            if (req.workspace.last_activity &&
                new Date(req.workspace.last_activity) > fiveMinAgo &&
                req.workspace.last_accessed_by &&
                req.workspace.last_accessed_by !== userId) {
                req.flash('warning', req.t('workspaces:warnings.concurrentAccess'));
            }

            // Build IDE URL - use direct port access for best compatibility with code-server
            // The workspace ports (10000-10100) must be accessible through firewall
            // SERVER_IP is configured during dployr setup (can be IP or domain)
            const serverHost = process.env.SERVER_IP;
            if (!serverHost || serverHost === 'localhost') {
                req.flash('error', req.t('workspaces:errors.noServerHost'));
                return res.redirect(`/workspaces/${req.params.projectName}`);
            }
            const ideUrl = `http://${serverHost}:${req.workspace.assigned_port}/`;

            res.render('workspaces/ide', {
                title: `IDE - ${req.params.projectName}`,
                workspace: req.workspace,
                project: req.projectAccess.project,
                user: req.session.user,
                ideUrl
            });
        } catch (error) {
            logger.error('Failed to access IDE', { error: error.message });
            req.flash('error', req.t('workspaces:errors.ideFailed'));
            res.redirect(`/workspaces/${req.params.projectName}`);
        }
    }
);

// ============================================================
// SETTINGS
// ============================================================

/**
 * Validates workspace settings input
 */
function validateWorkspaceSettings(settings) {
    const errors = [];

    // CPU limit validation (format: "0.5", "1", "2.5")
    if (settings.cpu_limit !== undefined && settings.cpu_limit !== null) {
        if (!/^[0-9]+(\.[0-9]+)?$/.test(settings.cpu_limit)) {
            errors.push('cpu_limit must be a number (e.g., "0.5", "1", "2")');
        } else {
            const cpu = parseFloat(settings.cpu_limit);
            if (cpu <= 0 || cpu > 16) {
                errors.push('cpu_limit must be between 0.1 and 16');
            }
        }
    }

    // RAM limit validation (format: "512m", "1g", "2G")
    if (settings.ram_limit !== undefined && settings.ram_limit !== null) {
        if (!/^[0-9]+[mMgG]$/.test(settings.ram_limit)) {
            errors.push('ram_limit must be in format: 512m, 1g, 2G');
        } else {
            const match = settings.ram_limit.match(/^([0-9]+)([mMgG])$/);
            const value = parseInt(match[1]);
            const unit = match[2].toLowerCase();

            if (unit === 'm' && value < 256) {
                errors.push('ram_limit minimum is 256m');
            }
            if (unit === 'g' && value > 16) {
                errors.push('ram_limit maximum is 16g');
            }
        }
    }

    // Idle timeout validation (5-1440 minutes)
    if (settings.idle_timeout_minutes !== undefined && settings.idle_timeout_minutes !== null) {
        const timeout = parseInt(settings.idle_timeout_minutes);
        if (isNaN(timeout) || timeout < 5 || timeout > 1440) {
            errors.push('idle_timeout_minutes must be between 5 and 1440');
        }
    }

    return errors;
}

/**
 * PUT /workspaces/:projectName/settings - Update workspace settings
 */
router.put('/:projectName/settings',
    getWorkspaceAccess(),
    requireWorkspace,
    requirePermission('full'), // Only owner can change settings
    async (req, res) => {
        try {
            const { cpu_limit, ram_limit, idle_timeout_minutes } = req.body;

            // Validate input
            const validationErrors = validateWorkspaceSettings({
                cpu_limit,
                ram_limit,
                idle_timeout_minutes
            });

            if (validationErrors.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid settings: ' + validationErrors.join(', ')
                });
            }

            await pool.query(
                `UPDATE workspaces SET
                    cpu_limit = COALESCE(?, cpu_limit),
                    ram_limit = COALESCE(?, ram_limit),
                    idle_timeout_minutes = COALESCE(?, idle_timeout_minutes)
                WHERE id = ?`,
                [cpu_limit, ram_limit, idle_timeout_minutes, req.workspace.id]
            );

            res.json({
                success: true,
                message: req.t('workspaces:messages.settingsUpdated')
            });
        } catch (error) {
            logger.error('Failed to update workspace settings', { error: error.message });
            res.status(500).json({
                success: false,
                error: req.t('workspaces:errors.updateFailed')
            });
        }
    }
);

// ============================================================
// PREVIEW ENVIRONMENTS
// ============================================================

/**
 * POST /workspaces/:projectName/previews - Create preview environment
 */
router.post('/:projectName/previews',
    getWorkspaceAccess(),
    requireWorkspace,
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const userId = req.session.user.id;
            const { lifetime_hours, password } = req.body;

            // Workspace muss laufen für Preview-Erstellung
            if (req.workspace.status !== 'running') {
                return res.status(400).json({
                    success: false,
                    error: req.t('workspaces:errors.notRunning')
                });
            }

            const preview = await previewService.createPreview(
                req.workspace.id,
                userId,
                { lifetimeHours: lifetime_hours, password }
            );

            res.json({
                success: true,
                message: req.t('workspaces:preview.created'),
                preview
            });
        } catch (error) {
            logger.error('Failed to create preview', { error: error.message });
            res.status(500).json({
                success: false,
                error: error.message || req.t('workspaces:preview.createFailed')
            });
        }
    }
);

/**
 * GET /workspaces/:projectName/previews - List workspace previews
 */
router.get('/:projectName/previews',
    getWorkspaceAccess(),
    requireWorkspace,
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const userId = req.session.user.id;
            const previews = await previewService.getWorkspacePreviews(
                req.workspace.id,
                userId
            );

            res.json({
                success: true,
                previews
            });
        } catch (error) {
            logger.error('Failed to list previews', { error: error.message });
            res.status(500).json({
                success: false,
                error: req.t('workspaces:preview.loadFailed')
            });
        }
    }
);

/**
 * DELETE /workspaces/:projectName/previews/:previewId - Delete preview
 */
router.delete('/:projectName/previews/:previewId',
    getWorkspaceAccess(),
    requireWorkspace,
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const userId = req.session.user.id;
            const previewId = parseInt(req.params.previewId);

            await previewService.deletePreview(previewId, userId);

            res.json({
                success: true,
                message: req.t('workspaces:preview.deleted')
            });
        } catch (error) {
            logger.error('Failed to delete preview', { error: error.message });
            res.status(500).json({
                success: false,
                error: req.t('workspaces:preview.deleteFailed')
            });
        }
    }
);

/**
 * POST /workspaces/:projectName/previews/:previewId/extend - Extend preview lifetime
 */
router.post('/:projectName/previews/:previewId/extend',
    getWorkspaceAccess(),
    requireWorkspace,
    requireWorkspacePermission,
    async (req, res) => {
        try {
            const userId = req.session.user.id;
            const previewId = parseInt(req.params.previewId);
            const { hours = 24 } = req.body;

            const preview = await previewService.extendPreview(previewId, userId, hours);

            res.json({
                success: true,
                message: req.t('workspaces:preview.extended'),
                preview
            });
        } catch (error) {
            logger.error('Failed to extend preview', { error: error.message });
            res.status(500).json({
                success: false,
                error: req.t('workspaces:preview.extendFailed')
            });
        }
    }
);

module.exports = router;
