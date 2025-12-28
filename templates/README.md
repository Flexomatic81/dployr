# Project Templates

Ready-to-use templates for different project types. Simply copy and customize.

## Available Templates

### 1. **static-website**
Simple static website (HTML/CSS/JS)
- Nginx webserver
- Lightweight and fast

### 2. **php-website**
PHP website (e.g., WordPress, custom apps)
- PHP 8.2 with Apache
- Extensions: PDO, MySQL, PostgreSQL, GD, mbstring, intl, zip, opcache
- mod_rewrite enabled

### 3. **nodejs-app**
Node.js application (Express, Fastify, etc.)
- Node.js 20 runtime
- Automatic npm install
- Environment variables support

### 4. **python-flask**
Python web app (Flask, FastAPI)
- Python 3.12 runtime
- Gunicorn WSGI server
- PostgreSQL/MySQL support

### 5. **python-django**
Django web application
- Python 3.12 runtime
- Gunicorn WSGI server
- Automatic migrations
- Static files collection

## Dynamically Generated Templates

These additional templates are automatically generated when creating projects from Git/ZIP:

| Type | Description | Detection |
|------|-------------|-----------|
| `laravel` | Laravel/Symfony with Composer | `artisan` or `symfony.lock` |
| `nodejs-static` | React/Vue/Svelte/Astro build to static | `react`, `vue`, `svelte`, `astro` in package.json |
| `nextjs` | Next.js with SSR | `next` in package.json |
| `nuxtjs` | Nuxt.js with SSR | `nuxt` in package.json |

## Usage

1. Copy template to user directory:
   ```bash
   cp -r templates/static-website users/username/projectname
   ```

2. Navigate to project directory and customize:
   ```bash
   cd users/username/projectname
   nano docker-compose.yml  # Adjust ports, names
   ```

3. Start containers:
   ```bash
   docker-compose up -d
   ```

4. Configure domain in reverse proxy and forward to container port

## Directory Structure

All templates follow this structure:
```
project/
├── docker-compose.yml    # Docker configuration
├── .env.example          # Environment variables template
└── html/                 # Application files
    ├── index.html        # (static)
    ├── index.php         # (php)
    ├── package.json      # (nodejs)
    ├── requirements.txt  # (python)
    └── ...
```
