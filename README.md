# Dployr

**Docker-based multi-user hosting platform for web projects.**

Deploy and manage isolated web projects on a shared Linux server through an intuitive web dashboard. Supports automatic project type detection, Git integration, and database provisioning.

<p align="center">
  <img src="docs/images/banner_v2.png" alt="Dployr Banner" width="800">
</p>

## Features

- **Web Dashboard** - Browser-based project management
- **Multiple Deployment Methods** - Git repository, ZIP upload, or empty template
- **Auto-Deploy** - Automatic updates on Git commits (configurable interval)
- **Project Type Detection** - Automatically detects Static, PHP, Node.js, Laravel, Next.js
- **Database Support** - MariaDB and PostgreSQL with phpMyAdmin & pgAdmin
- **Multi-User** - User registration with admin approval workflow
- **Project Sharing** - Share projects with other users (read/manage/full access)
- **Environment Editor** - Edit .env files directly in the browser
- **Custom Domains & SSL** - Connect domains with free Let's Encrypt certificates (optional)
- **Dark/Light Theme** - Switchable with preference storage

## Requirements

| Component | Minimum Version |
|-----------|-----------------|
| **Linux** | Any distribution |
| **Docker** | 20.10+ |
| **Docker Compose** | v2.0+ |
| **Git** | 2.0+ (optional) |

## Quick Start

```bash
# 1. Clone repository
git clone https://github.com/Flexomatic81/dployr.git /opt/dployr
cd /opt/dployr

# 2. Create configuration
cp .env.example .env
nano .env  # Set passwords!

# 3. Start everything
docker compose up -d

# 4. Open browser → Setup Wizard
# http://<SERVER_IP>:3000/setup
```

The setup wizard guides you through creating the first admin user.

## Services

After startup, the following services are available:

| Service | Port | Purpose |
|---------|------|---------|
| **Dashboard** | 3000 | Web interface |
| **MariaDB** | 3306 | MySQL-compatible database |
| **PostgreSQL** | 5432 | Advanced database |
| **phpMyAdmin** | 8080 | MariaDB management |
| **pgAdmin** | 5050 | PostgreSQL management |
| **NPM** | 80, 443, 81 | Domain proxy & SSL (optional) |

## Using the Dashboard

### Creating Projects

The dashboard offers three ways to create a project:

**Git Repository** (recommended for version control)
- Enter repository URL (HTTPS)
- For private repos: Add a personal access token
- Project type is automatically detected
- Use "Pull" button or Auto-Deploy for updates

**ZIP Upload** (quick deployment)
- Upload a ZIP file (max 100 MB)
- Automatic extraction and type detection
- Nested folders are automatically flattened

**Empty Template**
- Choose a project type (Static, PHP, Node.js)
- Start with a blank project structure

### Managing Projects

From the project detail page you can:
- **Start/Stop/Restart** containers
- **View logs** in real-time
- **Pull** latest changes from Git
- **Edit .env** environment variables
- **Configure database** credentials with one click
- **Share** with other users

### Databases

1. Go to **Databases** → **New Database**
2. Choose type: MariaDB or PostgreSQL
3. Enter a name
4. Credentials are automatically generated

To connect a database to a project:
1. Open the project detail page
2. Scroll to "Environment Variables"
3. Click **Configure DB** and select your database
4. Credentials are intelligently merged into .env
5. Restart the container

### Auto-Deploy

For Git projects, enable automatic deployment:

1. Open project detail page
2. Find "Git Connection" section
3. Click **Enable Auto-Deploy**
4. Choose interval (5, 10, 15, 30, or 60 minutes)

Dployr will poll for new commits and automatically pull + restart.

### Project Sharing

Share projects with other users:

| Permission | Can do |
|------------|--------|
| **Read** | View status, logs, project info |
| **Manage** | + Start/Stop, Pull, Deploy, Edit .env |
| **Full** | + Change project type |

Only the owner can delete, disconnect Git, configure Auto-Deploy, or manage shares.

### Domains & SSL

Connect custom domains to your projects (requires admin to enable NPM):

1. Open project detail page
2. Scroll to **Domains & SSL** section
3. Enter your domain (e.g., `app.example.com`)
4. Optionally enable **Request SSL certificate**
5. Click **Add**

**Prerequisites:**
- Domain DNS must point to server IP (A record)
- Project container must be running
- You must be owner or have "Full Access" permission

SSL certificates are automatically issued via Let's Encrypt and renewed before expiration.

## Configuration

### Environment Variables (.env)

```bash
# Required
MYSQL_ROOT_PASSWORD=SecurePassword123!
POSTGRES_ROOT_PASSWORD=SecurePassword123!
PGADMIN_PASSWORD=SecurePassword123!
SESSION_SECRET=  # Generate with: openssl rand -base64 32

# Optional (defaults shown)
DASHBOARD_PORT=3000
PHPMYADMIN_PORT=8080
PGADMIN_PORT=5050
PGADMIN_EMAIL=admin@local.dev
SERVER_IP=  # Auto-detected if empty

# NPM (Nginx Proxy Manager) - optional
NPM_ENABLED=false
NPM_API_EMAIL=admin@example.com
NPM_API_PASSWORD=changeme123
NPM_HTTP_PORT=80
NPM_HTTPS_PORT=443
NPM_ADMIN_PORT=81
```

### Custom Installation Path

If not using `/opt/dployr`, set the host path in `.env`:

```bash
HOST_USERS_PATH=/path/to/your/dployr/users
```

## Project Type Detection

Projects are automatically detected based on files:

| File | Detected Type |
|------|---------------|
| `next.config.js` / `next.config.mjs` | Next.js |
| `package.json` with build script | React/Vue (Static Build) |
| `package.json` | Node.js |
| `artisan` / `symfony.lock` | Laravel/Symfony |
| `composer.json` / `*.php` | PHP |
| `index.html` | Static |

If detection is wrong, you can change the type in project settings.

## CLI Scripts (Advanced)

For automation or direct server access:

```bash
# Create project interactively
./scripts/create-project.sh

# Delete project
./scripts/delete-project.sh <username> <projectname>

# Delete user with all projects
./scripts/delete-user.sh <username>

# List all projects
./scripts/list-projects.sh
```

### Docker Commands

```bash
# Start/Stop infrastructure
docker compose up -d
docker compose down

# View dashboard logs
docker compose logs -f dashboard

# Restart dashboard
docker compose restart dashboard
```

## Directory Structure

```
dployr/
├── docker-compose.yml      # Main infrastructure
├── .env                    # Configuration
├── dashboard/              # Web dashboard (Node.js)
├── users/                  # User projects
│   └── <username>/
│       ├── .db-credentials
│       └── <project>/
│           ├── docker-compose.yml
│           ├── .env
│           └── html/       # Project files
├── templates/              # Project templates
├── scripts/                # CLI management scripts
└── infrastructure/         # Database configuration
```

## Security

- Each user only has access to their own databases
- Database names are prefixed with username
- Containers are network-isolated
- New users require admin approval
- Secure password generation for DB credentials
- Session-based authentication with MySQL store

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
