# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Style

**Language Requirements - Everything in English:**
- All code comments MUST be in English (in .js, .ejs, .sh, .yml files)
- All log messages (logger.info, logger.error, etc.) MUST be in English
- All variable and function names MUST be in English
- All JSDoc comments MUST be in English
- HTML/EJS comments (`<!-- -->`, `<%# %>`) MUST be in English
- Configuration file comments (.env.example, docker-compose.yml) MUST be in English
- Shell script comments and echo messages MUST be in English
- Documentation files (README.md, CLAUDE.md, etc.) MUST be in English

**Exception - UI Text (German):**
- User-facing UI text rendered in the browser remains in **German**
- This includes: form labels, button text, validation messages, flash notifications, page titles, help tooltips

**Examples:**
```javascript
// Good: English comment
// Check if user has permission

// Bad: German comment
// Prüfe ob Benutzer Berechtigung hat

// Good: English log message
logger.info('Project created successfully', { name: projectName });

// Bad: German log message
logger.info('Projekt erfolgreich erstellt', { name: projectName });

// Good: German UI text (user-facing)
req.flash('success', 'Projekt erfolgreich erstellt');
res.render('page', { title: 'Projekte' });
```

## Project Overview

Dployr is a Docker-based multi-user hosting platform that allows users to deploy isolated web projects (Static, PHP, Node.js) with automatic database provisioning (MariaDB/PostgreSQL) through a web dashboard.

## Development Commands

```bash
# Start all services (MariaDB, PostgreSQL, phpMyAdmin, pgAdmin, Dashboard)
docker compose up -d

# View dashboard logs
docker compose logs -f dashboard

# Restart dashboard after code changes
docker compose restart dashboard

# Run dashboard locally (development)
cd dashboard && npm run dev

# Access the dashboard
# http://localhost:3000 (or http://<SERVER_IP>:3000)
```

## Architecture

### Service Layer Pattern

The dashboard uses a service-oriented architecture with clear separation:

```
dashboard/src/
├── app.js              # Express app entry point (Helmet, Rate Limiting, Session Store)
├── config/
│   ├── database.js     # MySQL connection pool
│   ├── logger.js       # Winston logger configuration
│   ├── i18n.js         # i18next configuration (DE/EN)
│   └── constants.js    # Shared constants (permissions, intervals, DB aliases)
├── middleware/
│   ├── auth.js         # Authentication middleware (requireAuth, requireAdmin)
│   ├── projectAccess.js # Project access control (getProjectAccess, requirePermission)
│   ├── csrf.js         # CSRF protection (csrf-sync)
│   ├── validation.js   # Input validation with Joi
│   └── upload.js       # Multer config for ZIP uploads
├── routes/             # Express route handlers
│   ├── auth.js         # Login, register, logout
│   ├── dashboard.js    # Main dashboard
│   ├── projects.js     # Project CRUD, Git/ZIP deployment, sharing
│   ├── databases.js    # Database CRUD with type selection
│   ├── logs.js         # Container logs viewer
│   ├── admin.js        # User management, approval workflow, system logs, deployments
│   ├── setup.js        # Initial configuration wizard
│   ├── help.js         # Help/documentation page
│   ├── profile.js      # User profile, notification preferences
│   └── webhooks.js     # Git webhook endpoints (GitHub, GitLab, Bitbucket)
├── services/           # Business logic layer
│   ├── project.js      # Project lifecycle, type changes
│   ├── docker.js       # Container orchestration via dockerode
│   ├── database.js     # Multi-DB provider delegation
│   ├── user.js         # Authentication, approval workflow
│   ├── git.js          # Git ops, type detection, docker-compose generation
│   ├── zip.js          # ZIP extraction, auto-flatten
│   ├── sharing.js      # Project sharing, permission management
│   ├── autodeploy.js   # Auto-deploy polling, deployment execution
│   ├── email.js        # Email service (SMTP, templates, notifications)
│   ├── providers/      # Database-specific implementations
│   │   ├── mariadb-provider.js
│   │   └── postgresql-provider.js
│   └── utils/          # Shared utility functions
│       ├── nginx.js    # Nginx config generation
│       ├── crypto.js   # Password generation
│       └── security.js # Security utilities (blocked files removal)
├── views/              # EJS templates with express-ejs-layouts
└── tests/              # Unit tests (Jest)
    ├── services/       # Service tests
    └── middleware/     # Middleware tests
```

### Database Provider Pattern

