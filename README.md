# Dployr

**Docker-based multi-user hosting platform for web projects.**

Dployr enables multiple users to run isolated web projects on a shared Linux server. With web dashboard, automatic database creation, and GitHub integration.

<p align="center">
  <img src="docs/images/dashboard.png" alt="Dployr Dashboard" width="800">
</p>

## Requirements

| Component | Minimum Version | Note |
|-----------|-----------------|------|
| **Linux** | Any distribution | Debian, Ubuntu, CentOS, Fedora, Arch, etc. |
| **Docker** | 20.10+ | `curl -fsSL https://get.docker.com \| sh` |
| **Docker Compose** | v2.0+ | As plugin: `docker compose` |
| **Git** | 2.0+ | Optional, for GitHub integration |

## Features

- 🚀 **Interactive Project Setup** - No parameters needed, everything is prompted
- 🖥️ **Web Dashboard** - Browser-based management interface
- 🌙 **Dark/Light Theme** - Switchable with preference storage
- 🗄️ **Automatic Database Creation** - Optional during project setup
- 🔐 **Secure Credentials** - Automatically generated and stored in .env
- 📦 **GitHub Integration** - Clone repository directly during setup
- 📁 **ZIP Upload** - Upload projects via ZIP file (up to 100 MB)
- 🎯 **Auto Port Detection** - Automatically finds free ports
- 🔍 **Automatic Project Type Detection** - Detects Static/PHP/Node.js/Laravel/Next.js automatically
- 📝 **Environment Variables Editor** - Edit .env in browser with DB credential injection
- 🐳 **Docker-based Isolation** - Each project runs isolated
- 🗃️ **MariaDB + PostgreSQL** - Both databases available with phpMyAdmin & pgAdmin
- 📋 **Ready Templates** - Static, PHP, Node.js ready to use
- 👥 **Multi-User with Admin Approval** - New users must be approved by admin
- 🔄 **Changeable Project Type** - Switch later with recommendation warning
- ⚡ **Auto-Deploy** - Automatic updates on Git commits (configurable interval: 5-60 min)

## Quick Start

### Option A: Docker Compose (Recommended)

One command - everything runs:

```bash
# 1. Clone repository
git clone https://github.com/your-username/dployr.git /opt/dployr
cd /opt/dployr

# 2. Create configuration
cp .env.example .env
nano .env  # Set passwords!

# 3. Start everything
docker compose up -d

# 4. Open browser → Setup Wizard
# http://<SERVER_IP>:3000/setup
```

**What gets started:**
- MariaDB (Port 3306)
- PostgreSQL (Port 5432)
- phpMyAdmin (Port 8080)
- pgAdmin (Port 5050)
- Web Dashboard (Port 3000)

After the setup wizard you can start right away!

## Directory Structure

```
dployr/
├── docker-compose.yml         # ⭐ Main file - starts everything
├── .env                       # Configuration (from .env.example)
├── .env.example               # Template for configuration
│
├── infrastructure/            # MariaDB/phpMyAdmin config
│   └── mariadb/              # DB configuration
│
├── users/                     # User projects
│   └── <username>/
│       ├── .db-credentials           # Auto-generated DB credentials
│       └── <projectname>/
│           ├── docker-compose.yml
│           ├── .env                  # Project config + DB credentials
│           ├── html/                 # Website files (Git repo)
│           └── nginx/               # Nginx config
│
├── templates/                 # Project templates
│   ├── static-website/       # HTML/CSS/JS
│   ├── php-website/          # PHP + Nginx
│   └── nodejs-app/           # Node.js Express
│
├── scripts/                   # Management scripts
│   ├── create-project.sh     # Create new project (interactive!)
│   ├── create-database.sh    # Create database manually
│   ├── delete-project.sh     # Delete project
│   ├── delete-user.sh        # Delete user with all projects
│   └── list-projects.sh      # List all projects
│
├── dashboard/                # Web Dashboard (Node.js)
│   ├── Dockerfile
│   └── src/                  # Dashboard source code
│
└── README.md                # This file
```

## Important Commands

### Project Management

