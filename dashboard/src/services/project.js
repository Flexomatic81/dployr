const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const dockerService = require('./docker');
const { generateDockerCompose, generateNginxConfig } = require('./git');

const USERS_PATH = process.env.USERS_PATH || '/app/users';
const SCRIPTS_PATH = process.env.SCRIPTS_PATH || '/app/scripts';
const TEMPLATES_PATH = process.env.TEMPLATES_PATH || '/app/templates';

// Alle Projekte eines Users abrufen
async function getUserProjects(systemUsername) {
    const userPath = path.join(USERS_PATH, systemUsername);

    try {
        const entries = await fs.readdir(userPath, { withFileTypes: true });
        const projects = [];

        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                const projectPath = path.join(userPath, entry.name);
                const project = await getProjectInfo(systemUsername, entry.name);
                if (project) {
                    projects.push(project);
                }
            }
        }

        return projects;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return []; // User-Verzeichnis existiert noch nicht
        }
        throw error;
    }
}

// Projekt-Details abrufen
async function getProjectInfo(systemUsername, projectName) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    try {
        // .env Datei lesen
        const envPath = path.join(projectPath, '.env');
        let envData = {};

        try {
            const envContent = await fs.readFile(envPath, 'utf8');
            envData = parseEnvFile(envContent);
        } catch (e) {
            // .env existiert nicht
        }

        // Template-Typ ermitteln
        const templateType = await detectTemplateType(projectPath);

        // Container-Status abrufen
        const containerName = envData.PROJECT_NAME || `${systemUsername}-${projectName}`;
        const containers = await dockerService.getProjectContainers(containerName);

        const runningContainers = containers.filter(c => c.State === 'running').length;
        const totalContainers = containers.length;

        return {
            name: projectName,
            path: projectPath,
            port: envData.EXPOSED_PORT || 'N/A',
            templateType,
            containerName,
            status: runningContainers > 0 ? 'running' : 'stopped',
            runningContainers,
            totalContainers,
            containers,
            hasDatabase: !!envData.DB_DATABASE,
            database: envData.DB_DATABASE || null
        };
    } catch (error) {
        console.error(`Fehler beim Laden von Projekt ${projectName}:`, error);
        return null;
    }
}

// Template-Typ erkennen
async function detectTemplateType(projectPath) {
    try {
        const composePath = path.join(projectPath, 'docker-compose.yml');
        const content = await fs.readFile(composePath, 'utf8');

        // Neue erweiterte Typen erkennen
        if (content.includes('composer install') || content.includes('APACHE_DOCUMENT_ROOT')) {
            return 'laravel';
        } else if (content.includes('next') || (content.includes('npm run build') && content.includes('npm start') && content.includes('3000'))) {
            return 'nextjs';
        } else if (content.includes('npm run build') && content.includes('FROM nginx:alpine')) {
            return 'nodejs-static';
        } else if (content.includes('php-fpm') || content.includes('php:')) {
            return 'php-website';
        } else if (content.includes('node:') || content.includes('npm')) {
            return 'nodejs-app';
        } else {
            return 'static-website';
        }
    } catch (error) {
        return 'unknown';
    }
}

// .env Datei parsen
function parseEnvFile(content) {
    const result = {};
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            if (key) {
                result[key.trim()] = valueParts.join('=').trim();
            }
        }
    }

    return result;
}

// Verfügbare Templates abrufen
async function getAvailableTemplates() {
    try {
        const entries = await fs.readdir(TEMPLATES_PATH, { withFileTypes: true });
        return entries
            .filter(entry => entry.isDirectory())
            .map(entry => ({
                name: entry.name,
                displayName: getTemplateDisplayName(entry.name)
            }));
    } catch (error) {
        console.error('Fehler beim Laden der Templates:', error);
        return [
            { name: 'static-website', displayName: 'Statische Website (HTML/CSS/JS)' },
            { name: 'php-website', displayName: 'PHP Website' },
            { name: 'nodejs-app', displayName: 'Node.js Anwendung' }
        ];
    }
}

function getTemplateDisplayName(name) {
    const names = {
        'static-website': 'Statische Website (HTML/CSS/JS)',
        'php-website': 'PHP Website',
        'nodejs-app': 'Node.js Anwendung'
    };
    return names[name] || name;
}

