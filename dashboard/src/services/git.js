const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const { generateNginxConfig } = require('./utils/nginx');
const { logger } = require('../config/logger');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

/**
 * Prüft ob ein Projekt ein Git-Repository ist
 * Git-Repos werden im html/ Unterordner geklont
 */
function isGitRepository(projectPath) {
    // Zuerst im html/ Unterordner prüfen (neue Struktur)
    const gitDirHtml = path.join(projectPath, 'html', '.git');
    if (fs.existsSync(gitDirHtml)) {
        return true;
    }
    // Fallback: Direkt im Projektordner (alte Struktur, für Kompatibilität)
    const gitDir = path.join(projectPath, '.git');
    return fs.existsSync(gitDir);
}

/**
 * Gibt den Pfad zum Git-Verzeichnis zurück (html/ oder root)
 */
function getGitPath(projectPath) {
    const htmlPath = path.join(projectPath, 'html');
    if (fs.existsSync(path.join(htmlPath, '.git'))) {
        return htmlPath;
    }
    // Fallback für alte Projekte
    if (fs.existsSync(path.join(projectPath, '.git'))) {
        return projectPath;
    }
    return htmlPath; // Default für neue Projekte
}

/**
 * Holt Git-Status-Informationen für ein Projekt
 */
async function getGitStatus(projectPath) {
    if (!isGitRepository(projectPath)) {
        return null;
    }

    const gitPath = getGitPath(projectPath);

    try {
        const git = simpleGit(gitPath);

        // Remote URL abrufen
        const remotes = await git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        const remoteUrl = origin?.refs?.fetch || '';

        // Aktueller Branch
        const branchSummary = await git.branch();
        const branch = branchSummary.current;

        // Letzter Commit
        const logResult = await git.log({ maxCount: 1 });
        const lastCommitData = logResult.latest;
        const lastCommit = lastCommitData
            ? `${lastCommitData.hash.substring(0, 7)} - ${lastCommitData.message} (${formatRelativeTime(lastCommitData.date)})`
            : '';

        // Prüfen ob lokale Änderungen existieren
        const status = await git.status();
        const hasLocalChanges = !status.isClean();

        // URL für Anzeige bereinigen (Token entfernen)
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
            error: 'Fehler beim Abrufen des Git-Status'
        };
    }
}

/**
 * Formatiert ein Datum relativ (z.B. "vor 2 Stunden")
 */
function formatRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `vor ${diffDay} Tag${diffDay > 1 ? 'en' : ''}`;
    if (diffHour > 0) return `vor ${diffHour} Stunde${diffHour > 1 ? 'n' : ''}`;
    if (diffMin > 0) return `vor ${diffMin} Minute${diffMin > 1 ? 'n' : ''}`;
    return 'gerade eben';
}

/**
 * Entfernt Credentials aus der URL für die Anzeige
 */
function sanitizeUrlForDisplay(url) {
    // https://token@github.com/user/repo -> https://github.com/user/repo
    return url.replace(/https:\/\/[^@]+@/, 'https://');
}

/**
 * Erstellt eine authentifizierte URL für private Repos
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
 * Klont ein Git-Repository in ein Projekt-Verzeichnis
 * Existierende Dateien werden durch Repository-Dateien ersetzt,
 * aber docker-compose.yml und nginx/ werden beibehalten
 */
