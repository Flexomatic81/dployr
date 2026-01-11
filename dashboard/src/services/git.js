const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const { generateNginxConfig } = require('./utils/nginx');
const { removeBlockedFiles } = require('./utils/security');
const { logger } = require('../config/logger');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

/**
 * Checks if a project is a Git repository
 * Git repos are cloned into the html/ subfolder
 */
function isGitRepository(projectPath) {
    // First check in html/ subfolder (new structure)
    const gitDirHtml = path.join(projectPath, 'html', '.git');
    if (fs.existsSync(gitDirHtml)) {
        return true;
    }
    // Fallback: Directly in project folder (old structure, for compatibility)
    const gitDir = path.join(projectPath, '.git');
    return fs.existsSync(gitDir);
}

/**
 * Returns the path to the Git directory (html/ or root)
 */
function getGitPath(projectPath) {
    const htmlPath = path.join(projectPath, 'html');
    if (fs.existsSync(path.join(htmlPath, '.git'))) {
        return htmlPath;
    }
    // Fallback for old projects
    if (fs.existsSync(path.join(projectPath, '.git'))) {
        return projectPath;
    }
    return htmlPath; // Default for new projects
}

/**
 * Gets Git status information for a project
 */
async function getGitStatus(projectPath) {
    if (!isGitRepository(projectPath)) {
        return null;
    }

    const gitPath = getGitPath(projectPath);

    try {
        const git = simpleGit(gitPath);

        // Get remote URL
        const remotes = await git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        const remoteUrl = origin?.refs?.fetch || '';

        // Current branch
        const branchSummary = await git.branch();
        const branch = branchSummary.current;

        // Last commit
        const logResult = await git.log({ maxCount: 1 });
        const lastCommitData = logResult.latest;
        const lastCommit = lastCommitData
            ? `${lastCommitData.hash.substring(0, 7)} - ${lastCommitData.message} (${formatRelativeTime(lastCommitData.date)})`
            : '';

        // Check if local changes exist
        const status = await git.status();
        const hasLocalChanges = !status.isClean();

        // Clean URL for display (remove token)
        const displayUrl = sanitizeUrlForDisplay(remoteUrl);

        return {
            connected: true,
            remoteUrl: displayUrl,
            branch,
            lastCommit,
            hasLocalChanges
        };
    } catch (error) {
        logger.error('Git status error', { error: error.message });
        return {
            connected: true,
            error: 'Error fetching Git status'
        };
    }
}

/**
 * Formats a date relatively (e.g., "2 hours ago")
 */
function formatRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
    if (diffHour > 0) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
    if (diffMin > 0) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
    return 'just now';
}

/**
 * Removes credentials from URL for display
 */
function sanitizeUrlForDisplay(url) {
    // https://token@github.com/user/repo -> https://github.com/user/repo
    return url.replace(/https:\/\/[^@]+@/, 'https://');
}

/**
 * Creates an authenticated URL for private repos
 */
function createAuthenticatedUrl(repoUrl, token) {
    if (!token) return repoUrl;

    // https://github.com/user/repo -> https://TOKEN@github.com/user/repo
    if (repoUrl.startsWith('https://')) {
        return repoUrl.replace('https://', `https://${token}@`);
    }
    return repoUrl;
}

/**
 * Clones a Git repository into a project directory
 * Existing files are replaced by repository files,
 * but docker-compose.yml and nginx/ are preserved
 */