// Nächsten freien Port finden
async function getNextAvailablePort() {
    const usedPorts = new Set();

    try {
        const users = await fs.readdir(USERS_PATH, { withFileTypes: true });

        for (const user of users) {
            if (user.isDirectory()) {
                const userPath = path.join(USERS_PATH, user.name);
                const projects = await fs.readdir(userPath, { withFileTypes: true });

                for (const project of projects) {
                    if (project.isDirectory() && !project.name.startsWith('.')) {
                        const envPath = path.join(userPath, project.name, '.env');
                        try {
                            const content = await fs.readFile(envPath, 'utf8');
                            const env = parseEnvFile(content);
                            if (env.EXPOSED_PORT) {
                                usedPorts.add(parseInt(env.EXPOSED_PORT));
                            }
                        } catch (e) {
                            // .env nicht vorhanden
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Fehler beim Ermitteln der Ports:', error);
    }

    // Starte bei Port 8001 und finde den nächsten freien
    let port = 8001;
    while (usedPorts.has(port)) {
        port++;
    }

    return port;
}

// Neues Projekt erstellen
async function createProject(systemUsername, projectName, templateType, options = {}) {
    // Validierung
    if (!/^[a-z0-9-]+$/.test(projectName)) {
        throw new Error('Projektname darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten');
    }

    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    // Prüfen ob Projekt bereits existiert
    try {
        await fs.access(projectPath);
        throw new Error('Ein Projekt mit diesem Namen existiert bereits');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    // Port ermitteln
    const port = options.port || await getNextAvailablePort();

    // Template kopieren
    const templatePath = path.join(TEMPLATES_PATH, templateType);
    await copyDirectory(templatePath, projectPath);

    // .env Datei anpassen
    const envPath = path.join(projectPath, '.env');
    let envContent = '';

    try {
        envContent = await fs.readFile(path.join(projectPath, '.env.example'), 'utf8');
    } catch (e) {
        envContent = '';
    }

    envContent = envContent
        .replace(/PROJECT_NAME=.*/, `PROJECT_NAME=${systemUsername}-${projectName}`)
        .replace(/EXPOSED_PORT=.*/, `EXPOSED_PORT=${port}`);

    // Falls kein PROJECT_NAME existiert, hinzufügen
    if (!envContent.includes('PROJECT_NAME=')) {
        envContent = `PROJECT_NAME=${systemUsername}-${projectName}\n` + envContent;
    }
    if (!envContent.includes('EXPOSED_PORT=')) {
        envContent = `EXPOSED_PORT=${port}\n` + envContent;
    }

    await fs.writeFile(envPath, envContent);

    // User-Verzeichnis erstellen falls nicht vorhanden
    const userPath = path.join(USERS_PATH, systemUsername);
    await fs.mkdir(userPath, { recursive: true });

    return {
        name: projectName,
        path: projectPath,
        port,
        templateType
    };
}

// Verzeichnis rekursiv kopieren
async function copyDirectory(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath);
        } else {
            await fs.copyFile(srcPath, destPath);
        }
    }
}

// Projekt löschen
async function deleteProject(systemUsername, projectName, deleteDatabase = false) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    // Prüfen ob Projekt existiert
    try {
        await fs.access(projectPath);
    } catch (error) {
        throw new Error('Projekt nicht gefunden');
    }

    // Container stoppen
    try {
        await dockerService.stopProject(projectPath);
    } catch (error) {
        console.error('Fehler beim Stoppen der Container:', error);
    }

    // Projekt-Verzeichnis löschen
    await fs.rm(projectPath, { recursive: true, force: true });

    return { success: true };
}

// Projekttyp ändern
async function changeProjectType(systemUsername, projectName, newType) {
    const validTypes = ['static', 'php', 'nodejs', 'laravel', 'nodejs-static', 'nextjs'];
    if (!validTypes.includes(newType)) {
        throw new Error(`Ungültiger Projekttyp. Erlaubt: ${validTypes.join(', ')}`);
    }

    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    // Prüfen ob Projekt existiert
    try {
        await fs.access(projectPath);
    } catch (error) {
        throw new Error('Projekt nicht gefunden');
    }

    // Aktuellen Typ ermitteln
    const oldType = await detectTemplateType(projectPath);

    // .env lesen für Port und Projektname
    const envPath = path.join(projectPath, '.env');
    let envData = {};
    try {
        const envContent = await fs.readFile(envPath, 'utf8');
        envData = parseEnvFile(envContent);
    } catch (e) {
        // .env existiert nicht
    }

    const port = parseInt(envData.EXPOSED_PORT) || 8001;
    const containerName = envData.PROJECT_NAME || `${systemUsername}-${projectName}`;

    // Container stoppen
    try {
        await dockerService.stopProject(projectPath);
    } catch (error) {
        console.error('Fehler beim Stoppen:', error);
    }

    // Neue docker-compose.yml generieren
    const newCompose = generateDockerCompose(newType, containerName, port);
    const composePath = path.join(projectPath, 'docker-compose.yml');
    await fs.writeFile(composePath, newCompose);

    // nginx-Config für statische Websites erstellen
    if (newType === 'static') {
        const nginxDir = path.join(projectPath, 'nginx');
        await fs.mkdir(nginxDir, { recursive: true });
        await fs.writeFile(
            path.join(nginxDir, 'default.conf'),
            generateNginxConfig()
        );
    }

    // Container starten
    await dockerService.startProject(projectPath);

    return {
        success: true,
        oldType,
        newType
    };
}

// Ermitteln wo die App-.env Datei liegt (html/ oder Root)
async function getAppEnvPath(systemUsername, projectName) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);
    const htmlPath = path.join(projectPath, 'html');

    // Prüfen ob html/ Ordner existiert (Git/ZIP Projekte)
    try {
        await fs.access(htmlPath);
        return path.join(htmlPath, '.env');
    } catch (e) {
        // Kein html/ Ordner, nutze Projekt-Root
        return path.join(projectPath, '.env');
    }
}

