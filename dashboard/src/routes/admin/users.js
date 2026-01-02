/**
 * Admin User Management Routes
 * Handles user CRUD, approval workflow, and user listing
 */

const express = require('express');
const router = express.Router();
const userService = require('../../services/user');
const projectService = require('../../services/project');
const emailService = require('../../services/email');
const { logger } = require('../../config/logger');
const { validate } = require('../../middleware/validation');

// Show pending registrations
router.get('/pending', async (req, res) => {
    try {
        const pendingUsers = await userService.getPendingUsers();

        res.render('admin/pending', {
            title: 'Pending Registrations',
            pendingUsers
        });
    } catch (error) {
        logger.error('Error loading pending registrations', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

// Approve user
router.post('/:id/approve', async (req, res) => {
    try {
        const user = await userService.approveUser(req.params.id);

        if (user) {
            // Send approval notification email if enabled and user has email
            const fullUser = await userService.getFullUserById(user.id);
            if (emailService.isEnabled() && fullUser.email) {
                const language = await userService.getUserLanguage(user.id);
                await emailService.sendApprovalEmail(fullUser.email, user.username, language);
                logger.info('Approval email sent', { userId: user.id, email: fullUser.email });
            }

            req.flash('success', req.t('admin:flash.userApproved', { username: user.username }));
        } else {
            req.flash('error', req.t('admin:errors.userNotFound'));
        }

        res.redirect('/admin/users/pending');
    } catch (error) {
        logger.error('Error approving user', { error: error.message });
        req.flash('error', error.message);
        res.redirect('/admin/users/pending');
    }
});

// Reject user registration
router.post('/:id/reject', async (req, res) => {
    try {
        await userService.rejectUser(req.params.id);
        req.flash('success', req.t('admin:flash.userRejected', { username: '' }));
        res.redirect('/admin/users/pending');
    } catch (error) {
        logger.error('Error rejecting user', { error: error.message });
        req.flash('error', error.message);
        res.redirect('/admin/users/pending');
    }
});

// User management - List
router.get('/', async (req, res) => {
    try {
        const users = await userService.getAllUsers();

        // Count projects per user in parallel
        const projectCounts = await Promise.all(
            users.map(user => projectService.getUserProjects(user.system_username))
        );

        users.forEach((user, index) => {
            user.projectCount = projectCounts[index].length;
        });

        res.render('admin/users', {
            title: 'User Management',
            users
        });
    } catch (error) {
        logger.error('Error loading users', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin');
    }
});

// Create new user - Form
router.get('/create', (req, res) => {
    res.render('admin/users-create', {
        title: 'New User'
    });
});

// Create new user - Processing
router.post('/', validate('createUser'), async (req, res) => {
    try {
        const { username, password, system_username, is_admin, email } = req.validatedBody;

        // Check if user exists
        if (await userService.existsUsernameOrSystemUsername(username, system_username)) {
            req.flash('error', req.t('auth:errors.usernameExists'));
            return res.redirect('/admin/users/create');
        }

        // Check if email is already in use
        if (email && await userService.emailExists(email)) {
            req.flash('error', req.t('auth:errors.emailExists'));
            return res.redirect('/admin/users/create');
        }

        // Admin-created users are automatically approved (email is optional)
        await userService.createUser(username, password, system_username, is_admin === 'on', true, email || null);

        req.flash('success', req.t('admin:flash.userCreated', { username }));
        res.redirect('/admin/users');
    } catch (error) {
        logger.error('Error creating user', { error: error.message });
        req.flash('error', req.t('common:errors.createError'));
        res.redirect('/admin/users/create');
    }
});

// Edit user - Form
router.get('/:id/edit', async (req, res) => {
    try {
        // Use getFullUserById to include email fields
        const editUser = await userService.getFullUserById(req.params.id);

        if (!editUser) {
            req.flash('error', req.t('admin:errors.userNotFound'));
            return res.redirect('/admin/users');
        }

        res.render('admin/users-edit', {
            title: 'Edit User',
            editUser
        });
    } catch (error) {
        logger.error('Error loading user', { error: error.message });
        req.flash('error', req.t('common:errors.loadError'));
        res.redirect('/admin/users');
    }
});

// Edit user - Processing
router.put('/:id', validate('updateUser'), async (req, res) => {
    try {
        const { username, password, system_username, is_admin, email } = req.validatedBody;
        const userId = req.params.id;

        // Check if username/system username is already in use
        if (await userService.existsUsernameOrSystemUsername(username, system_username, userId)) {
            req.flash('error', req.t('auth:errors.usernameExists'));
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        // Check if email is already in use by another user
        if (email && await userService.emailExists(email, userId)) {
            req.flash('error', req.t('auth:errors.emailExists'));
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        await userService.updateUser(userId, {
            username,
            password: password || null,
            systemUsername: system_username,
            isAdmin: is_admin === 'on',
            email: email || null
        });

        req.flash('success', req.t('admin:flash.userUpdated', { username }));
        res.redirect('/admin/users');
    } catch (error) {
        logger.error('Error updating user', { error: error.message });
        req.flash('error', error.message);
        res.redirect(`/admin/users/${req.params.id}/edit`);
    }
});

// Delete user
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.params.id;

        // Cannot delete own account
        if (parseInt(userId) === req.session.user.id) {
            req.flash('error', req.t('admin:errors.cannotDeleteSelf'));
            return res.redirect('/admin/users');
        }

        // Check if this is the last admin
        if (await userService.isLastAdmin(userId)) {
            req.flash('error', req.t('admin:errors.cannotDeleteLastAdmin'));
            return res.redirect('/admin/users');
        }

        await userService.deleteUser(userId);

        req.flash('success', req.t('admin:flash.userDeleted', { username: '' }));
        res.redirect('/admin/users');
    } catch (error) {
        logger.error('Error deleting user', { error: error.message });
        req.flash('error', error.message);
        res.redirect('/admin/users');
    }
});

module.exports = router;