Database operations are abstracted through providers. Each provider implements:
- `createDatabase(systemUsername, databaseName)` - Returns credentials object
- `deleteDatabase(systemUsername, databaseName)` - Removes DB and user

Credentials are stored in `/app/users/{systemUsername}/.db-credentials` with format:
```
# Database: username_mydb (created: 2024-01-15T12:00:00.000Z, type: postgresql)
DB_TYPE=postgresql
DB_HOST=dployr-postgresql
DB_PORT=5432
DB_DATABASE=username_mydb
DB_USERNAME=username_mydb
DB_PASSWORD=xxxxx
```

### Docker Infrastructure

All services run on `dployr-network`. The dashboard container mounts:
- `/var/run/docker.sock` - For container management
- User projects, scripts, templates as volumes

User projects are created under `/app/users/{systemUsername}/{projectname}/` with their own docker-compose.yml.

### Project Structure

All projects follow a consistent structure with app files in the `html/` subfolder:

```
/app/users/{username}/{projectname}/
├── docker-compose.yml    # Docker configuration (references ./html)
├── .env                  # Docker system variables (PROJECT_NAME, EXPOSED_PORT)
├── nginx/                # Nginx config (for static projects)
│   └── default.conf
└── html/                 # App files (Git clone target, ZIP extract target)
    ├── .git/             # Git repository (if from Git)
    ├── .env              # App environment variables
    ├── .env.example      # Template (if exists)
    ├── package.json      # or composer.json, index.html, etc.
    └── ...
```

**Note:** Legacy Git projects (cloned before this structure) may have Git in the project root instead of `html/`. The system automatically detects and handles both structures via `getGitPath()` and `isGitRepository()` functions.

### Path Mapping

The dashboard runs in Docker and must translate paths:
- Container path: `/app/users/...` (USERS_PATH)
- Host path: `/opt/dployr/users/...` (HOST_USERS_PATH)

This is handled in `docker.js` when executing docker-compose commands.

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Main infrastructure definition |
| `.env` / `.env.example` | Environment configuration |
| `dashboard/src/services/project.js` | Project creation, type changes |
| `dashboard/src/services/docker.js` | Container start/stop/logs via dockerode |
| `dashboard/src/services/database.js` | Database CRUD with provider pattern |
| `dashboard/src/services/git.js` | Git clone, type detection, docker-compose generation |
| `dashboard/src/services/zip.js` | ZIP upload processing, auto-flatten |
| `dashboard/src/middleware/upload.js` | Multer configuration for file uploads |
| `scripts/create-project.sh` | CLI project creation (interactive) |
| `templates/*/docker-compose.yml` | Template definitions |

## Template Types

### Physical Templates (in `/templates/`)
- **static-website**: Nginx serving HTML/CSS/JS
- **php-website**: PHP 8.2 with Apache, PDO extensions
- **nodejs-app**: Node.js 20 with npm start
- **python-flask**: Python 3.12 with Gunicorn (Flask, FastAPI)
- **python-django**: Python 3.12 with Gunicorn, auto-migrations

### Dynamically Generated Templates (from Git/ZIP detection)
- **laravel**: Laravel/Symfony with Composer (detected by `artisan` or `symfony.lock`)
- **nodejs-static**: React/Vue/Svelte/Astro build to static (detected by framework in package.json)
- **nextjs**: Next.js with SSR (detected by `next` in package.json)
- **nuxtjs**: Nuxt.js with SSR (detected by `nuxt` in package.json)

Template type is auto-detected from docker-compose.yml content in existing projects.

## Authentication Flow

1. User registers → `approved = FALSE`
2. Admin approves via `/admin` panel
3. User can log in after approval
4. Session stored in MySQL (express-mysql-session, 24-hour maxAge)

Middleware: `requireAuth` protects routes, `requireAdmin` for admin operations.

## Security Features

The dashboard implements multiple security layers:

- **Helmet**: Security headers (CSP, X-Frame-Options, etc.)
- **Rate Limiting**: Auth routes limited to 10 requests/15min, general API 100 requests/min
- **Input Validation**: Joi schemas for login, register, project creation
- **MySQL Session Store**: Persistent sessions (survives restarts)
- **CSRF Protection**: Via session-based forms (skipped for `/setup/*` routes during initial setup)
- **Blocked Docker Files**: Custom Dockerfiles/docker-compose.yml are automatically removed

### Blocked Project Files

Users cannot deploy custom Docker configurations. The following files are automatically removed from Git clones and ZIP uploads:

- `Dockerfile`, `dockerfile`
- `docker-compose.yml`, `docker-compose.yaml`
- `compose.yml`, `compose.yaml`
- `.dockerignore`

This is enforced by `removeBlockedFiles()` in `services/utils/security.js`. The blocked files list is defined in `config/constants.js` as `BLOCKED_PROJECT_FILES`.

**Why?** Users can only deploy using the predefined project templates (static, PHP, Node.js, etc.). This prevents:
- Privilege escalation via custom Docker images
- Resource abuse via unlimited container configurations
- Security bypasses via custom network settings

## Logging

Winston logger with structured logging:

```javascript
const { logger } = require('../config/logger');
logger.info('Message', { context: 'value' });
logger.error('Error', { error: error.message });
```

### Admin Log Viewer

Admins can view system logs and deployment history via the admin panel:

**Routes:**
- `GET /admin/logs` - View system logs (combined.log, error.log)
- `GET /admin/logs/api` - JSON API for live refresh
- `GET /admin/deployments` - Deployment history for all users

**Features:**
- Log level filter (error, warn, info, debug)
- Log file selection (combined.log or error.log)
- Deployment statistics (last 24h)
- Expandable metadata and error messages

**Deployment Trigger Types:**
- `auto` - Automatic deployment via polling
- `manual` - Manually triggered deployment (button)
- `clone` - Initial Git clone when creating project
- `pull` - Manual Git pull
- `webhook` - Instant deployment triggered by Git provider webhook

Log files in `dashboard/logs/`:
- `combined.log` - All logs
- `error.log` - Errors only

## Testing

Unit tests with Jest:

```bash
cd dashboard && npm test
```

Test structure:
- `tests/services/user.test.js` - User service tests
- `tests/middleware/auth.test.js` - Auth middleware tests
- `tests/middleware/validation.test.js` - Validation tests

## Environment Variables

Required in `.env`:
```
MYSQL_ROOT_PASSWORD     # MariaDB root password
POSTGRES_ROOT_PASSWORD  # PostgreSQL root password
PGADMIN_PASSWORD        # pgAdmin login password
SESSION_SECRET          # Express session secret
```

Optional:
```
SERVER_IP               # For UI links (auto-detected if empty)
DASHBOARD_PORT          # Default: 3000
PHPMYADMIN_PORT         # Default: 8080
PGADMIN_PORT            # Default: 5050
```

## Project Deployment Methods

Projects can be created via three methods:

### 1. Git Repository (`POST /projects/from-git`)
The `git.js` service:
- Clones repositories into `html/` subfolder for consistent structure
- Supports private repos with access tokens
- Auto-detects project type from files in `html/`
- Generates appropriate docker-compose.yml with `./html` volume mounts
- Sanitizes URLs to hide tokens in display

### 2. ZIP Upload (`POST /projects/from-zip`)
The `zip.js` service:
- Accepts ZIP files up to 100 MB via multer middleware
- Auto-flattens nested folders (e.g., `projekt-main/` → project root)
- Auto-detects project type from files
- Generates docker-compose.yml and nginx config as needed

### 3. Template (`POST /projects`)
Creates empty project from predefined templates in `/templates/`.

## Legacy Project Compatibility

For Git projects created before the `html/` structure was introduced:
- `isGitRepository()` checks both `html/.git` and project root `.git`
- `getGitPath()` returns the correct path based on where `.git` exists
- `changeProjectType()` adjusts docker-compose.yml paths (`.` instead of `./html`) for legacy projects
- `.env` editor and `.env.example` detection use `getGitPath()` to find the correct location

## Environment Variables Editor

The project detail page includes an `.env` editor with:

- **Textarea editor**: Direct editing of `.env` file content
- **`.env.example` detection**: Automatically finds `.env.example`, `.env.sample`, `.env.dist`, `.env.template`
- **Smart DB Credentials Merge**: Intelligent database credential injection (see below)

**Important:** The `.env` editor edits the **app's** `.env` file (in `html/` or Git path), not the Docker system `.env` in the project root. System variables (PROJECT_NAME, EXPOSED_PORT) are managed separately.

Routes:
- `POST /projects/:name/env` - Save .env content
- `POST /projects/:name/env/copy-example` - Copy .env.example to .env
- `POST /projects/:name/env/add-db` - Smart merge of database credentials

## Smart DB Credentials Merge

The "Configure DB" button intelligently merges database credentials into `.env` files:

**How it works:**
1. Uses `.env.example` as template (if available)
2. Detects known DB variable aliases and replaces their values
3. Preserves non-DB variables from existing `.env`
4. Appends missing credentials at the end

**Known DB Variable Aliases** (in `config/constants.js`):
```javascript
DB_VARIABLE_ALIASES = {
    host: ['DB_HOST', 'DATABASE_HOST', 'MYSQL_HOST', 'POSTGRES_HOST', ...],
    port: ['DB_PORT', 'DATABASE_PORT', 'MYSQL_PORT', ...],
    database: ['DB_DATABASE', 'DB_NAME', 'MYSQL_DATABASE', ...],
    username: ['DB_USERNAME', 'DB_USER', 'MYSQL_USER', ...],
    password: ['DB_PASSWORD', 'DATABASE_PASSWORD', ...]
}
```

**Example:**
- `.env.example` contains `DB_USER=root` and `DB_NAME=myapp`
- User selects database `john_blog` from Dployr
- Result: `DB_USER=john_blog` and `DB_NAME=john_blog`

**Service Function:** `mergeDbCredentials()` in `project.js`

## Auto-Deploy

Git projects can be automatically updated when new commits are pushed.

**How it works:**
- Polling-based: Server checks regularly for new commits
- Configurable interval: 5, 10, 15, 30, or 60 minutes (per project)
- On changes: automatic `git pull` + container restart
- Deployment history is stored in the database

**Database Tables:**
- `project_autodeploy` - Configuration (user_id, project_name, branch, enabled, interval_minutes, last_check, webhook_secret, webhook_enabled)
- `deployment_logs` - History (trigger_type, commit_hashes, status, duration_ms)

**Routes:**
- `POST /projects/:name/autodeploy/enable` - Enable auto-deploy
- `POST /projects/:name/autodeploy/disable` - Disable auto-deploy
- `POST /projects/:name/autodeploy/interval` - Change polling interval (5, 10, 15, 30, 60 min)
- `POST /projects/:name/autodeploy/trigger` - Trigger manual deployment
- `GET /projects/:name/autodeploy/history` - Deployment history (JSON API)

**Service:** `autodeploy.js` - Polling logic, deployment execution, history logging

**Logging Function:** `logDeployment(userId, projectName, triggerType, data)` - Reusable function for logging all deployment types (auto, manual, clone, pull, webhook)

### Webhooks

As an alternative to polling, webhooks enable instant deployments when code is pushed. Supports GitHub, GitLab, and Bitbucket.

**Webhook Routes:**
- `POST /api/webhooks/:webhookId` - Receives webhook from Git providers (no CSRF, no session)
- `POST /projects/:name/webhook/enable` - Enable webhook, returns secret (owner only)
- `POST /projects/:name/webhook/disable` - Disable webhook (owner only)
- `POST /projects/:name/webhook/regenerate` - Generate new secret (owner only)

**Security:**
- HMAC-SHA256 signature validation (GitHub, Bitbucket)
- Plain token comparison (GitLab)
- Timing-safe comparisons (`crypto.timingSafeEqual`) to prevent timing attacks
- Rate limiting: 30 requests/minute per IP
- Branch filtering: Only configured branch triggers deployment

**Webhook URL Format:**
```
https://<server>/api/webhooks/<autoDeployId>
```

**Provider Detection (from headers):**
| Provider | Event Header | Signature Header | Push Event |
|----------|--------------|------------------|------------|
| GitHub | `x-github-event` | `x-hub-signature-256` | `push` |
| GitLab | `x-gitlab-event` | `x-gitlab-token` | `Push Hook` |
| Bitbucket | `x-event-key` | `x-hub-signature` | `repo:push` |

**Utility Module:** `services/utils/webhook.js` - Signature validation, provider detection, payload parsing

## Project Sharing

Projects can be shared with other users.

**Permission Levels:**
- `read` - View only (status, logs, project info)
- `manage` - Operations allowed (start/stop, pull, deploy, edit .env)
- `full` - Almost all rights (+ change project type)

**Only the owner can:** Delete project, disconnect Git, configure auto-deploy, manage shares

**Database Table:** `project_shares` (owner_id, project_name, shared_with_id, permission)

**Routes:**
- `GET /projects/:name/shares` - List all shares (owner only)
- `POST /projects/:name/shares` - Create new share
- `PUT /projects/:name/shares/:userId` - Change permission
- `DELETE /projects/:name/shares/:userId` - Remove share

