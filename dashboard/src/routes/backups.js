/**
 * Backup Routes
 * Handles project and database backup operations
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { getProjectAccess, requirePermission } = require('../middleware/projectAccess');
const backupService = require('../services/backup');
const projectService = require('../services/project');
const databaseService = require('../services/database');
const { logger } = require('../config/logger');

// All backup routes require authentication
router.use(requireAuth);

/**
 * GET /backups
 * List all backups for the current user
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const backups = await backupService.listBackups(userId);
        const stats = await backupService.getBackupStats(userId);

        res.render('backups/index', {
            title: req.t('backups:title'),
            backups,
            stats,
            formatFileSize: backupService.formatFileSize
        });
    } catch (error) {
        logger.error('Error loading backups', { error: error.message });
        req.flash('error', req.t('backups:errors.loadFailed'));
        res.redirect('/dashboard');
    }
});

/**
 * POST /backups/project/:name
 * Create a new project backup
 */
router.post('/project/:name', getProjectAccess(), requirePermission('manage'), async (req, res) => {
    try {
        const userId = req.session.user.id;
        const systemUsername = req.projectAccess.systemUsername;
        const projectName = req.params.name;

        // Create backup
        const backup = await backupService.createProjectBackup(
            userId,
            systemUsername,
            projectName
        );

        req.flash('success', req.t('backups:flash.created', {
            filename: backup.filename,
            size: backupService.formatFileSize(backup.size)
        }));

        // Redirect back to project page or backups page
        const returnTo = req.query.returnTo || `/projects/${projectName}`;
        res.redirect(returnTo);

    } catch (error) {
        logger.error('Error creating backup', {
            error: error.message,
            project: req.params.name
        });
        req.flash('error', req.t('backups:errors.createFailed', { error: error.message }));
        res.redirect(`/projects/${req.params.name}`);
    }
});

/**
 * POST /backups/database/:name
 * Create a new database backup
 */
router.post('/database/:name', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const systemUsername = req.session.user.system_username;
        const databaseName = req.params.name;

        // Verify the user owns this database
        const databases = await databaseService.getUserDatabases(systemUsername);
        const dbInfo = databases.find(db => db.database === databaseName);

        if (!dbInfo) {
            req.flash('error', req.t('backups:errors.accessDenied'));
            return res.redirect('/databases');
        }

        // Create backup
        const backup = await backupService.createDatabaseBackup(
            userId,
            systemUsername,
            databaseName
        );

        req.flash('success', req.t('backups:flash.created', {
            filename: backup.filename,
            size: backupService.formatFileSize(backup.size)
        }));

        // Redirect back to databases page or backups page
        const returnTo = req.query.returnTo || '/databases';
        res.redirect(returnTo);

    } catch (error) {
        logger.error('Error creating database backup', {
            error: error.message,
            database: req.params.name
        });
        req.flash('error', req.t('backups:errors.createFailed', { error: error.message }));
        res.redirect('/databases');
    }
});

/**
 * GET /backups/:id/download
 * Download a backup file
 */
router.get('/:id/download', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const backupId = parseInt(req.params.id);

        // Get backup info
        const backup = await backupService.getBackupInfo(backupId);

        if (!backup) {
            req.flash('error', req.t('backups:errors.notFound'));
            return res.redirect('/backups');
        }

        // Verify ownership
        if (backup.user_id !== userId) {
            req.flash('error', req.t('backups:errors.accessDenied'));
            return res.redirect('/backups');
        }

        // Check if file exists
        const fileExists = await backupService.backupFileExists(
            backup.system_username,
            backup.filename
        );

        if (!fileExists) {
            req.flash('error', req.t('backups:errors.fileNotFound'));
            return res.redirect('/backups');
        }

        // Get file path and send file
        const filePath = backupService.getBackupFilePath(
            backup.system_username,
            backup.filename
        );

        res.download(filePath, backup.filename);

    } catch (error) {
        logger.error('Error downloading backup', {
            error: error.message,
            backupId: req.params.id
        });
        req.flash('error', req.t('backups:errors.downloadFailed'));
        res.redirect('/backups');
    }
});

/**
 * DELETE /backups/:id
 * Delete a backup
 */
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const systemUsername = req.session.user.system_username;
        const backupId = parseInt(req.params.id);

        // Get backup info
        const backup = await backupService.getBackupInfo(backupId);

        if (!backup) {
            req.flash('error', req.t('backups:errors.notFound'));
            return res.redirect('/backups');
        }

        // Verify ownership
        if (backup.user_id !== userId) {
            req.flash('error', req.t('backups:errors.accessDenied'));
            return res.redirect('/backups');
        }

        // Delete backup
        await backupService.deleteBackup(backupId, systemUsername);

        req.flash('success', req.t('backups:flash.deleted'));

        // Handle redirect for AJAX or normal request
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({ success: true });
        }

        res.redirect('/backups');

    } catch (error) {
        logger.error('Error deleting backup', {
            error: error.message,
            backupId: req.params.id
        });

        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(500).json({ success: false, error: error.message });
        }

        req.flash('error', req.t('backups:errors.deleteFailed'));
        res.redirect('/backups');
    }
});

/**
 * GET /backups/project/:name
 * Get backups for a specific project (API)
 */
router.get('/project/:name', getProjectAccess(), async (req, res) => {
    try {
        const userId = req.session.user.id;
        const projectName = req.params.name;

        const backups = await backupService.getProjectBackups(userId, projectName);

        res.json({
            success: true,
            backups: backups.map(b => ({
                ...b,
                formattedSize: backupService.formatFileSize(b.file_size)
            }))
        });

    } catch (error) {
        logger.error('Error loading project backups', {
            error: error.message,
            project: req.params.name
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