```bash
# Create new project (INTERACTIVE - recommended!)
./scripts/create-project.sh

# Old method (still works):
./scripts/create-project.sh <username> <projectname> <template>

# Available templates: static-website, php-website, nodejs-app

# Create database manually (only if needed)
./scripts/create-database.sh <username> <db-name>

# List all projects
./scripts/list-projects.sh
```

### Delete Project

```bash
# With script (recommended - also asks about database deletion)
./scripts/delete-project.sh <username> <projectname>

# Manually
cd /opt/dployr/users/<USER>/PROJECTNAME
docker compose down
cd ..
rm -rf PROJECTNAME
```

### Delete User

```bash
# Deletes all projects, containers, and databases of the user
./scripts/delete-user.sh <username>
```

### Web Dashboard

The dashboard is available at `http://<SERVER_IP>:3000` and offers:
- **Create projects** (three methods):
  - From Git repository (GitHub, GitLab, Bitbucket)
  - Via ZIP upload (up to 100 MB, automatic extraction)
  - From template (Static, PHP, Node.js)
- **Automatic project type detection**: Static, PHP, Node.js, Laravel, Next.js
- **Project type recommendation**: Warning on type mismatch with one-click correction
- **Environment variables editor**: Edit .env directly in browser
  - Automatically detect and copy `.env.example`
  - Insert database credentials with one click
- Start, stop, restart, delete containers
- View container status and logs
- Git pull for connected repositories
- Manage databases (MariaDB & PostgreSQL)
- Multi-user login with admin approval
- Dark/Light theme toggle
- Admin panel for user management

### Infrastructure

```bash
# Start
docker compose up -d

# Stop
docker compose down

# Status
docker ps --filter network=dployr-network
```

### Single Project

```bash
cd users/username/projectname

# Start
docker compose up -d

# Logs
docker compose logs -f

# Stop
docker compose down

# Get Git updates (if GitHub project)
cd html
git pull
```

## Services

Available after start:

| Service | External Access | Docker Network |
|---------|-----------------|----------------|
| **MariaDB** | `<SERVER_IP>:3306` | `dployr-mariadb:3306` |
| **PostgreSQL** | `<SERVER_IP>:5432` | `dployr-postgresql:5432` |
| **phpMyAdmin** | `http://<SERVER_IP>:8080` | - |
| **pgAdmin** | `http://<SERVER_IP>:5050` | - |
| **Dashboard** | `http://<SERVER_IP>:3000` | - |

### Database Selection

When creating a new database in the dashboard, you can choose between **MariaDB** and **PostgreSQL**:

- **MariaDB**: MySQL-compatible, ideal for WordPress, Laravel, PHP projects
- **PostgreSQL**: Advanced features, ideal for complex applications, Django, Rails

Connection details are automatically generated and stored in `.db-credentials`.

## VS Code Remote SSH

The best method to work on the server:

```bash
# 1. Install Remote - SSH extension
# 2. Ctrl+Shift+P → Remote-SSH: Connect to Host
# 3. <USER>@<SERVER_IP>
# 4. Open Folder → /opt/dployr/users/<USER>/PROJECTNAME/html
# 5. Edit files → Save = LIVE!
```

## Workflow: Deploy Project

```
1. Develop locally in VS Code
   ↓
2. Choose deployment method:

   OPTION A (Git Repository - Recommended for versioning):
   → git push to GitHub/GitLab
   → Open Dashboard → New Project → Tab "From Git Repository"
   → Enter repository URL (+ token for private repos)
   → Project type is automatically detected
   → Project is live!

   OPTION B (ZIP Upload - Quick & easy):
   → Pack project as ZIP
   → Dashboard → New Project → Tab "ZIP Upload"
   → Upload ZIP (max. 100 MB)
   → Project type is automatically detected
   → Project is live!

   OPTION C (Template - Empty project):
   → Dashboard → New Project → Tab "From Template"
   → Select type (Static/PHP/Node.js)
   → Edit files via VS Code Remote SSH

   OPTION D (Update existing Git project):
   Dashboard → Open project → "Pull" button
   OR: ssh <USER>@<SERVER_IP>
   cd /opt/dployr/users/<USER>/PROJECT/html
   git pull

   OPTION E (Auto-Deploy - Automatic):
   → Enable once on the project detail page
   → Choose interval (5, 10, 15, 30, or 60 minutes)
   → Every git push automatically deploys!
   ↓
3. Done! Website is updated
```