// Umgebungsvariablen aus .env lesen (App-Ebene, nicht Docker-Ebene)
async function readEnvFile(systemUsername, projectName) {
    const envPath = await getAppEnvPath(systemUsername, projectName);

    try {
        const content = await fs.readFile(envPath, 'utf8');
        return content;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return ''; // Leere Datei wenn nicht vorhanden
        }
        throw error;
    }
}

// Umgebungsvariablen in .env schreiben (App-Ebene)
async function writeEnvFile(systemUsername, projectName, content) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    // Prüfen ob Projekt existiert
    try {
        await fs.access(projectPath);
    } catch (error) {
        throw new Error('Projekt nicht gefunden');
    }

    const envPath = await getAppEnvPath(systemUsername, projectName);
    await fs.writeFile(envPath, content, 'utf8');
    return { success: true };
}

// Prüfen ob .env.example existiert (im Projekt-Root oder html/ Unterordner)
async function checkEnvExample(systemUsername, projectName) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);
    const htmlPath = path.join(projectPath, 'html');
    const envExampleNames = ['.env.example', '.env.sample', '.env.dist', '.env.template'];

    // Zuerst im html/ Unterordner suchen (Git/ZIP Projekte)
    for (const name of envExampleNames) {
        const examplePath = path.join(htmlPath, name);
        try {
            await fs.access(examplePath);
            const content = await fs.readFile(examplePath, 'utf8');
            return { exists: true, filename: name, content, inHtml: true };
        } catch (e) {
            // Datei existiert nicht, weiter prüfen
        }
    }

    // Falls nicht gefunden, im Projekt-Root suchen
    for (const name of envExampleNames) {
        const examplePath = path.join(projectPath, name);
        try {
            await fs.access(examplePath);
            const content = await fs.readFile(examplePath, 'utf8');
            return { exists: true, filename: name, content, inHtml: false };
        } catch (e) {
            // Datei existiert nicht, weiter prüfen
        }
    }

    return { exists: false, filename: null, content: null, inHtml: false };
}

