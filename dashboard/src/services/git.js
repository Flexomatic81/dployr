const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

/**
 * Prüft ob ein Projekt ein Git-Repository ist
 */
function isGitRepository(projectPath) {
    const gitDir = path.join(projectPath, '.git');
    return fs.existsSync(gitDir);
}

/**
 * Holt Git-Status-Informationen für ein Projekt
 */
function getGitStatus(projectPath) {
    if (!isGitRepository(projectPath)) {
        return null;
    }

    try {
        const remoteUrl = execSync('git config --get remote.origin.url', {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: 5000
        }).trim();

        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: 5000
        }).trim();

        const lastCommit = execSync('git log -1 --format="%h - %s (%ar)"', {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: 5000
        }).trim();

        // Prüfen ob lokale Änderungen existieren
        let hasLocalChanges = false;
        try {
            execSync('git diff --quiet && git diff --cached --quiet', {
                cwd: projectPath,
                timeout: 5000
            });
        } catch {
            hasLocalChanges = true;
        }

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
        console.error('Git status error:', error.message);
        return {
            connected: true,
            error: 'Fehler beim Abrufen des Git-Status'
        };
    }
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

    return new Promise((resolve, reject) => {
        // Clone in temporäres Verzeichnis, dann zusammenführen
        const tempDir = `${projectPath}_temp_${Date.now()}`;

        exec(`git clone "${authenticatedUrl}" "${tempDir}"`, {
            timeout: 120000 // 2 Minuten Timeout
        }, async (error, stdout, stderr) => {
            if (error) {
                // Temporäres Verzeichnis aufräumen bei Fehler
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch {}

                // Token aus Fehlermeldung entfernen
                const cleanError = stderr.replace(/https:\/\/[^@]+@/g, 'https://***@');
                reject(new Error(`Git clone fehlgeschlagen: ${cleanError}`));
                return;
            }

            try {
                // Wichtige Dateien sichern (docker-compose.yml, nginx, .env)
                const backups = {};
                const filesToPreserve = ['docker-compose.yml', 'nginx', '.env'];

                for (const file of filesToPreserve) {
                    const filePath = path.join(projectPath, file);
                    if (fs.existsSync(filePath)) {
                        const tempBackupPath = path.join(tempDir, `_backup_${file}`);
                        if (fs.statSync(filePath).isDirectory()) {
                            // Verzeichnis rekursiv kopieren
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
                    // Backup-Dateien überspringen
                    if (file.startsWith('_backup_')) continue;

                    const src = path.join(tempDir, file);
                    const dest = path.join(projectPath, file);
                    fs.renameSync(src, dest);
                }

                // Gesicherte Dateien wiederherstellen (überschreiben Repository-Dateien)
                for (const [file, backup] of Object.entries(backups)) {
                    const filePath = path.join(projectPath, file);
                    // Erst eventuelle Datei aus Repo löschen
                    if (fs.existsSync(filePath)) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    }
                    // Backup wiederherstellen
                    if (backup.isDir) {
                        fs.cpSync(backup.backupPath, filePath, { recursive: true });
                    } else {
                        fs.copyFileSync(backup.backupPath, filePath);
                    }
                }

                // Temp-Verzeichnis löschen (inkl. Backups)
                fs.rmSync(tempDir, { recursive: true, force: true });

                // Token in .git-credentials speichern für spätere Pulls
                if (token) {
                    saveCredentials(projectPath, repoUrl, token);
                }

                // Docker-Compose anpassen falls nötig
                adjustDockerCompose(projectPath);

                resolve({
                    success: true,
                    message: 'Repository erfolgreich geklont'
                });
            } catch (err) {
                // Aufräumen bei Fehler
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch {}
                reject(new Error(`Fehler beim Verschieben der Dateien: ${err.message}`));
            }
        });
    });
}

/**
 * Speichert Credentials für ein Repository
 */
