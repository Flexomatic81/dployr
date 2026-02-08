# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Deployment Rules

- **Server deployments** (ssh hetzner, deploy.sh) **always require explicit user confirmation**
- Commits and pushes only when requested by the user
- When a commit fixes a GitHub issue, include `Closes #N` in the commit message body

## Code Style

**Language: English everywhere except UI text**
- Code comments, log messages, variable names, JSDoc, shell scripts → English
- User-facing UI text (form labels, buttons, flash messages) → German

```javascript
// Good: English comment + log
logger.info('Project created', { name });
// Good: German UI text
req.flash('success', 'Projekt erfolgreich erstellt');
```

## Project Overview

Dployr is a Docker-based multi-user hosting platform for deploying isolated web projects (Static, PHP, Node.js, Python) with automatic database provisioning (MariaDB/PostgreSQL) through a web dashboard.

## Development Commands

```bash
docker compose up -d              # Start all services
docker compose logs -f dashboard  # View logs
docker compose restart dashboard  # Restart after changes
cd dashboard && npm run dev       # Run locally
cd dashboard && npm test          # Run tests
```

## Architecture

```
dashboard/src/
├── app.js                    # Express entry (Helmet, Rate Limiting, Sessions)
├── config/                   # database.js, logger.js, i18n.js, constants.js
├── middleware/               # auth.js, projectAccess.js, workspaceAccess.js, csrf.js, validation.js, upload.js
├── routes/                   # auth, dashboard, projects, databases, backups, logs, admin, setup, profile, webhooks, workspaces
├── services/                 # Business logic (see Key Concepts below)
│   ├── providers/            # mariadb-provider.js, postgresql-provider.js
│   └── utils/                # nginx.js, crypto.js, security.js, webhook.js
├── errors/AppError.js        # ValidationError, NotFoundError, AuthorizationError, etc.
├── views/                    # EJS templates
└── tests/                    # Jest unit tests
```

### Path Mapping

Dashboard runs in Docker and translates paths:
- Container: `/app/users/...` (USERS_PATH)
- Host: `/opt/dployr/users/...` (HOST_USERS_PATH)

### Project Structure

```
/app/users/{username}/{projectname}/
├── docker-compose.yml    # Docker config (references ./html)
├── .env                  # System variables (PROJECT_NAME, EXPOSED_PORT)
└── html/                 # App files (Git clone / ZIP extract target)
    ├── .env              # App environment variables
    └── ...
```

**Legacy:** Old Git projects may have `.git` in project root instead of `html/`. Handled by `getGitPath()` and `isGitRepository()`.

## Key Concepts

### Template Types

**Physical** (in `/templates/`): static-website, php-website, nodejs-app, python-flask, python-django

**Auto-detected** (from Git/ZIP): laravel, nodejs-static (React/Vue/Svelte/Astro), nextjs, nuxtjs, custom

### Custom Docker-Compose

Users can deploy their own `docker-compose.yml`. The system validates, sanitizes, and transforms:
- Blocks dangerous options (privileged, cap_add, host network, docker.sock mounts)
- Prefixes container names, remaps ports, adds resource limits
- Database volumes go to `./data/` instead of `./html/`
- Port allocation checks `usedPorts` set to avoid conflicts with existing projects

Service: `compose-validator.js`

### Port Management

Centralized port tracking via `project_ports` database table:
- Ports registered on project creation (template, git, zip, clone) and released on deletion
- `findNextAvailablePort()` merges database + filesystem scan for robustness
- Custom compose projects register all port mappings (multi-port)
- Auto-backfill on startup when table is empty

Service: `projectPorts.js`, Table: `project_ports`

### Database Provider Pattern

Providers implement `createDatabase()` and `deleteDatabase()`. Credentials stored in `/app/users/{username}/.db-credentials`.

### Project Sharing