// .env.example zu .env kopieren (im gleichen Ordner wie .env.example)
async function copyEnvExample(systemUsername, projectName) {
    const example = await checkEnvExample(systemUsername, projectName);
    if (!example.exists) {
        throw new Error('Keine .env.example Datei gefunden');
    }

    // .env Pfad im gleichen Ordner wie .env.example
    const envPath = await getAppEnvPath(systemUsername, projectName);

    // Existierenden .env Inhalt laden (falls vorhanden)
    let existingContent = '';
    try {
        existingContent = await fs.readFile(envPath, 'utf8');
    } catch (e) {
        // .env existiert nicht
    }

    // Example-Inhalt + existierenden Inhalt mergen
    // Existierende Variablen nicht überschreiben
    const existingVars = parseEnvFile(existingContent);
    const exampleLines = example.content.split('\n');
    const resultLines = [];

    for (const line of exampleLines) {
        const trimmed = line.trim();
        // Kommentare und leere Zeilen übernehmen
        if (trimmed.startsWith('#') || trimmed === '') {
            resultLines.push(line);
            continue;
        }
        // Variable parsen
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
        if (match) {
            const varName = match[1];
            // Wenn Variable bereits existiert, bestehenden Wert behalten
            if (existingVars[varName] !== undefined) {
                resultLines.push(`${varName}=${existingVars[varName]}`);
            } else {
                resultLines.push(line);
            }
        } else {
            resultLines.push(line);
        }
    }

    await fs.writeFile(envPath, resultLines.join('\n'), 'utf8');
    return { success: true, filename: example.filename };
}

// Datenbank-Credentials zu .env hinzufügen (App-Ebene)
async function appendDbCredentials(systemUsername, projectName, dbCredentials) {
    const envPath = await getAppEnvPath(systemUsername, projectName);

    let content = '';
    try {
        content = await fs.readFile(envPath, 'utf8');
    } catch (e) {
        // .env existiert nicht
    }

    // Prüfen ob DB-Credentials schon vorhanden
    if (content.includes('# === Dployr Datenbank-Credentials ===')) {
        // Bestehende Credentials ersetzen
        content = content.replace(
            /# === Dployr Datenbank-Credentials ===[\s\S]*?(?=\n\n|\n#(?! ===)|$)/,
            ''
        ).trim();
    }

    // Credentials-Block erstellen
    const credentialsBlock = `

# === Dployr Datenbank-Credentials ===
DB_CONNECTION=${dbCredentials.type === 'postgresql' ? 'pgsql' : 'mysql'}
DB_HOST=${dbCredentials.host}
DB_PORT=${dbCredentials.port}
DB_DATABASE=${dbCredentials.database}
DB_USERNAME=${dbCredentials.username}
DB_PASSWORD=${dbCredentials.password}
`;

    await fs.writeFile(envPath, content + credentialsBlock, 'utf8');
    return { success: true };
}

// Datenbank-Credentials für einen User laden
async function getUserDbCredentials(systemUsername) {
    const credentialsPath = path.join(USERS_PATH, systemUsername, '.db-credentials');
    const credentials = [];

    try {
        const content = await fs.readFile(credentialsPath, 'utf8');
        const blocks = content.split(/\n(?=# Database:)/);

        for (const block of blocks) {
            if (!block.trim()) continue;

            const lines = block.split('\n');
            const headerMatch = lines[0].match(/# Database: (\S+)/);
            if (!headerMatch) continue;

            const dbName = headerMatch[1];
            const vars = {};

            for (const line of lines) {
                const match = line.match(/^([A-Z_]+)=(.*)$/);
                if (match) {
                    vars[match[1]] = match[2];
                }
            }

            if (vars.DB_DATABASE) {
                credentials.push({
                    name: dbName,
                    type: vars.DB_TYPE || 'mariadb',
                    host: vars.DB_HOST,
                    port: vars.DB_PORT,
                    database: vars.DB_DATABASE,
                    username: vars.DB_USERNAME,
                    password: vars.DB_PASSWORD
                });
            }
        }
    } catch (e) {
        // Keine Credentials-Datei
    }

    return credentials;
}

module.exports = {
    getUserProjects,
    getProjectInfo,
    getAvailableTemplates,
    getNextAvailablePort,
    createProject,
    deleteProject,
    changeProjectType,
    parseEnvFile,
    readEnvFile,
    writeEnvFile,
    checkEnvExample,
    copyEnvExample,
    appendDbCredentials,
    getUserDbCredentials
};