function saveCredentials(projectPath, repoUrl, token) {
    const credentialsPath = path.join(projectPath, '.git-credentials');
    const url = new URL(repoUrl);
    const credentialLine = `https://${token}@${url.host}${url.pathname}`;

    fs.writeFileSync(credentialsPath, credentialLine + '\n', { mode: 0o600 });

    // Git konfigurieren, diese Credentials zu nutzen
    execSync(`git config credential.helper "store --file=.git-credentials"`, {
        cwd: projectPath
    });
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
                console.log('Docker-Compose angepasst: ./html -> . (index.html im Root gefunden)');
            }
        }

        // Fall 2: Node.js App - ./src existiert nicht, aber package.json im Root
        const packageJson = path.join(projectPath, 'package.json');
        if (!fs.existsSync(srcDir) && fs.existsSync(packageJson)) {
            if (content.includes('./src:/app/src')) {
                content = content.replace('./src:/app/src', '.:/app');
                modified = true;
                console.log('Docker-Compose angepasst: ./src -> . (package.json im Root gefunden)');
            }
        }

        // Fall 3: PHP Website - ./public existiert nicht, aber index.php im Root
        const publicDir = path.join(projectPath, 'public');
        const indexPhp = path.join(projectPath, 'index.php');
        if (!fs.existsSync(publicDir) && fs.existsSync(indexPhp)) {
            if (content.includes('./public:/var/www/html')) {
                content = content.replace('./public:/var/www/html', '.:/var/www/html');
                modified = true;
                console.log('Docker-Compose angepasst: ./public -> . (index.php im Root gefunden)');
            }
        }

        if (modified) {
            fs.writeFileSync(composePath, content);
        }
    } catch (error) {
        console.error('Fehler beim Anpassen der docker-compose.yml:', error.message);
    }
}

/**
 * Pullt die neuesten Änderungen vom Remote
 */
async function pullChanges(projectPath) {
    if (!isGitRepository(projectPath)) {
        throw new Error('Kein Git-Repository');
    }

    return new Promise((resolve, reject) => {
        exec('git pull', {
            cwd: projectPath,
            timeout: 60000 // 1 Minute Timeout
        }, (error, stdout, stderr) => {
            if (error) {
                const cleanError = stderr.replace(/https:\/\/[^@]+@/g, 'https://***@');
                reject(new Error(`Git pull fehlgeschlagen: ${cleanError}`));
                return;
            }

            // Prüfen ob Änderungen gepullt wurden
            const hasChanges = !stdout.includes('Already up to date') &&
                               !stdout.includes('Bereits aktuell');

            resolve({
                success: true,
                hasChanges,
                output: stdout.trim()
            });
        });
    });
}

/**
 * Entfernt die Git-Verbindung von einem Projekt
 */