async function cloneRepository(projectPath, repoUrl, token = null) {
    // Check if a Git repository already exists
    if (isGitRepository(projectPath)) {
        throw new Error('Project is already connected to a Git repository. Please disconnect first.');
    }

    const authenticatedUrl = createAuthenticatedUrl(repoUrl, token);
    const tempDir = `${projectPath}_temp_${Date.now()}`;

    try {
        // Clone with simple-git (secure, no shell escaping needed)
        const git = simpleGit({ timeout: { block: 120000 } });
        await git.clone(authenticatedUrl, tempDir);

        // Backup important files (docker-compose.yml, nginx, .env)
        const backups = {};
        const filesToPreserve = ['docker-compose.yml', 'nginx', '.env'];

        for (const file of filesToPreserve) {
            const filePath = path.join(projectPath, file);
            if (fs.existsSync(filePath)) {
                const tempBackupPath = path.join(tempDir, `_backup_${file}`);
                if (fs.statSync(filePath).isDirectory()) {
                    fs.cpSync(filePath, tempBackupPath, { recursive: true });
                    backups[file] = { isDir: true, backupPath: tempBackupPath };
                } else {
                    fs.copyFileSync(filePath, tempBackupPath);
                    backups[file] = { isDir: false, backupPath: tempBackupPath };
                }
            }
        }

        // Completely empty old directory
        const oldFiles = fs.readdirSync(projectPath);
        for (const file of oldFiles) {
            const filePath = path.join(projectPath, file);
            fs.rmSync(filePath, { recursive: true, force: true });
        }

        // Move files from temp (except backups)
        const newFiles = fs.readdirSync(tempDir);
        for (const file of newFiles) {
            if (file.startsWith('_backup_')) continue;

            const src = path.join(tempDir, file);
            const dest = path.join(projectPath, file);
            fs.renameSync(src, dest);
        }

        // Restore backed up files
        for (const [file, backup] of Object.entries(backups)) {
            const filePath = path.join(projectPath, file);
            if (fs.existsSync(filePath)) {
                fs.rmSync(filePath, { recursive: true, force: true });
            }
            if (backup.isDir) {
                fs.cpSync(backup.backupPath, filePath, { recursive: true });
            } else {
                fs.copyFileSync(backup.backupPath, filePath);
            }
        }

        // Delete temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });

        // Save token in .git-credentials for later pulls
        if (token) {
            await saveCredentials(projectPath, repoUrl, token);
        }

        // Adjust Docker-Compose if needed
        adjustDockerCompose(projectPath);

        // Remove blocked Docker files from user repository (security)
        // Only from html/ - projectPath contains our system-generated docker-compose.yml
        const removedFiles = removeBlockedFiles(path.join(projectPath, 'html'));
        if (removedFiles.length > 0) {
            logger.info('Removed blocked files after clone', { files: removedFiles });
        }

        return {
            success: true,
            message: 'Repository cloned successfully'
        };
    } catch (err) {
        // Cleanup on error
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
            logger.warn('Failed to cleanup temporary directory after clone error', {
                tempDir,
                cleanupError: cleanupError.message,
                originalError: err.message
            });
        }

        // Remove token from error message
        const cleanError = (err.message || '').replace(/https:\/\/[^@]+@/g, 'https://***@');
        throw new Error(`Git clone failed: ${cleanError}`);
    }
}

/**
 * Saves credentials for a repository
 */
async function saveCredentials(projectPath, repoUrl, token) {
    const gitPath = getGitPath(projectPath);
    const credentialsPath = path.join(gitPath, '.git-credentials');
    const url = new URL(repoUrl);
    const credentialLine = `https://${token}@${url.host}${url.pathname}`;

    fs.writeFileSync(credentialsPath, credentialLine + '\n', { mode: 0o600 });

    // Configure Git with simple-git
    const git = simpleGit(gitPath);
    await git.addConfig('credential.helper', 'store --file=.git-credentials');
}

/**
 * Adjusts docker-compose.yml to the repository structure
 * - If ./html doesn't exist but index.html is in root,
 *   the volume mount is changed from ./html to .
 */
function adjustDockerCompose(projectPath) {
    const composePath = path.join(projectPath, 'docker-compose.yml');
    const htmlDir = path.join(projectPath, 'html');
    const indexInRoot = path.join(projectPath, 'index.html');
    const srcDir = path.join(projectPath, 'src');

    if (!fs.existsSync(composePath)) return;

    try {
        let content = fs.readFileSync(composePath, 'utf-8');
        let modified = false;

        // Case 1: Static Website - ./html doesn't exist, but index.html in root
        if (!fs.existsSync(htmlDir) && fs.existsSync(indexInRoot)) {
            if (content.includes('./html:/usr/share/nginx/html')) {
                content = content.replace(
                    './html:/usr/share/nginx/html',
                    '.:/usr/share/nginx/html'
                );
                modified = true;
                logger.debug('Docker-Compose adjusted: ./html -> . (index.html found in root)');
            }
        }

        // Case 2: Node.js App - ./src doesn't exist, but package.json in root
        const packageJson = path.join(projectPath, 'package.json');
        if (!fs.existsSync(srcDir) && fs.existsSync(packageJson)) {
            if (content.includes('./src:/app/src')) {
                content = content.replace('./src:/app/src', '.:/app');
                modified = true;
                logger.debug('Docker-Compose adjusted: ./src -> . (package.json found in root)');
            }
        }

        // Case 3: PHP Website - ./public doesn't exist, but index.php in root
        const publicDir = path.join(projectPath, 'public');
        const indexPhp = path.join(projectPath, 'index.php');
        if (!fs.existsSync(publicDir) && fs.existsSync(indexPhp)) {
            if (content.includes('./public:/var/www/html')) {
                content = content.replace('./public:/var/www/html', '.:/var/www/html');
                modified = true;
                logger.debug('Docker-Compose adjusted: ./public -> . (index.php found in root)');
            }
        }

        if (modified) {
            fs.writeFileSync(composePath, content);
        }
    } catch (error) {
        logger.error('Error adjusting docker-compose.yml', { error: error.message });
    }
}