async function cloneRepository(projectPath, repoUrl, token = null) {
    // Prüfen ob bereits ein Git-Repository existiert
    if (isGitRepository(projectPath)) {
        throw new Error('Projekt ist bereits mit einem Git-Repository verbunden. Bitte zuerst trennen.');
    }

    const authenticatedUrl = createAuthenticatedUrl(repoUrl, token);
    const tempDir = `${projectPath}_temp_${Date.now()}`;

    try {
        // Clone mit simple-git (sicher, kein Shell-Escaping nötig)
        const git = simpleGit({ timeout: { block: 120000 } });
        await git.clone(authenticatedUrl, tempDir);

        // Wichtige Dateien sichern (docker-compose.yml, nginx, .env)
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

        // Altes Verzeichnis komplett leeren
        const oldFiles = fs.readdirSync(projectPath);
        for (const file of oldFiles) {
            const filePath = path.join(projectPath, file);
            fs.rmSync(filePath, { recursive: true, force: true });
        }

        // Dateien aus temp verschieben (außer Backups)
        const newFiles = fs.readdirSync(tempDir);
        for (const file of newFiles) {
            if (file.startsWith('_backup_')) continue;

            const src = path.join(tempDir, file);
            const dest = path.join(projectPath, file);
            fs.renameSync(src, dest);
        }

        // Gesicherte Dateien wiederherstellen
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

        // Temp-Verzeichnis löschen
        fs.rmSync(tempDir, { recursive: true, force: true });

        // Token in .git-credentials speichern für spätere Pulls
        if (token) {
            await saveCredentials(projectPath, repoUrl, token);
        }

        // Docker-Compose anpassen falls nötig
        adjustDockerCompose(projectPath);

        return {
            success: true,
            message: 'Repository erfolgreich geklont'
        };
    } catch (err) {
        // Aufräumen bei Fehler
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}

        // Token aus Fehlermeldung entfernen
        const cleanError = (err.message || '').replace(/https:\/\/[^@]+@/g, 'https://***@');
        throw new Error(`Git clone fehlgeschlagen: ${cleanError}`);
    }
}

/**
 * Speichert Credentials für ein Repository
 */
async function saveCredentials(projectPath, repoUrl, token) {
    const gitPath = getGitPath(projectPath);
    const credentialsPath = path.join(gitPath, '.git-credentials');
    const url = new URL(repoUrl);
    const credentialLine = `https://${token}@${url.host}${url.pathname}`;

    fs.writeFileSync(credentialsPath, credentialLine + '\n', { mode: 0o600 });

    // Git konfigurieren mit simple-git
    const git = simpleGit(gitPath);
    await git.addConfig('credential.helper', 'store --file=.git-credentials');
}

/**
 * Passt docker-compose.yml an die Repository-Struktur an
 * - Wenn ./html nicht existiert aber index.html im Root liegt,
 *   wird das Volume-Mount von ./html auf . geändert
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

        // Fall 1: Static Website - ./html existiert nicht, aber index.html im Root
        if (!fs.existsSync(htmlDir) && fs.existsSync(indexInRoot)) {
            if (content.includes('./html:/usr/share/nginx/html')) {
                content = content.replace(
                    './html:/usr/share/nginx/html',
                    '.:/usr/share/nginx/html'
                );
                modified = true;
                logger.debug('Docker-Compose angepasst: ./html -> . (index.html im Root gefunden)');
            }
        }

        // Fall 2: Node.js App - ./src existiert nicht, aber package.json im Root
        const packageJson = path.join(projectPath, 'package.json');
        if (!fs.existsSync(srcDir) && fs.existsSync(packageJson)) {
            if (content.includes('./src:/app/src')) {
                content = content.replace('./src:/app/src', '.:/app');
                modified = true;
                logger.debug('Docker-Compose angepasst: ./src -> . (package.json im Root gefunden)');
            }
        }

        // Fall 3: PHP Website - ./public existiert nicht, aber index.php im Root
        const publicDir = path.join(projectPath, 'public');
        const indexPhp = path.join(projectPath, 'index.php');
        if (!fs.existsSync(publicDir) && fs.existsSync(indexPhp)) {
            if (content.includes('./public:/var/www/html')) {
                content = content.replace('./public:/var/www/html', '.:/var/www/html');
                modified = true;
                logger.debug('Docker-Compose angepasst: ./public -> . (index.php im Root gefunden)');
            }
        }

        if (modified) {
            fs.writeFileSync(composePath, content);
        }
    } catch (error) {
        logger.error('Fehler beim Anpassen der docker-compose.yml', { error: error.message });
    }
}

/**
 * Pullt die neuesten Änderungen vom Remote
 */