Permission levels: `read` (view only), `manage` (start/stop, deploy), `full` (+ type changes). Only owner can delete, configure auto-deploy, manage shares.

### Auto-Deploy & Webhooks

- **Polling:** Configurable intervals (5-60 min), checks for new commits
- **Webhooks:** Instant deploy via GitHub/GitLab/Bitbucket webhooks with HMAC validation

Service: `autodeploy.js`, Tables: `project_autodeploy`, `deployment_logs`

### NPM Integration

Optional Nginx Proxy Manager for domain routing and Let's Encrypt SSL. Configured via Admin → NPM Settings.

Service: `proxy.js`, Table: `project_domains`

### Email System

Optional SMTP for verification, password reset, deployment notifications. Configured via Admin → Email Settings.

Service: `email.js`, Templates in `templates/emails/{de,en}/`

### System Updates

One-click updates via GitHub Releases API with real-time SSE progress. Channels: stable (main), beta (dev).

Service: `update.js`, Script: `deploy.sh`

### Workspaces (Cloud IDE)

Browser-based VS Code (code-server) with Claude Code CLI integration:
- Persistent Claude login via volume mount
- File sync between workspace and project
- Preview environments for sharing work
- WebSocket terminal via docker exec

Services: `workspace.js`, `terminal.js`, `claude-terminal.js`, `preview.js`, `encryption.js`, `portManager.js`

### Backup & Restore

Project backups (tar.gz) and database backups (SQL dumps). Stored in `/app/users/{username}/.backups/`.

Service: `backup.js`, Table: `backup_logs`

## Authentication

1. User registers → `approved = FALSE`
2. Admin approves via `/admin`
3. Sessions stored in MySQL (24h expiry)
4. Optional 2FA via TOTP (authenticator apps) with backup codes

Middleware: `requireAuth`, `requireAdmin`

Service: `twofa.js`

## Security

- Helmet (CSP, security headers)
- **Nonce-based CSP**: No `unsafe-inline`/`unsafe-eval` in scriptSrc. Inline `<script>` tags require `nonce="<%= cspNonce %>"`. No inline event handlers (`onclick`, `onkeypress` etc.) — use `addEventListener` instead.
- **No shell execution**: Docker commands use `spawn()` (argument arrays), git commands use `execFile()` — no `exec()` with template strings
- Rate limiting (auth: 10/15min, API: 100/min)
- Joi input validation
- CSRF protection (session-based)
- Docker-compose validation for user uploads

## Error Classes

`AppError` hierarchy: ValidationError (400), AuthenticationError (401), AuthorizationError (403), NotFoundError (404), ConflictError (409), DatabaseError (500), DockerError (500), RateLimitError (429)

## Claude Code Skills

| Skill | Purpose |
|-------|---------|
| `/dployr-precommit` | Ultra-fast pre-commit checks (staged files only, < 10s) |
| `/dployr-check` | Quick lint check - language, i18n, code style (< 1 min) |
| `/dployr-review` | Deep review - architecture, security, performance, tests (5-10 min) |
| `/dployr-release` | Create release (changelog, tag, GitHub) |

### Proactive Skill Usage

**Use skills automatically in these situations:**

| Trigger | Action |
|---------|--------|
| After writing/editing code (new feature, bugfix) | Run `/dployr-check` |
| User requests commit | Run `/dployr-precommit` first |
| User requests release | Run `/dployr-review` first |
| Major refactoring completed | Run `/dployr-review` |

## Environment Variables

**Required:** `MYSQL_ROOT_PASSWORD`, `POSTGRES_ROOT_PASSWORD`, `PGADMIN_PASSWORD`, `SESSION_SECRET`

**Optional:** `SERVER_IP`, `DASHBOARD_PORT` (3000), `PHPMYADMIN_PORT` (8080), `PGADMIN_PORT` (5050), `HOST_DPLOYR_PATH`, `UPDATE_CHANNEL`

See `.env.example` for full list including NPM and Email settings.