**Service:** `sharing.js` - Share management, permission checking, permission helpers

## Nginx Proxy Manager (NPM) Integration

Optional domain and SSL certificate management for projects via Nginx Proxy Manager.

**Features:**
- Automatic SSL certificates via Let's Encrypt
- Domain-to-project routing
- Admin panel for NPM configuration
- Container control (start/stop/restart) from dashboard
- Live container logs viewer

**Configuration:**
NPM can be enabled during initial setup or later via Admin → NPM Settings.

**Environment Variables** (in `.env`):
```
NPM_ENABLED=true           # Enable/disable NPM integration
NPM_API_EMAIL=admin@...    # NPM admin email (also for Let's Encrypt)
NPM_API_PASSWORD=...       # NPM admin password (min 8 chars)
NPM_HTTP_PORT=80           # HTTP port (default: 80)
NPM_HTTPS_PORT=443         # HTTPS port (default: 443)
NPM_ADMIN_PORT=81          # NPM admin panel port (default: 81)
```

**How NPM Credentials Work:**
- NPM 2.9+ uses `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` env vars on first database creation
- These are only read once when the NPM container first starts
- To change credentials after initial setup, use the "Recreate" button which removes the container and data volumes

**Admin Routes:**
- `GET /admin/settings/npm` - NPM settings page
- `POST /admin/settings/npm` - Save NPM configuration
- `GET /admin/settings/npm/status` - Container status API
- `POST /admin/settings/npm/start` - Start container
- `POST /admin/settings/npm/stop` - Stop container
- `POST /admin/settings/npm/restart` - Restart container
- `POST /admin/settings/npm/test` - Test API connection
- `POST /admin/settings/npm/initialize` - Initialize credentials
- `POST /admin/settings/npm/recreate` - Remove container and volumes for fresh start
- `GET /admin/settings/npm/logs` - Container logs API
- `GET /admin/settings/npm/operation-logs` - Domain/SSL operation logs from dashboard
- `POST /admin/settings/npm/dashboard-domain` - Configure dashboard domain
- `DELETE /admin/settings/npm/dashboard-domain` - Remove dashboard domain

**User Routes (Domain Management):**
- `GET /proxy/status` - Check if NPM is enabled and connected
- `GET /proxy/:name/domains` - List domains for a project
- `POST /proxy/:name/domains` - Add domain to project (requires full permission)
- `DELETE /proxy/:name/domains/:domain` - Remove domain from project
- `POST /proxy/:name/domains/:domain/ssl` - Request SSL certificate for domain

**User Flow:**
1. Project owner/full permission opens project details
2. "Domains & SSL" card appears (if NPM enabled)
3. User enters domain (e.g., `app.example.com`)
4. System creates NPM proxy host → routes domain to project container
5. Optional: Let's Encrypt SSL certificate is requested automatically
6. Domain is immediately accessible

**Prerequisites:**
- NPM enabled (`NPM_ENABLED=true`)
- NPM container running and initialized
- Domain DNS pointing to server IP
- Project container running
- User is owner or has "full" permission

**Service:** `proxy.js` - NPM API client, container control, domain mappings

**Database Table:** `project_domains` - Domain-to-project mappings with SSL status

**Dashboard Domain Feature:**
Admins can configure a custom domain for the dashboard itself (e.g., `app.dployr.de`):
- Configured in Admin → NPM Settings → Dashboard Domain
- Creates NPM proxy host routing domain to dashboard container (port 3000)
- Optional SSL certificate via Let's Encrypt
- Port 3000 remains available as fallback
- Stored in `.env` as `NPM_DASHBOARD_DOMAIN`

## Email System

Optional email functionality for user notifications and account management.

**Features:**
- Email verification on registration
- Password reset via email
- Account approval notifications
- Deployment success/failure notifications
- Configurable notification preferences per user

**Configuration:**
Email can be enabled during initial setup or later via Admin → Email Settings.

**Environment Variables** (in `.env`):
```
EMAIL_ENABLED=true              # Enable/disable email functionality
EMAIL_HOST=smtp.example.com     # SMTP server
EMAIL_PORT=587                  # SMTP port
EMAIL_SECURE=false              # Use TLS (true for port 465)
EMAIL_USER=noreply@example.com  # SMTP username
EMAIL_PASSWORD=...              # SMTP password
EMAIL_FROM=Dployr <noreply@example.com>  # Sender address
EMAIL_VERIFICATION_EXPIRES=24   # Verification token validity (hours)
EMAIL_RESET_EXPIRES=1           # Password reset token validity (hours)
```