/**
 * Pulls the latest changes from remote
 */
async function pullChanges(projectPath) {
    if (!isGitRepository(projectPath)) {
        throw new Error('Not a Git repository');
    }

    const gitPath = getGitPath(projectPath);

    try {
        const git = simpleGit(gitPath);
        const result = await git.pull();

        // Check if changes were pulled
        const hasChanges = result.files.length > 0 ||
                          result.insertions > 0 ||
                          result.deletions > 0;

        return {
            success: true,
            hasChanges,
            output: result.summary ? JSON.stringify(result.summary) : 'Pull completed'
        };
    } catch (err) {
        const cleanError = (err.message || '').replace(/https:\/\/[^@]+@/g, 'https://***@');
        throw new Error(`Git pull failed: ${cleanError}`);
    }
}

/**
 * Removes the Git connection from a project
 */
function disconnectRepository(projectPath) {
    const gitPath = getGitPath(projectPath);
    const gitDir = path.join(gitPath, '.git');
    const credentialsFile = path.join(gitPath, '.git-credentials');

    if (fs.existsSync(gitDir)) {
        fs.rmSync(gitDir, { recursive: true, force: true });
    }

    if (fs.existsSync(credentialsFile)) {
        fs.unlinkSync(credentialsFile);
    }

    return { success: true, message: 'Git connection removed' };
}

/**
 * Validates a Git repository URL
 */
function isValidGitUrl(url) {
    // Supports: https://github.com/user/repo.git or https://github.com/user/repo
    const httpsPattern = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+(\.git)?$/;
    return httpsPattern.test(url);
}

/**
 * Gets the project path for a user
 */
function getProjectPath(systemUsername, projectName) {
    return path.join(USERS_PATH, systemUsername, projectName);
}

/**
 * Detects the project type based on source files in the directory
 * Checks html/ subfolder first, then project root
 *
 * Difference to project.js detectTemplateType(): This function analyzes source files,
 * while detectTemplateType() reads the configured type from docker-compose.yml
 */
