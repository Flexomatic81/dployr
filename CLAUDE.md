# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
├── app.js              # Express app entry point
├── config/database.js  # MySQL connection pool
├── middleware/
│   ├── auth.js         # Authentication middleware (requireAuth, requireAdmin)
│   └── upload.js       # Multer config for ZIP uploads
├── routes/             # Express route handlers
│   ├── auth.js         # Login, register, logout
│   ├── dashboard.js    # Main dashboard
│   ├── projects.js     # Project CRUD, Git/ZIP deployment
│   ├── databases.js    # Database CRUD with type selection
│   ├── admin.js        # User management, approval workflow
│   └── setup.js        # Initial configuration wizard
├── services/           # Business logic layer
│   ├── project.js      # Project lifecycle, type changes
│   ├── docker.js       # Container orchestration via dockerode
│   ├── database.js     # Multi-DB provider delegation
│   ├── user.js         # Authentication, approval workflow
│   ├── git.js          # Git ops, type detection, docker-compose generation
│   ├── zip.js          # ZIP extraction, auto-flatten
│   └── providers/      # Database-specific implementations
│       ├── mariadb-provider.js
│       └── postgresql-provider.js
└── views/              # EJS templates with express-ejs-layouts
```

### Database Provider Pattern

Database operations are abstracted through providers. Each provider implements:
- `createDatabase(systemUsername, databaseName)` - Returns credentials object
- `deleteDatabase(systemUsername, databaseName)` - Removes DB and user

Credentials are stored in `/app/users/{systemUsername}/.db-credentials` with format:
```
# Database: mydb (created: 2024-01-15, type: postgresql)
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

Templates in `/templates/` define project scaffolding:
- **static-website**: Nginx serving HTML/CSS/JS
- **php-website**: PHP-FPM + Nginx with PDO extensions
- **nodejs-app**: Node.js with npm start

Template type is auto-detected from docker-compose.yml content in existing projects.

## Authentication Flow

1. User registers → `approved = FALSE`
2. Admin approves via `/admin` panel
3. User can log in after approval
4. Session stored in memory (24-hour maxAge)

Middleware: `requireAuth` protects routes, `requireAdmin` for admin operations.

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

## Project Type Detection

The `detectProjectType()` function in `git.js` analyzes project files. It automatically checks the `html/` subfolder first (for new structure), then falls back to project root (for legacy projects).

| Detection | Project Type |
|-----------|--------------|
| `next.config.js` or `next.config.mjs` | nextjs |
| `package.json` with build script + static output | nodejs-static |
| `package.json` | nodejs |
| `artisan` or `symfony.lock` | laravel |
| `composer.json` or `*.php` files | php |
| `index.html` | static |

The project detail page (`/projects/:name`) compares detected type with configured type and shows a warning if they mismatch, allowing one-click correction.

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
- **Copy example**: Merges example file with existing values (doesn't overwrite)
- **DB credential injection**: Dropdown to insert database credentials from user's databases

**Important:** The `.env` editor edits the **app's** `.env` file (in `html/` or Git path), not the Docker system `.env` in the project root. System variables (PROJECT_NAME, EXPOSED_PORT) are managed separately.

Routes:
- `POST /projects/:name/env` - Save .env content
- `POST /projects/:name/env/copy-example` - Copy .env.example to .env
- `POST /projects/:name/env/add-db` - Append database credentials

## Auto-Deploy

Git-Projekte können automatisch aktualisiert werden, wenn neue Commits gepusht werden.

**Funktionsweise:**
- Polling-basiert: Server prüft regelmäßig auf neue Commits
- Konfigurierbares Intervall: 5, 10, 15, 30 oder 60 Minuten (pro Projekt einstellbar)
- Bei Änderungen: automatischer `git pull` + Container-Restart
- Deployment-Historie wird in der Datenbank gespeichert

**Datenbank-Tabellen:**
- `project_autodeploy` - Konfiguration (user_id, project_name, branch, enabled, interval_minutes, last_check)
- `deployment_logs` - Historie (trigger_type, commit_hashes, status, duration_ms)

**Routes:**
- `POST /projects/:name/autodeploy/enable` - Auto-Deploy aktivieren
- `POST /projects/:name/autodeploy/disable` - Auto-Deploy deaktivieren
- `POST /projects/:name/autodeploy/interval` - Polling-Intervall ändern (5, 10, 15, 30, 60 Min)
- `POST /projects/:name/autodeploy/trigger` - Manuelles Deployment auslösen
- `GET /projects/:name/autodeploy/history` - Deployment-Historie (JSON API)

**Service:** `autodeploy.js` - Polling-Logik, Deployment-Ausführung, Historie-Logging

## Key Services

| Service | Purpose |
|---------|---------|
| `project.js` | Project CRUD, type changes, .env management, DB credential handling |
| `docker.js` | Container orchestration via dockerode |
| `database.js` | Multi-DB provider delegation |
| `git.js` | Git clone (to html/), type detection, docker-compose generation, path helpers (getGitPath, isGitRepository) |
| `zip.js` | ZIP extraction (to html/), auto-flatten, project creation |
| `autodeploy.js` | Auto-deploy polling, deployment execution, history logging |

## Middleware

| Middleware | Purpose |
|------------|---------|
| `auth.js` | `requireAuth`, `requireAdmin` route protection |
| `upload.js` | Multer config for ZIP uploads (100 MB limit, `/tmp/dployr-uploads`)