async function pullChanges(projectPath) {
    if (!isGitRepository(projectPath)) {
        throw new Error('Kein Git-Repository');
    }

    const gitPath = getGitPath(projectPath);

    try {
        const git = simpleGit(gitPath);
        const result = await git.pull();

        // Prüfen ob Änderungen gepullt wurden
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
        throw new Error(`Git pull fehlgeschlagen: ${cleanError}`);
    }
}

/**
 * Entfernt die Git-Verbindung von einem Projekt
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

    return { success: true, message: 'Git-Verbindung entfernt' };
}

/**
 * Validiert eine Git-Repository-URL
 */
function isValidGitUrl(url) {
    // Unterstützt: https://github.com/user/repo.git oder https://github.com/user/repo
    const httpsPattern = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+(\.git)?$/;
    return httpsPattern.test(url);
}

/**
 * Holt den Projekt-Pfad für einen User
 */
function getProjectPath(systemUsername, projectName) {
    return path.join(USERS_PATH, systemUsername, projectName);
}

/**
 * Erkennt den Projekttyp anhand der Quelldateien im Verzeichnis
 * Prüft zuerst html/ Unterordner, dann das Projekt-Root
 *
 * Unterschied zu project.js detectTemplateType(): Diese Funktion analysiert die Quelldateien,
 * während detectTemplateType() den konfigurierten Typ aus docker-compose.yml liest
 */
function detectProjectType(projectPath) {
    // Ermittle den korrekten Pfad für die Dateien
    // Bei neuen Projekten: html/, bei alten: projectPath selbst
    let scanPath = projectPath;
    const htmlPath = path.join(projectPath, 'html');

    // Prüfe ob html/ existiert und App-Dateien enthält
    if (fs.existsSync(htmlPath)) {
        const htmlHasFiles = fs.existsSync(path.join(htmlPath, 'package.json')) ||
                            fs.existsSync(path.join(htmlPath, 'composer.json')) ||
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

    // Node.js Projekte genauer analysieren
    if (hasPackageJson) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(path.join(scanPath, 'package.json'), 'utf8'));
            const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

            // Next.js erkennen
            if (deps['next']) {
                return 'nextjs';
            }
            // React/Vue/Vite Build-Projekte erkennen
            if (deps['react'] || deps['vue'] || deps['vite'] || deps['@vitejs/plugin-react'] || deps['@vitejs/plugin-vue']) {
                return 'nodejs-static';
            }
        } catch (e) {
            // Fehler beim Parsen - Fallback zu nodejs
        }
        return 'nodejs';
    }

    // PHP Projekte genauer analysieren
    if (hasComposerJson) {
        try {
            const composerJson = JSON.parse(fs.readFileSync(path.join(scanPath, 'composer.json'), 'utf8'));
            const deps = { ...composerJson.require, ...composerJson['require-dev'] };

            // Laravel/Symfony erkennen
            if (deps['laravel/framework'] || deps['symfony/framework-bundle']) {
                return 'laravel';
            }
        } catch (e) {
            // Fehler beim Parsen - Fallback zu php
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
 * Generiert docker-compose.yml basierend auf Projekttyp
 * Alle Volumes zeigen auf ./html/ da Git-Repos dort geklont werden
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

        php: `version: '3.8'

services:
  web:
    build:
      context: ./html
      dockerfile_inline: |
        FROM php:8.2-apache
        RUN docker-php-ext-install pdo pdo_mysql pdo_pgsql
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

        // Laravel/Symfony mit Composer
        laravel: `version: '3.8'

services:
  web:
    build:
      context: ./html
      dockerfile_inline: |
        FROM php:8.2-apache
        RUN apt-get update && apt-get install -y git unzip libzip-dev libpng-dev libonig-dev libxml2-dev libpq-dev
        RUN docker-php-ext-install pdo pdo_mysql pdo_pgsql mbstring zip gd xml
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
    command: sh -c "composer install --no-dev --optimize-autoloader && apache2-foreground"

networks:
  dployr-network:
    external: true`,

        // React/Vue/Vite - Build zu statischen Dateien
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
        COPY --from=builder /app/dist /usr/share/nginx/html
        COPY --from=builder /app/build /usr/share/nginx/html 2>/dev/null || true
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
      - DB_TYPE=\${DB_TYPE:-mariadb}
      - DB_HOST=\${DB_HOST:-dployr-mariadb}
      - DB_PORT=\${DB_PORT:-3306}
      - DB_DATABASE=\${DB_DATABASE}
      - DB_USERNAME=\${DB_USERNAME}
      - DB_PASSWORD=\${DB_PASSWORD}

networks:
  dployr-network:
    external: true`
    };

    return configs[projectType] || configs.static;
}