function detectProjectType(projectPath) {
    // Determine the correct path for files
    // For new projects: html/, for old ones: projectPath itself
    let scanPath = projectPath;
    const htmlPath = path.join(projectPath, 'html');

    // Check if html/ exists and contains app files
    if (fs.existsSync(htmlPath)) {
        const htmlHasFiles = fs.existsSync(path.join(htmlPath, 'package.json')) ||
                            fs.existsSync(path.join(htmlPath, 'composer.json')) ||
                            fs.existsSync(path.join(htmlPath, 'requirements.txt')) ||
                            fs.existsSync(path.join(htmlPath, 'index.html')) ||
                            fs.existsSync(path.join(htmlPath, 'index.php'));
        if (htmlHasFiles) {
            scanPath = htmlPath;
        }
    }

    const hasIndexHtml = fs.existsSync(path.join(scanPath, 'index.html'));
    const hasIndexPhp = fs.existsSync(path.join(scanPath, 'index.php'));
    const hasPackageJson = fs.existsSync(path.join(scanPath, 'package.json'));
    const hasComposerJson = fs.existsSync(path.join(scanPath, 'composer.json'));
    const hasRequirementsTxt = fs.existsSync(path.join(scanPath, 'requirements.txt'));
    const hasPyprojectToml = fs.existsSync(path.join(scanPath, 'pyproject.toml'));

    // Analyze Node.js projects more precisely
    if (hasPackageJson) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(path.join(scanPath, 'package.json'), 'utf8'));
            const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

            // Detect Next.js
            if (deps['next']) {
                return 'nextjs';
            }
            // Detect Nuxt.js
            if (deps['nuxt'] || deps['nuxt3']) {
                return 'nuxtjs';
            }
            // Detect React/Vue/Svelte/Astro/Vite build projects
            if (deps['react'] || deps['vue'] || deps['svelte'] || deps['astro'] ||
                deps['vite'] || deps['@vitejs/plugin-react'] || deps['@vitejs/plugin-vue'] ||
                deps['@sveltejs/kit']) {
                return 'nodejs-static';
            }
        } catch (e) {
            // Parsing error - Fallback to nodejs
        }
        return 'nodejs';
    }

    // Detect Python projects
    if (hasRequirementsTxt || hasPyprojectToml) {
        try {
            // Check for Django or Flask in requirements.txt
            if (hasRequirementsTxt) {
                const requirements = fs.readFileSync(path.join(scanPath, 'requirements.txt'), 'utf8').toLowerCase();
                if (requirements.includes('django')) {
                    return 'python-django';
                }
                if (requirements.includes('flask') || requirements.includes('fastapi')) {
                    return 'python-flask';
                }
            }
            // Check pyproject.toml for dependencies
            if (hasPyprojectToml) {
                const pyproject = fs.readFileSync(path.join(scanPath, 'pyproject.toml'), 'utf8').toLowerCase();
                if (pyproject.includes('django')) {
                    return 'python-django';
                }
                if (pyproject.includes('flask') || pyproject.includes('fastapi')) {
                    return 'python-flask';
                }
            }
        } catch (e) {
            // Parsing error - Fallback to python-flask
        }
        return 'python-flask';
    }

    // Analyze PHP projects more precisely
    if (hasComposerJson) {
        try {
            const composerJson = JSON.parse(fs.readFileSync(path.join(scanPath, 'composer.json'), 'utf8'));
            const deps = { ...composerJson.require, ...composerJson['require-dev'] };

            // Detect Laravel/Symfony
            if (deps['laravel/framework'] || deps['symfony/framework-bundle']) {
                return 'laravel';
            }
        } catch (e) {
            // Parsing error - Fallback to php
        }
        return 'php';
    }

    if (hasIndexPhp) {
        return 'php';
    }

    if (hasIndexHtml) {
        return 'static';
    }

    // Fallback: static
    return 'static';
}

/**
 * Generates docker-compose.yml based on project type
 * All volumes point to ./html/ since Git repos are cloned there
 */