**Admin Routes:**
- `GET /admin/settings/email` - Email configuration page
- `POST /admin/settings/email` - Save email settings
- `POST /admin/settings/email/test` - Test SMTP connection

**User Routes:**
- `GET /forgot-password` - Password reset request form
- `POST /forgot-password` - Send reset email
- `GET /reset-password?token=...` - Password reset form
- `POST /reset-password` - Set new password
- `GET /verify-email?token=...` - Verify email address
- `POST /resend-verification` - Resend verification email
- `GET /profile/notifications` - Notification preferences
- `POST /profile/notifications` - Save notification preferences

**Email Templates** (in `templates/emails/{de,en}/`):
- `verification.ejs` - Email verification
- `password-reset.ejs` - Password reset link
- `account-approved.ejs` - Account approval notification
- `deployment-success.ejs` - Deployment success notification
- `deployment-failure.ejs` - Deployment failure notification

**Notification Preferences:**
Users can configure which emails they receive via `/profile/notifications`:
- Deployment success notifications
- Deployment failure notifications
- Auto-deploy notifications

**Service:** `email.js` - SMTP transport, template rendering, email sending functions

**Database Columns** (in `dashboard_users`):
- `email` - User email address
- `email_verified` - Email verification status
- `verification_token` / `verification_token_expires` - Email verification
- `reset_token` / `reset_token_expires` - Password reset
- `notify_deploy_success` - Notification preference
- `notify_deploy_failure` - Notification preference
- `notify_autodeploy` - Notification preference

## Key Services

| Service | Purpose |
|---------|---------|
| `project.js` | Project CRUD, type changes, .env management, DB credential handling |
| `docker.js` | Container orchestration via dockerode |
| `database.js` | Multi-DB provider delegation |
| `git.js` | Git clone (to html/), type detection, docker-compose generation, path helpers (getGitPath, isGitRepository) |
| `zip.js` | ZIP extraction (to html/), auto-flatten, project creation |
| `autodeploy.js` | Auto-deploy polling, deployment execution, history logging |
| `sharing.js` | Project sharing, permission levels (read/manage/full), access control |
| `proxy.js` | NPM integration, domain management, SSL certificates |
| `email.js` | SMTP email sending, template rendering, deployment notifications |

## Middleware

| Middleware | Purpose |
|------------|---------|
| `auth.js` | `requireAuth`, `requireAdmin` route protection |
| `projectAccess.js` | `getProjectAccess()`, `requirePermission()` for project access control |
| `validation.js` | Joi-based input validation for forms |
| `upload.js` | Multer config for ZIP uploads (100 MB limit, `/tmp/dployr-uploads`)

## Utility Modules

| Module | Purpose |
|--------|---------|
| `utils/nginx.js` | `generateNginxConfig()` for static website nginx config |
| `utils/crypto.js` | `generatePassword()` for secure password generation |
| `utils/security.js` | `removeBlockedFiles()` for removing Docker files from uploads |
| `utils/webhook.js` | Webhook signature validation, provider detection, payload parsing |

## Config Modules

| Module | Purpose |
|--------|---------|
| `config/database.js` | MySQL connection pool |
| `config/logger.js` | Winston logger setup (console + file) |
| `config/constants.js` | `PERMISSION_LEVELS`, `VALID_INTERVALS`, `PROJECT_TYPES`, `BLOCKED_PROJECT_FILES`, `DB_VARIABLE_ALIASES` |

## Project Type Detection

There are two different type detection functions:

| Function | Location | Purpose |
|----------|----------|---------|
| `detectProjectType()` | `git.js` | Analyzes source files (package.json, composer.json, etc.) to detect type |
| `detectTemplateType()` | `project.js` | Reads configured type from docker-compose.yml |

The project detail page compares both to detect mismatches and offers one-click correction.

## Claude Code Skills

Project-specific skills for development workflow (in `.claude/commands/`):

| Skill | Purpose |
|-------|---------|
| `/dployr-check` | Quick consistency check (German text, console.log, security, personal data) |
| `/dployr-review` | Deep code review (architecture, best practices, security, performance) |
| `/dployr-test` | Run tests and analyze results with improvement suggestions |
| `/dployr-changelog` | Generate changelog from Git commits for releases |

Usage: Type the skill name (e.g., `/dployr-check`) in Claude Code to execute.
