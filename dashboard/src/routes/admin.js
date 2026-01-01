/**
 * Admin Routes
 * This file re-exports the modular admin router from ./admin/index.js
 *
 * Structure:
 * - /admin/                     -> Dashboard overview (index.js)
 * - /admin/projects             -> All projects (index.js)
 * - /admin/users/*              -> User management (users.js)
 * - /admin/logs/*               -> System logs & deployments (logs.js)
 * - /admin/settings/*           -> Email & NPM settings (settings.js)
 */

module.exports = require('./admin/index');