## NPM Integration

For each project in Nginx Proxy Manager:

1. Add Proxy Host
2. Domain: `project.your-domain.com`
3. Forward to: `<SERVER_IP>:PORT` (Port from project .env)
4. Enable SSL

## Automatic Features

### Port Management
- Script automatically finds next free port
- No more manual counting!

### Database Credentials
- Automatically generated and secure
- Stored in `.env` and `.db-credentials`
- Ready to use in PHP/Node.js

### Permissions
- Automatically set correctly (755/644)
- No more 403 Forbidden!

### Project Type Detection
During creation (Git/ZIP) and on the project page, the type is automatically detected:

| Detected File | Project Type |
|---------------|--------------|
| `next.config.js` / `next.config.mjs` | Next.js (SSR) |
| `package.json` with build script | React/Vue (Static Build) |
| `package.json` | Node.js App |
| `artisan` / `symfony.lock` | Laravel/Symfony |
| `composer.json` / `*.php` | PHP Website |
| `index.html` | Static Website |

On type mismatch, the project page shows a warning with one-click correction.

### Git & ZIP Integration
- **Git**: Create projects directly from GitHub/GitLab/Bitbucket
  - Clones into `html/` subdirectory for consistent structure
  - Supports private repos with Personal Access Token
  - Git pull directly in dashboard
- **ZIP Upload**: Upload projects via ZIP file
  - Max. 100 MB file size
  - Automatic extraction into `html/` directory
  - Automatic flattening (also nested folders)
- Project type is automatically detected (from `html/` folder)
- Matching Docker configuration is generated

## Quick Reference

```bash
# New project
./scripts/create-project.sh

# Delete project
./scripts/delete-project.sh <username> <projectname>

# Delete user (incl. all projects & databases)
./scripts/delete-user.sh <username>

# Git update
cd users/<USER>/PROJECT/html && git pull

# Restart container
cd users/<USER>/PROJECT && docker compose restart

# View logs
cd users/<USER>/PROJECT && docker compose logs -f

# All running projects
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

# Deploy update (git pull + rebuild + restart)
# Can be run from anywhere - auto-navigates to project root
./scripts/deploy.sh
```

## Security

- Set MySQL root password in `.env` (`MYSQL_ROOT_PASSWORD`)
- Set PostgreSQL root password in `.env` (`POSTGRES_ROOT_PASSWORD`)
- Set pgAdmin password in `.env` (`PGADMIN_PASSWORD`)
- Each DB user only has access to their own databases
- Database names are prefixed with username (e.g., `<username>_myproject`)
- Containers are network-isolated
- Use SSL/TLS via Nginx Proxy Manager
- Automatically generated secure passwords for DB users
- New users must be approved by admin
- Server IP is configured in setup wizard and stored securely

## Configuration (.env)

```bash
# Required
MYSQL_ROOT_PASSWORD=YourSecurePassword123!
POSTGRES_ROOT_PASSWORD=YourSecurePostgresPassword123!
PGADMIN_PASSWORD=YourPgAdminPassword123!
SESSION_SECRET=  # openssl rand -base64 32

# Optional (default values)
DASHBOARD_PORT=3000
PHPMYADMIN_PORT=8080
PGADMIN_PORT=5050
PGADMIN_EMAIL=admin@local.dev
SERVER_IP=  # Automatically detected

# Custom installation path (if not using /opt/dployr)
HOST_USERS_PATH=/path/to/your/dployr/users
```

### Custom Installation Path

By default, Dployr expects to be installed in `/opt/dployr`. If you install it elsewhere, set `HOST_USERS_PATH` in your `.env`:

```bash
# Example: Installed in /home/user/dployr
HOST_USERS_PATH=/home/user/dployr/users
```

This path is used by the dashboard to execute docker-compose commands on the host system.