/**
 * Erstellt ein neues Projekt direkt von einem Git-Repository
 * Repository wird in html/ Unterordner geklont für konsistente Struktur
 */
async function createProjectFromGit(systemUsername, projectName, repoUrl, token, port) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);
    const htmlPath = path.join(projectPath, 'html');

    // Prüfen ob Projekt bereits existiert
    if (fs.existsSync(projectPath)) {
        throw new Error('Ein Projekt mit diesem Namen existiert bereits');
    }

    // User-Verzeichnis erstellen
    const userPath = path.join(USERS_PATH, systemUsername);
    fs.mkdirSync(userPath, { recursive: true });

    // Projektverzeichnis erstellen
    fs.mkdirSync(projectPath, { recursive: true });

    const authenticatedUrl = createAuthenticatedUrl(repoUrl, token);

    try {
        // Clone mit simple-git (sicher)
        const git = simpleGit({ timeout: { block: 120000 } });
        await git.clone(authenticatedUrl, htmlPath);

        // Projekttyp erkennen (aus html/ Ordner)
        const projectType = detectProjectType(htmlPath);
        logger.info('Projekttyp erkannt', { projectType });

        // docker-compose.yml generieren (im Projektroot)
        const dockerCompose = generateDockerCompose(projectType, `${systemUsername}-${projectName}`, port);
        fs.writeFileSync(path.join(projectPath, 'docker-compose.yml'), dockerCompose);

        // .env generieren (im Projektroot - nur Docker-Variablen)
        const envContent = `PROJECT_NAME=${systemUsername}-${projectName}\nEXPOSED_PORT=${port}\n`;
        fs.writeFileSync(path.join(projectPath, '.env'), envContent);

        // nginx-Config für statische Websites
        if (projectType === 'static') {
            const nginxDir = path.join(projectPath, 'nginx');
            fs.mkdirSync(nginxDir, { recursive: true });
            fs.writeFileSync(path.join(nginxDir, 'default.conf'), generateNginxConfig());
        }

        // Credentials speichern falls Token vorhanden (im html/ Ordner)
        if (token) {
            const credentialsPath = path.join(htmlPath, '.git-credentials');
            const url = new URL(repoUrl);
            const credentialLine = `https://${token}@${url.host}${url.pathname}`;
            fs.writeFileSync(credentialsPath, credentialLine + '\n', { mode: 0o600 });

            // Git config mit simple-git
            const htmlGit = simpleGit(htmlPath);
            await htmlGit.addConfig('credential.helper', 'store --file=.git-credentials');
        }

        return {
            success: true,
            projectType,
            path: projectPath,
            port
        };
    } catch (err) {
        // Aufräumen bei Fehler
        try {
            fs.rmSync(projectPath, { recursive: true, force: true });
        } catch {}

        const cleanError = (err.message || '').replace(/https:\/\/[^@]+@/g, 'https://***@');
        throw new Error(`Git clone fehlgeschlagen: ${cleanError}`);
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