function disconnectRepository(projectPath) {
    const gitDir = path.join(projectPath, '.git');
    const credentialsFile = path.join(projectPath, '.git-credentials');

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
 * Erkennt den Projekttyp anhand der Dateien im Verzeichnis
 */
function detectProjectType(projectPath) {
    const hasIndexHtml = fs.existsSync(path.join(projectPath, 'index.html'));
    const hasIndexPhp = fs.existsSync(path.join(projectPath, 'index.php'));
    const hasPackageJson = fs.existsSync(path.join(projectPath, 'package.json'));
    const hasComposerJson = fs.existsSync(path.join(projectPath, 'composer.json'));

    // Node.js Projekte genauer analysieren
    if (hasPackageJson) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
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
            const composerJson = JSON.parse(fs.readFileSync(path.join(projectPath, 'composer.json'), 'utf8'));
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
      - .:/usr/share/nginx/html:ro
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
      context: .
      dockerfile_inline: |
        FROM php:8.2-apache
        RUN docker-php-ext-install pdo pdo_mysql pdo_pgsql
    container_name: \${PROJECT_NAME:-${projectName}}
    restart: unless-stopped
    volumes:
      - .:/var/www/html
    networks:
      - dployr-network
    ports:
      - "\${EXPOSED_PORT:-${port}}:80"
    environment:
      - TZ=Europe/Berlin
      - DB_TYPE=\${DB_TYPE:-mariadb}
      - DB_HOST=\${DB_HOST:-dployr-mariadb}
      - DB_PORT=\${DB_PORT:-3306}
      - DB_DATABASE=\${DB_DATABASE}
      - DB_USERNAME=\${DB_USERNAME}
      - DB_PASSWORD=\${DB_PASSWORD}

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
      - .:/app
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
    command: sh -c "npm install && npm start"

networks:
  dployr-network:
    external: true`,

        // Laravel/Symfony mit Composer
        laravel: `version: '3.8'

services:
  web:
    build:
      context: .
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
      - .:/var/www/html
    networks:
      - dployr-network
    ports:
      - "\${EXPOSED_PORT:-${port}}:80"
    environment:
      - TZ=Europe/Berlin
      - APP_ENV=production
      - DB_CONNECTION=\${DB_TYPE:-mysql}
      - DB_HOST=\${DB_HOST:-dployr-mariadb}
      - DB_PORT=\${DB_PORT:-3306}
      - DB_DATABASE=\${DB_DATABASE}
      - DB_USERNAME=\${DB_USERNAME}
      - DB_PASSWORD=\${DB_PASSWORD}
    command: sh -c "composer install --no-dev --optimize-autoloader && apache2-foreground"

networks:
  dployr-network:
    external: true`,

        // React/Vue/Vite - Build zu statischen Dateien
        'nodejs-static': `version: '3.8'

services:
  web:
    build:
      context: .
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
      context: .
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
 * Generiert nginx default.conf für statische Websites
 */
function generateNginxConfig() {
    return `server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html index.htm;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;
}`;
}

/**
 * Erstellt ein neues Projekt direkt von einem Git-Repository
 */
async function createProjectFromGit(systemUsername, projectName, repoUrl, token, port) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    // Prüfen ob Projekt bereits existiert
    if (fs.existsSync(projectPath)) {
        throw new Error('Ein Projekt mit diesem Namen existiert bereits');
    }

    // User-Verzeichnis erstellen
    const userPath = path.join(USERS_PATH, systemUsername);
    fs.mkdirSync(userPath, { recursive: true });

    const authenticatedUrl = createAuthenticatedUrl(repoUrl, token);

    return new Promise((resolve, reject) => {
        // Direkt ins Projektverzeichnis klonen
        exec(`git clone "${authenticatedUrl}" "${projectPath}"`, {
            timeout: 120000
        }, (error, stdout, stderr) => {
            if (error) {
                // Aufräumen bei Fehler
                try {
                    fs.rmSync(projectPath, { recursive: true, force: true });
                } catch {}

                const cleanError = stderr.replace(/https:\/\/[^@]+@/g, 'https://***@');
                reject(new Error(`Git clone fehlgeschlagen: ${cleanError}`));
                return;
            }

            try {
                // Projekttyp erkennen
                const projectType = detectProjectType(projectPath);
                console.log(`Erkannter Projekttyp: ${projectType}`);

                // docker-compose.yml generieren
                const dockerCompose = generateDockerCompose(projectType, `${systemUsername}-${projectName}`, port);
                fs.writeFileSync(path.join(projectPath, 'docker-compose.yml'), dockerCompose);

                // .env generieren
                const envContent = `PROJECT_NAME=${systemUsername}-${projectName}\nEXPOSED_PORT=${port}\n`;
                fs.writeFileSync(path.join(projectPath, '.env'), envContent);

                // nginx-Config für statische Websites
                if (projectType === 'static') {
                    const nginxDir = path.join(projectPath, 'nginx');
                    fs.mkdirSync(nginxDir, { recursive: true });
                    fs.writeFileSync(path.join(nginxDir, 'default.conf'), generateNginxConfig());
                }

                // Credentials speichern falls Token vorhanden
                if (token) {
                    saveCredentials(projectPath, repoUrl, token);
                }

                resolve({
                    success: true,
                    projectType,
                    path: projectPath,
                    port
                });
            } catch (err) {
                // Aufräumen bei Fehler
                try {
                    fs.rmSync(projectPath, { recursive: true, force: true });
                } catch {}
                reject(new Error(`Fehler beim Erstellen des Projekts: ${err.message}`));
            }
        });
    });
}

module.exports = {
    isGitRepository,
    getGitStatus,
    cloneRepository,
    pullChanges,
    disconnectRepository,
    isValidGitUrl,
    getProjectPath,
    createProjectFromGit,
    detectProjectType,
    generateDockerCompose
};
