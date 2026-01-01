/**
 * Projects Routes
 * This file re-exports the modular projects router from ./projects/index.js
 *
 * Structure:
 * - /projects/                      -> List all projects (index.js)
 * - /projects/create                -> Create form (index.js)
 * - /projects/:name                 -> Show project (index.js)
 * - /projects/:name/git/*           -> Git operations (git.js)
 * - /projects/:name/autodeploy/*    -> Auto-deploy config (autodeploy.js)
 * - /projects/:name/webhook/*       -> Webhook config (webhook.js)
 * - /projects/:name/shares/*        -> Sharing management (sharing.js)
 */

module.exports = require('./projects/index');