function generateDockerCompose(projectType, projectName, port) {
    const configs = {
        static: `version: '3.8'

services:
  web:
    image: nginx:alpine
    container_name: \${PROJECT_NAME:-${projectName}}
    restart: unless-stopped
    volumes:
      - ./html:/usr/share/nginx/html:ro
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    networks:
      - dployr-network
    ports:
      - "\${EXPOSED_PORT:-${port}}:80"
    environment:
      - TZ=Europe/Berlin

networks:
  dployr-network:
    external: true`,

        // PHP with common extensions (gd, mbstring, intl for CMS/WordPress)
        php: `version: '3.8'

services:
  web:
    build:
      context: ./html
      dockerfile_inline: |
        FROM php:8.2-apache
        RUN apt-get update && apt-get install -y libpng-dev libonig-dev libicu-dev libpq-dev libzip-dev
        RUN docker-php-ext-install pdo pdo_mysql pdo_pgsql gd mbstring intl zip opcache
        RUN a2enmod rewrite
    container_name: \${PROJECT_NAME:-${projectName}}
    restart: unless-stopped
    volumes:
      - ./html:/var/www/html
    networks:
      - dployr-network
    ports:
      - "\${EXPOSED_PORT:-${port}}:80"
    environment:
      - TZ=Europe/Berlin

networks:
  dployr-network:
    external: true`,

        nodejs: `version: '3.8'

services:
  app:
    image: node:20-alpine
    container_name: \${PROJECT_NAME:-${projectName}}
    restart: unless-stopped
    working_dir: /app
    volumes:
      - ./html:/app
    networks:
      - dployr-network
    ports:
      - "\${EXPOSED_PORT:-${port}}:3000"
    environment:
      - TZ=Europe/Berlin
      - NODE_ENV=production
    command: sh -c "npm install && npm start"

networks:
  dployr-network:
    external: true`,

        // Laravel/Symfony with Composer
        laravel: `version: '3.8'

services:
  web:
    build:
      context: ./html
      dockerfile_inline: |
        FROM php:8.2-apache
        RUN apt-get update && apt-get install -y git unzip libzip-dev libpng-dev libonig-dev libxml2-dev libpq-dev libicu-dev
        RUN docker-php-ext-install pdo pdo_mysql pdo_pgsql mbstring zip gd xml intl opcache bcmath
        RUN a2enmod rewrite
        COPY --from=composer:latest /usr/bin/composer /usr/bin/composer
        ENV APACHE_DOCUMENT_ROOT /var/www/html/public
        RUN sed -ri -e 's!/var/www/html!\$\{APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf
        RUN sed -ri -e 's!/var/www/!\$\{APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf
    container_name: \${PROJECT_NAME:-${projectName}}
    restart: unless-stopped
    working_dir: /var/www/html
    volumes:
      - ./html:/var/www/html
    networks:
      - dployr-network
    ports:
      - "\${EXPOSED_PORT:-${port}}:80"
    environment:
      - TZ=Europe/Berlin
      - APP_ENV=production
    command: sh -c "composer install --no-dev --optimize-autoloader && php artisan migrate --force 2>/dev/null || true && apache2-foreground"

networks:
  dployr-network:
    external: true`,

        // React/Vue/Svelte/Astro/Vite - Build to static files
        'nodejs-static': `version: '3.8'

services:
  web:
    build:
      context: ./html
      dockerfile_inline: |
        FROM node:20-alpine AS builder
        WORKDIR /app
        COPY package*.json ./
        RUN npm install
        COPY . .
        RUN npm run build

        FROM nginx:alpine
        # Support multiple output folders: dist (Vite), build (CRA), out (Next export), .output/public (Nuxt generate)
        COPY --from=builder /app/dist /usr/share/nginx/html 2>/dev/null || true
        COPY --from=builder /app/build /usr/share/nginx/html 2>/dev/null || true
        COPY --from=builder /app/out /usr/share/nginx/html 2>/dev/null || true
        COPY --from=builder /app/.output/public /usr/share/nginx/html 2>/dev/null || true
    container_name: \${PROJECT_NAME:-${projectName}}
    restart: unless-stopped
    networks:
      - dployr-network
    ports:
      - "\${EXPOSED_PORT:-${port}}:80"
    environment:
      - TZ=Europe/Berlin

networks:
  dployr-network:
    external: true`,

        // Next.js SSR
        nextjs: `version: '3.8'

services:
  app:
    build:
      context: ./html
      dockerfile_inline: |
        FROM node:20-alpine
        WORKDIR /app
        COPY package*.json ./
        RUN npm install
        COPY . .
        RUN npm run build
        EXPOSE 3000
        CMD ["npm", "start"]
    container_name: \${PROJECT_NAME:-${projectName}}
    restart: unless-stopped
    networks:
      - dployr-network
    ports:
      - "\${EXPOSED_PORT:-${port}}:3000"
    environment:
      - TZ=Europe/Berlin
      - NODE_ENV=production

networks:
  dployr-network:
    external: true`,

        // Nuxt.js SSR
        nuxtjs: `version: '3.8'

services:
  app:
    build:
      context: ./html
      dockerfile_inline: |
        FROM node:20-alpine
        WORKDIR /app
        COPY package*.json ./
        RUN npm install
        COPY . .
        RUN npm run build
        EXPOSE 3000
        CMD ["node", ".output/server/index.mjs"]
    container_name: \${PROJECT_NAME:-${projectName}}
    restart: unless-stopped
    networks:
      - dployr-network
    ports:
      - "\${EXPOSED_PORT:-${port}}:3000"
    environment:
      - TZ=Europe/Berlin
      - NODE_ENV=production

networks:
  dployr-network:
    external: true`,

        // Python Flask/FastAPI with Gunicorn
        'python-flask': `version: '3.8'

services:
  app:
    build:
      context: ./html
      dockerfile_inline: |
        FROM python:3.12-slim
        WORKDIR /app
        RUN apt-get update && apt-get install -y libpq-dev gcc && rm -rf /var/lib/apt/lists/*
        COPY requirements.txt ./
        RUN pip install --no-cache-dir -r requirements.txt gunicorn
        COPY . .
        EXPOSE 8000
        CMD ["gunicorn", "--bind", "0.0.0.0:8000", "app:app"]
    container_name: \${PROJECT_NAME:-${projectName}}
    restart: unless-stopped
    networks:
      - dployr-network
    ports:
      - "\${EXPOSED_PORT:-${port}}:8000"
    environment:
      - TZ=Europe/Berlin
      - FLASK_ENV=production
      - PYTHONUNBUFFERED=1

networks:
  dployr-network:
    external: true`,

        // Python Django with Gunicorn
        'python-django': `version: '3.8'

services:
  app:
    build:
      context: ./html
      dockerfile_inline: |
        FROM python:3.12-slim
        WORKDIR /app
        RUN apt-get update && apt-get install -y libpq-dev gcc && rm -rf /var/lib/apt/lists/*
        COPY requirements.txt ./
        RUN pip install --no-cache-dir -r requirements.txt gunicorn
        COPY . .
        RUN python manage.py collectstatic --noinput 2>/dev/null || true
        EXPOSE 8000
        CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn --bind 0.0.0.0:8000 config.wsgi:application"]
    container_name: \${PROJECT_NAME:-${projectName}}
    restart: unless-stopped
    networks:
      - dployr-network
    ports:
      - "\${EXPOSED_PORT:-${port}}:8000"
    environment:
      - TZ=Europe/Berlin
      - DJANGO_SETTINGS_MODULE=config.settings
      - PYTHONUNBUFFERED=1

networks:
  dployr-network:
    external: true`
    };

    return configs[projectType] || configs.static;
}

/**
 * Creates a new project directly from a Git repository
 * Repository is cloned into html/ subfolder for consistent structure
 */
async function createProjectFromGit(systemUsername, projectName, repoUrl, token, port) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);
    const htmlPath = path.join(projectPath, 'html');

    // Check if project already exists
    if (fs.existsSync(projectPath)) {
        throw new Error('A project with this name already exists');
    }

    // Create user directory
    const userPath = path.join(USERS_PATH, systemUsername);
    fs.mkdirSync(userPath, { recursive: true });

    // Create project directory
    fs.mkdirSync(projectPath, { recursive: true });

    const authenticatedUrl = createAuthenticatedUrl(repoUrl, token);

    try {
        // Clone with simple-git (secure)
        const git = simpleGit({ timeout: { block: 120000 } });
        await git.clone(authenticatedUrl, htmlPath);

        // Detect project type (from project folder - detectProjectType checks html/ internally)
        const projectType = detectProjectType(projectPath);
        logger.info('Project type detected', { projectType });

        // Generate docker-compose.yml (in project root)
        const dockerCompose = generateDockerCompose(projectType, `${systemUsername}-${projectName}`, port);
        fs.writeFileSync(path.join(projectPath, 'docker-compose.yml'), dockerCompose);

        // Generate .env (in project root - only Docker variables)
        const envContent = `PROJECT_NAME=${systemUsername}-${projectName}\nEXPOSED_PORT=${port}\n`;
        fs.writeFileSync(path.join(projectPath, '.env'), envContent);

        // nginx config for static websites
        if (projectType === 'static') {
            const nginxDir = path.join(projectPath, 'nginx');
            fs.mkdirSync(nginxDir, { recursive: true });
            fs.writeFileSync(path.join(nginxDir, 'default.conf'), generateNginxConfig());
        }

        // Save credentials if token present (in html/ folder)
        if (token) {
            const credentialsPath = path.join(htmlPath, '.git-credentials');
            const url = new URL(repoUrl);
            const credentialLine = `https://${token}@${url.host}${url.pathname}`;
            fs.writeFileSync(credentialsPath, credentialLine + '\n', { mode: 0o600 });

            // Git config with simple-git
            const htmlGit = simpleGit(htmlPath);
            await htmlGit.addConfig('credential.helper', 'store --file=.git-credentials');
        }

        // Remove blocked Docker files from user repository (security)
        // Only from htmlPath - projectPath contains our system-generated docker-compose.yml
        const removedFiles = removeBlockedFiles(htmlPath);
        if (removedFiles.length > 0) {
            logger.info('Removed blocked files after Git clone', { files: removedFiles });
        }

        return {
            success: true,
            projectType,
            path: projectPath,
            port
        };
    } catch (err) {
        // Cleanup on error
        try {
            fs.rmSync(projectPath, { recursive: true, force: true });
        } catch {}

        const cleanError = (err.message || '').replace(/https:\/\/[^@]+@/g, 'https://***@');
        throw new Error(`Git clone failed: ${cleanError}`);
    }
}

module.exports = {
    isGitRepository,
    getGitStatus,
    getGitPath,
    cloneRepository,
    pullChanges,
    disconnectRepository,
    isValidGitUrl,
    getProjectPath,
    createProjectFromGit,
    detectProjectType,
    generateDockerCompose,
    generateNginxConfig
};
