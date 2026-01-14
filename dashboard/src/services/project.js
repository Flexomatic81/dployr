const fs = require('fs').promises;
const path = require('path');
const dockerService = require('./docker');
const { generateDockerCompose, generateNginxConfig, getGitPath, isGitRepository } = require('./git');
const { logger } = require('../config/logger');
const { DB_VARIABLE_ALIASES } = require('../config/constants');

const USERS_PATH = process.env.USERS_PATH || '/app/users';
const SCRIPTS_PATH = process.env.SCRIPTS_PATH || '/app/scripts';
const TEMPLATES_PATH = process.env.TEMPLATES_PATH || '/app/templates';

// Get all projects for a user
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
            return []; // User directory doesn't exist yet
        }
        throw error;
    }
}

// Get project count for a user (fast, no project details)
async function getUserProjectCount(systemUsername) {
    const userPath = path.join(USERS_PATH, systemUsername);

    try {
        const entries = await fs.readdir(userPath, { withFileTypes: true });
        return entries.filter(entry =>
            entry.isDirectory() && !entry.name.startsWith('.')
        ).length;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return 0;
        }
        throw error;
    }
}

// Get project details
async function getProjectInfo(systemUsername, projectName) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    try {
        // Check if project directory exists
        await fs.access(projectPath);

        // Read .env file
        const envPath = path.join(projectPath, '.env');
        let envData = {};

        try {
            const envContent = await fs.readFile(envPath, 'utf8');
            envData = parseEnvFile(envContent);
        } catch (e) {
            // .env doesn't exist
        }

        // Determine template type
        const templateType = await detectTemplateType(projectPath);

        // Get container status
        const containerName = envData.PROJECT_NAME || `${systemUsername}-${projectName}`;
        const containers = await dockerService.getProjectContainers(containerName);

        const runningContainers = containers.filter(c => c.State === 'running').length;
        const totalContainers = containers.length;

        // For custom projects, get service info from docker compose
        let services = [];
        let customAnalysis = null;
        if (templateType === 'custom') {
            services = await dockerService.getProjectServices(projectPath);
            customAnalysis = await analyzeCustomDockerCompose(projectPath);
        }

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
            services, // Multi-service info for custom projects
            isCustom: templateType === 'custom',
            customAnalysis, // Analyzed info for custom projects (databases, appTechnology, ports)
            hasDatabase: !!envData.DB_DATABASE,
            database: envData.DB_DATABASE || null
        };
    } catch (error) {
        logger.error('Error loading project', { projectName, error: error.message });
        return null;
    }
}

// Detect template type from docker-compose.yml (configured type)
// Difference to git.js detectProjectType(): This function reads the configured type,
// while detectProjectType() detects the type based on source files
async function detectTemplateType(projectPath) {
    try {
        const composePath = path.join(projectPath, 'docker-compose.yml');
        const content = await fs.readFile(composePath, 'utf8');

        // Detect custom user-provided docker-compose (marked with x-dployr extension or label)
        // Use regex for flexible matching (handles various whitespace and quote styles)
        if (content.includes('x-dployr:') ||
            /dployr-custom:\s*["']?true["']?/i.test(content) ||
            /dployr-custom\s*=\s*["']?true["']?/i.test(content)) {
            return 'custom';
        }

        // Detect new extended types
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

// Analyze custom docker-compose.yml to extract service info
// Returns: { services: [...], databases: [...], appTechnology: string|null, ports: [...] }
async function analyzeCustomDockerCompose(projectPath) {
    const result = {
        services: [],
        databases: [],
        appTechnology: null,
        ports: []
    };

    // Known database image patterns
    const databasePatterns = {
        'mysql': { name: 'MySQL', icon: 'bi-database' },
        'mariadb': { name: 'MariaDB', icon: 'bi-database' },
        'postgres': { name: 'PostgreSQL', icon: 'bi-database-fill' },
        'mongo': { name: 'MongoDB', icon: 'bi-database' },
        'redis': { name: 'Redis', icon: 'bi-lightning' },
        'memcached': { name: 'Memcached', icon: 'bi-memory' }
    };

    // Known app technology patterns (for images and Dockerfile FROM)
    const appPatterns = {
        'node': 'Node.js',
        'php': 'PHP',
        'python': 'Python',
        'ruby': 'Ruby',
        'golang': 'Go',
        'go:': 'Go',
        'rust': 'Rust',
        'openjdk': 'Java',
        'eclipse-temurin': 'Java',
        'amazoncorretto': 'Java',
        'dotnet': '.NET',
        'mcr.microsoft.com/dotnet': '.NET',
        'nginx': 'Nginx',
        'apache': 'Apache',
        'httpd': 'Apache',
        'caddy': 'Caddy',
        'composer': 'PHP'
    };

    // Helper to detect technology from image string
    const detectTechFromImage = (image) => {
        const imageLower = image.toLowerCase();
        for (const [pattern, tech] of Object.entries(appPatterns)) {
            if (imageLower.includes(pattern)) {
                return tech;
            }
        }
        return null;
    };

    try {
        const composePath = path.join(projectPath, 'docker-compose.yml');
        const content = await fs.readFile(composePath, 'utf8');

        // Track build contexts for later Dockerfile analysis
        const buildContexts = [];

        // Simple YAML parsing for services section
        const lines = content.split('\n');
        let inServices = false;
        let currentService = null;
        let serviceIndent = 0;
        let inBuild = false;
        let buildIndent = 0;
        let currentBuildContext = null;
        let currentDockerfile = 'Dockerfile';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Detect services section
            if (trimmed === 'services:') {
                inServices = true;
                continue;
            }

            // Exit services section on same-level key
            if (inServices && !line.startsWith(' ') && !line.startsWith('\t') && trimmed && !trimmed.startsWith('#')) {
                inServices = false;
            }

            if (!inServices) continue;

            // Detect service name (indented key with colon, not further indented properties)
            const leadingSpaces = line.length - line.trimStart().length;
            if (leadingSpaces > 0 && leadingSpaces <= 4 && trimmed.endsWith(':') && !trimmed.includes(' ')) {
                // Save previous service's build context if any
                if (currentService && currentBuildContext) {
                    buildContexts.push({
                        service: currentService,
                        context: currentBuildContext,
                        dockerfile: currentDockerfile
                    });
                }
                currentService = trimmed.slice(0, -1);
                serviceIndent = leadingSpaces;
                result.services.push(currentService);
                inBuild = false;
                currentBuildContext = null;
                currentDockerfile = 'Dockerfile';
                continue;
            }

            // Look for image, build, or ports within current service
            if (currentService && leadingSpaces > serviceIndent) {
                // Detect build section
                if (trimmed === 'build:' || trimmed.startsWith('build: ')) {
                    inBuild = true;
                    buildIndent = leadingSpaces;
                    // Short form: build: ./path
                    if (trimmed.startsWith('build: ')) {
                        currentBuildContext = trimmed.replace('build:', '').trim().replace(/["']/g, '');
                        inBuild = false; // No nested properties expected
                    }
                    continue;
                }

                // Parse build section properties
                if (inBuild && leadingSpaces > buildIndent) {
                    const contextMatch = trimmed.match(/^context:\s*["']?([^"'\s]+)/);
                    if (contextMatch) {
                        currentBuildContext = contextMatch[1];
                    }
                    const dockerfileMatch = trimmed.match(/^dockerfile:\s*["']?([^"'\s]+)/);
                    if (dockerfileMatch) {
                        currentDockerfile = dockerfileMatch[1];
                    }
                } else if (inBuild && leadingSpaces <= buildIndent) {
                    inBuild = false;
                }

                // Check for image
                const imageMatch = trimmed.match(/^image:\s*["']?([^"'\s]+)/);
                if (imageMatch) {
                    const image = imageMatch[1].toLowerCase();

                    // Check for database
                    for (const [pattern, dbInfo] of Object.entries(databasePatterns)) {
                        if (image.includes(pattern)) {
                            result.databases.push({
                                service: currentService,
                                type: dbInfo.name,
                                icon: dbInfo.icon,
                                image: imageMatch[1]
                            });
                            break;
                        }
                    }

                    // Check for app technology (if not already set)
                    if (!result.appTechnology) {
                        const tech = detectTechFromImage(image);
                        if (tech) {
                            result.appTechnology = tech;
                        }
                    }
                }

                // Check for ports
                const portsMatch = trimmed.match(/^-\s*["']?(\d+):(\d+)/);
                if (portsMatch) {
                    result.ports.push({
                        host: portsMatch[1],
                        container: portsMatch[2]
                    });
                }
            }
        }

        // Save last service's build context if any
        if (currentService && currentBuildContext) {
            buildContexts.push({
                service: currentService,
                context: currentBuildContext,
                dockerfile: currentDockerfile
            });
        }

        // If no app technology detected yet, analyze Dockerfiles from build contexts
        if (!result.appTechnology && buildContexts.length > 0) {
            for (const build of buildContexts) {
                try {
                    // Resolve build context path relative to project
                    let dockerfilePath;
                    if (build.context.startsWith('./') || build.context.startsWith('../')) {
                        dockerfilePath = path.join(projectPath, build.context, build.dockerfile);
                    } else if (build.context === '.') {
                        dockerfilePath = path.join(projectPath, build.dockerfile);
                    } else {
                        dockerfilePath = path.join(projectPath, build.context, build.dockerfile);
                    }

                    const dockerfileContent = await fs.readFile(dockerfilePath, 'utf8');

                    // Look for FROM statements in Dockerfile
                    const fromMatches = dockerfileContent.match(/^FROM\s+([^\s]+)/gmi);
                    if (fromMatches) {
                        for (const fromLine of fromMatches) {
                            const baseImage = fromLine.replace(/^FROM\s+/i, '').trim();
                            const tech = detectTechFromImage(baseImage);
                            if (tech) {
                                result.appTechnology = tech;
                                break;
                            }
                        }
                    }

                    if (result.appTechnology) break;
                } catch {
                    // Dockerfile not found or not readable, continue
                }
            }
        }

        return result;
    } catch (error) {
        logger.debug('Could not analyze docker-compose.yml', { projectPath, error: error.message });
        return result;
    }
}

// Parse .env file
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

// Get available templates
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
        logger.error('Error loading templates', { error: error.message });
        return [
            { name: 'static-website', displayName: 'Static Website (HTML/CSS/JS)' },
            { name: 'php-website', displayName: 'PHP Website' },
            { name: 'nodejs-app', displayName: 'Node.js Application' }
        ];
    }
}

function getTemplateDisplayName(name) {
    const names = {
        'static-website': 'Static Website (HTML/CSS/JS)',
        'php-website': 'PHP Website',
        'nodejs-app': 'Node.js Application',
        'laravel': 'Laravel (PHP Framework)',
        'nodejs-static': 'Node.js Static (React, Vue, Vite)',
        'nextjs': 'Next.js (SSR)'
    };
    return names[name] || name;
}

// Find next available port
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
                            // .env not present
                        }
                    }
                }
            }
        }
    } catch (error) {
        logger.error('Error determining ports', {
            error: error.message,
            stack: error.stack
        });
        // Continue with empty set - will start from 8001
    }

    // Start at port 8001 and find the next free one
    // Limit to ephemeral port range (max 65535)
    const MAX_PORT = 65535;
    let port = 8001;
    while (usedPorts.has(port)) {
        port++;
        if (port > MAX_PORT) {
            throw new Error('No available ports in valid range (8001-65535)');
        }
    }

    return port;
}

// Create new project
async function createProject(systemUsername, projectName, templateType, options = {}) {
    // Validation
    if (!/^[a-z0-9-]+$/.test(projectName)) {
        throw new Error('Project name may only contain lowercase letters, numbers and hyphens');
    }

    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    // Check if project already exists
    try {
        await fs.access(projectPath);
        throw new Error('A project with this name already exists');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    // Determine port
    const port = options.port || await getNextAvailablePort();

    // Copy template
    const templatePath = path.join(TEMPLATES_PATH, templateType);
    await copyDirectory(templatePath, projectPath);

    // Adjust .env file
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

    // If no PROJECT_NAME exists, add it
    if (!envContent.includes('PROJECT_NAME=')) {
        envContent = `PROJECT_NAME=${systemUsername}-${projectName}\n` + envContent;
    }
    if (!envContent.includes('EXPOSED_PORT=')) {
        envContent = `EXPOSED_PORT=${port}\n` + envContent;
    }

    await fs.writeFile(envPath, envContent);

    // Create user directory if not present
    const userPath = path.join(USERS_PATH, systemUsername);
    await fs.mkdir(userPath, { recursive: true });

    return {
        name: projectName,
        path: projectPath,
        port,
        templateType
    };
}

// Copy directory recursively
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

// Delete project
async function deleteProject(systemUsername, projectName, deleteDatabase = false) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    // Check if project exists
    try {
        await fs.access(projectPath);
    } catch (error) {
        throw new Error('Project not found');
    }

    // Stop containers
    try {
        await dockerService.stopProject(projectPath);
    } catch (error) {
        logger.error('Error stopping containers', { error: error.message });
    }

    // Delete project directory
    await fs.rm(projectPath, { recursive: true, force: true });

    return { success: true };
}

// Change project type
async function changeProjectType(systemUsername, projectName, newType) {
    const validTypes = ['static', 'php', 'nodejs', 'laravel', 'nodejs-static', 'nextjs'];
    if (!validTypes.includes(newType)) {
        throw new Error(`Invalid project type. Allowed: ${validTypes.join(', ')}`);
    }

    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    // Check if project exists
    try {
        await fs.access(projectPath);
    } catch (error) {
        throw new Error('Project not found');
    }

    // Determine current type
    const oldType = await detectTemplateType(projectPath);

    // Read .env for port and project name
    const envPath = path.join(projectPath, '.env');
    let envData = {};
    try {
        const envContent = await fs.readFile(envPath, 'utf8');
        envData = parseEnvFile(envContent);
    } catch (e) {
        // .env doesn't exist
    }

    const port = parseInt(envData.EXPOSED_PORT) || 8001;
    const containerName = envData.PROJECT_NAME || `${systemUsername}-${projectName}`;

    // Stop containers
    try {
        await dockerService.stopProject(projectPath);
    } catch (error) {
        logger.error('Error stopping containers', { error: error.message });
    }

    // Generate new docker-compose.yml
    let newCompose = generateDockerCompose(newType, containerName, port);

    // For old Git projects (Git in root instead of html/): adjust paths
    if (isGitRepository(projectPath)) {
        const gitPath = getGitPath(projectPath);
        if (gitPath === projectPath) {
            // Old project: Git is in root, not in html/
            // Change paths from ./html to .
            newCompose = newCompose
                .replace(/\.\/html:/g, './:')
                .replace(/context: \.\/html/g, 'context: .');
        }
    }

    const composePath = path.join(projectPath, 'docker-compose.yml');
    await fs.writeFile(composePath, newCompose);

    // Create nginx config for static websites
    if (newType === 'static') {
        const nginxDir = path.join(projectPath, 'nginx');
        await fs.mkdir(nginxDir, { recursive: true });
        await fs.writeFile(
            path.join(nginxDir, 'default.conf'),
            generateNginxConfig()
        );
    }

    // Start containers
    await dockerService.startProject(projectPath);

    return {
        success: true,
        oldType,
        newType
    };
}

// Docker system variables that shouldn't be changed by user
const SYSTEM_ENV_VARS = ['PROJECT_NAME', 'EXPOSED_PORT'];

// Determine where the app .env file is located (html/ or Git path or root)
async function getAppEnvPath(systemUsername, projectName) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    // For Git projects: use getGitPath (supports old and new structure)
    if (isGitRepository(projectPath)) {
        const gitPath = getGitPath(projectPath);
        return path.join(gitPath, '.env');
    }

    // For non-Git projects: check html/ folder
    const htmlPath = path.join(projectPath, 'html');
    try {
        await fs.access(htmlPath);
        // html/ exists, check if app files are there
        const htmlFiles = await fs.readdir(htmlPath);
        const hasAppFiles = htmlFiles.some(f =>
            ['package.json', 'composer.json', 'index.php', 'index.html', 'artisan', '.env.example'].includes(f)
        );
        if (hasAppFiles) {
            return path.join(htmlPath, '.env');
        }
    } catch (e) {
        // No html/ folder
    }

    // Fallback: project root
    return path.join(projectPath, '.env');
}

// Read environment variables from .env (without Docker system variables)
async function readEnvFile(systemUsername, projectName) {
    const envPath = await getAppEnvPath(systemUsername, projectName);

    try {
        const content = await fs.readFile(envPath, 'utf8');

        // Filter out system variables for display
        const lines = content.split('\n');
        const filteredLines = lines.filter(line => {
            const trimmed = line.trim();
            // Keep comments and empty lines
            if (trimmed.startsWith('#') || trimmed === '') return true;
            // Exclude system variables
            const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
            if (match && SYSTEM_ENV_VARS.includes(match[1])) return false;
            return true;
        });

        return filteredLines.join('\n').trim();
    } catch (error) {
        if (error.code === 'ENOENT') {
            return ''; // Empty file if not present
        }
        throw error;
    }
}

// Write environment variables to .env (system variables are preserved)
async function writeEnvFile(systemUsername, projectName, content) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);

    // Check if project exists
    try {
        await fs.access(projectPath);
    } catch (error) {
        throw new Error('Project not found');
    }

    const envPath = await getAppEnvPath(systemUsername, projectName);

    // Read existing system variables from current .env
    let systemVarsBlock = '';
    try {
        const existingContent = await fs.readFile(envPath, 'utf8');
        const lines = existingContent.split('\n');
        const systemLines = lines.filter(line => {
            const trimmed = line.trim();
            const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
            return match && SYSTEM_ENV_VARS.includes(match[1]);
        });
        if (systemLines.length > 0) {
            systemVarsBlock = systemLines.join('\n') + '\n\n';
        }
    } catch (e) {
        // .env doesn't exist
    }

    // Merge system variables + user content
    const finalContent = systemVarsBlock + content;
    await fs.writeFile(envPath, finalContent, 'utf8');
    return { success: true };
}

// Check if .env.example exists (in Git path, html/ or project root)
async function checkEnvExample(systemUsername, projectName) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);
    const envExampleNames = ['.env.example', '.env.sample', '.env.dist', '.env.template'];

    // For Git projects: search in Git path (supports old and new structure)
    if (isGitRepository(projectPath)) {
        const gitPath = getGitPath(projectPath);
        for (const name of envExampleNames) {
            const examplePath = path.join(gitPath, name);
            try {
                await fs.access(examplePath);
                const content = await fs.readFile(examplePath, 'utf8');
                return { exists: true, filename: name, content, inGit: true };
            } catch (e) {
                // File doesn't exist, continue checking
            }
        }
    }

    // For non-Git projects: search in html/ subfolder
    const htmlPath = path.join(projectPath, 'html');
    for (const name of envExampleNames) {
        const examplePath = path.join(htmlPath, name);
        try {
            await fs.access(examplePath);
            const content = await fs.readFile(examplePath, 'utf8');
            return { exists: true, filename: name, content, inHtml: true };
        } catch (e) {
            // File doesn't exist, continue checking
        }
    }

    // If not found, search in project root (for template projects)
    for (const name of envExampleNames) {
        const examplePath = path.join(projectPath, name);
        try {
            await fs.access(examplePath);
            const content = await fs.readFile(examplePath, 'utf8');
            return { exists: true, filename: name, content, inHtml: false };
        } catch (e) {
            // File doesn't exist, continue checking
        }
    }

    return { exists: false, filename: null, content: null, inHtml: false };
}

// Copy .env.example to .env (in the same folder as .env.example)
async function copyEnvExample(systemUsername, projectName) {
    const example = await checkEnvExample(systemUsername, projectName);
    if (!example.exists) {
        throw new Error('No .env.example file found');
    }

    // .env path in same folder as .env.example
    const envPath = await getAppEnvPath(systemUsername, projectName);

    // Load existing .env content (if present)
    let existingContent = '';
    try {
        existingContent = await fs.readFile(envPath, 'utf8');
    } catch (e) {
        // .env doesn't exist
    }

    // Merge example content + existing content
    // Don't overwrite existing variables
    const existingVars = parseEnvFile(existingContent);
    const exampleLines = example.content.split('\n');
    const resultLines = [];

    for (const line of exampleLines) {
        const trimmed = line.trim();
        // Keep comments and empty lines
        if (trimmed.startsWith('#') || trimmed === '') {
            resultLines.push(line);
            continue;
        }
        // Parse variable
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
        if (match) {
            const varName = match[1];
            // If variable already exists, keep existing value
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

// Add database credentials to .env (app level) - Legacy function
async function appendDbCredentials(systemUsername, projectName, dbCredentials) {
    const envPath = await getAppEnvPath(systemUsername, projectName);

    let content = '';
    try {
        content = await fs.readFile(envPath, 'utf8');
    } catch (e) {
        // .env doesn't exist
    }

    // Check if DB credentials already present
    if (content.includes('# === Dployr Datenbank-Credentials ===')) {
        // Replace existing credentials
        content = content.replace(
            /# === Dployr Datenbank-Credentials ===[\s\S]*?(?=\n\n|\n#(?! ===)|$)/,
            ''
        ).trim();
    }

    // Create credentials block
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

/**
 * Intelligent insertion of DB credentials into .env
 * - Uses .env.example as template if available
 * - Replaces known DB variable aliases with Dployr values
 * - Appends missing credentials at the end
 *
 * @param {string} systemUsername - System username
 * @param {string} projectName - Project name
 * @param {Object} dbCredentials - Database credentials from Dployr
 * @returns {Object} Result with statistics
 */
async function mergeDbCredentials(systemUsername, projectName, dbCredentials) {
    const envPath = await getAppEnvPath(systemUsername, projectName);

    // Load base content: .env.example if available, otherwise existing .env
    let baseContent = '';
    let usedExample = false;

    const envExample = await checkEnvExample(systemUsername, projectName);
    if (envExample.exists) {
        // Use .env.example as base
        baseContent = envExample.content;
        usedExample = true;

        // But keep existing .env values (except DB)
        try {
            const existingEnv = await fs.readFile(envPath, 'utf8');
            const existingVars = parseEnvFile(existingEnv);

            // Carry over non-DB variables from existing .env
            for (const [key, value] of Object.entries(existingVars)) {
                if (!isDbVariable(key)) {
                    // Replace variable in baseContent if present
                    const regex = new RegExp(`^${key}=.*$`, 'm');
                    if (regex.test(baseContent)) {
                        baseContent = baseContent.replace(regex, `${key}=${value}`);
                    }
                }
            }
        } catch (e) {
            // .env doesn't exist - use only .env.example
        }
    } else {
        // No .env.example - use existing .env
        try {
            baseContent = await fs.readFile(envPath, 'utf8');
        } catch (e) {
            // .env doesn't exist - start empty
            baseContent = '';
        }
    }

    // Credential mapping: which Dployr value belongs to which category
    const credentialMap = {
        host: dbCredentials.host,
        port: String(dbCredentials.port),
        database: dbCredentials.database,
        username: dbCredentials.username,
        password: dbCredentials.password
    };

    // Statistics
    let replacedCount = 0;
    let addedCount = 0;
    const replaced = { host: false, port: false, database: false, username: false, password: false };

    // Process line by line
    const lines = baseContent.split('\n');
    const resultLines = [];

    for (const line of lines) {
        const trimmed = line.trim();

        // Keep comments and empty lines
        if (trimmed === '' || trimmed.startsWith('#')) {
            resultLines.push(line);
            continue;
        }

        // Parse variable
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) {
            resultLines.push(line);
            continue;
        }

        const varName = match[1];
        let wasReplaced = false;

        // Check if variable is a known DB alias
        for (const [credKey, aliases] of Object.entries(DB_VARIABLE_ALIASES)) {
            if (aliases.includes(varName)) {
                // Replace value
                resultLines.push(`${varName}=${credentialMap[credKey]}`);
                replaced[credKey] = true;
                replacedCount++;
                wasReplaced = true;
                break;
            }
        }

        if (!wasReplaced) {
            resultLines.push(line);
        }
    }

    // Append missing credentials
    const missing = [];
    if (!replaced.host) missing.push(`DB_HOST=${dbCredentials.host}`);
    if (!replaced.port) missing.push(`DB_PORT=${dbCredentials.port}`);
    if (!replaced.database) missing.push(`DB_DATABASE=${dbCredentials.database}`);
    if (!replaced.username) missing.push(`DB_USERNAME=${dbCredentials.username}`);
    if (!replaced.password) missing.push(`DB_PASSWORD=${dbCredentials.password}`);

    if (missing.length > 0) {
        addedCount = missing.length;
        resultLines.push('');
        resultLines.push(`# Dployr: ${dbCredentials.database}`);
        missing.forEach(line => resultLines.push(line));
    }

    // Save result
    await fs.writeFile(envPath, resultLines.join('\n'), 'utf8');

    return {
        success: true,
        usedExample,
        exampleFile: envExample.filename,
        replacedCount,
        addedCount
    };
}

/**
 * Checks if a variable is a DB variable (based on known aliases)
 */
function isDbVariable(varName) {
    for (const aliases of Object.values(DB_VARIABLE_ALIASES)) {
        if (aliases.includes(varName)) {
            return true;
        }
    }
    return false;
}

/**
 * Clone an existing project to a new name
 * - Copies all files from the source project
 * - Removes .git folder (clone is independent)
 * - Assigns a new port
 * - Updates docker-compose.yml with new container name
 *
 * @param {string} systemUsername - System username
 * @param {string} sourceProjectName - Name of the project to clone
 * @param {string} newProjectName - Name for the cloned project
 * @returns {Object} Cloned project info
 */
async function cloneProject(systemUsername, sourceProjectName, newProjectName) {
    // Validate new name
    if (!/^[a-z0-9-]+$/.test(newProjectName)) {
        throw new Error('Project name may only contain lowercase letters, numbers and hyphens');
    }

    const sourcePath = path.join(USERS_PATH, systemUsername, sourceProjectName);
    const destPath = path.join(USERS_PATH, systemUsername, newProjectName);

    // Check if source exists
    try {
        await fs.access(sourcePath);
    } catch (error) {
        throw new Error('Source project not found');
    }

    // Check if destination already exists
    try {
        await fs.access(destPath);
        throw new Error('A project with this name already exists');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    // Get new port
    const newPort = await getNextAvailablePort();
    const newContainerName = `${systemUsername}-${newProjectName}`;

    // Copy entire directory
    await copyDirectory(sourcePath, destPath);

    // Remove .git folder if present (in html/ or root)
    const gitPaths = [
        path.join(destPath, 'html', '.git'),
        path.join(destPath, '.git')
    ];
    for (const gitPath of gitPaths) {
        try {
            await fs.rm(gitPath, { recursive: true, force: true });
        } catch (e) {
            // .git doesn't exist, ignore
        }
    }

    // Remove .git-credentials file if present
    const gitCredentialsPath = path.join(destPath, '.git-credentials');
    try {
        await fs.rm(gitCredentialsPath, { force: true });
    } catch (e) {
        // File doesn't exist, ignore
    }

    // Update docker-compose.yml with new container name
    const composePath = path.join(destPath, 'docker-compose.yml');
    try {
        let composeContent = await fs.readFile(composePath, 'utf8');
        // Replace container_name
        composeContent = composeContent.replace(
            /container_name:\s*["']?[a-z0-9-]+["']?/gi,
            `container_name: ${newContainerName}`
        );
        await fs.writeFile(composePath, composeContent, 'utf8');
    } catch (e) {
        logger.error('Error updating docker-compose.yml', { error: e.message });
    }

    // Update .env file (project root - system vars)
    const envPath = path.join(destPath, '.env');
    try {
        let envContent = await fs.readFile(envPath, 'utf8');
        envContent = envContent
            .replace(/PROJECT_NAME=.*/, `PROJECT_NAME=${newContainerName}`)
            .replace(/EXPOSED_PORT=.*/, `EXPOSED_PORT=${newPort}`);
        await fs.writeFile(envPath, envContent, 'utf8');
    } catch (e) {
        // .env doesn't exist, create basic one
        const envContent = `PROJECT_NAME=${newContainerName}\nEXPOSED_PORT=${newPort}\n`;
        await fs.writeFile(envPath, envContent, 'utf8');
    }

    // Detect template type
    const templateType = await detectTemplateType(destPath);

    logger.info('Project cloned successfully', {
        source: sourceProjectName,
        destination: newProjectName,
        user: systemUsername,
        port: newPort
    });

    return {
        name: newProjectName,
        path: destPath,
        port: newPort,
        templateType,
        clonedFrom: sourceProjectName
    };
}

// Load database credentials for a user
async function getUserDbCredentials(systemUsername) {
    const credentialsPath = path.join(USERS_PATH, systemUsername, '.db-credentials');
    const credentials = [];

    try {
        const content = await fs.readFile(credentialsPath, 'utf8');
        // Supports both "# Datenbank:" (current) and "# Database:" (legacy)
        const blocks = content.split(/\n(?=# (?:Datenbank|Database):)/);

        for (const block of blocks) {
            if (!block.trim()) continue;

            const lines = block.split('\n');
            // Supports both "# Datenbank:" and "# Database:"
            const headerMatch = lines[0].match(/# (?:Datenbank|Database):\s*([^\s(]+)/);
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
        // No credentials file
    }

    return credentials;
}

/**
 * Counts total projects across all users efficiently.
 * Only counts directories that look like projects (have .env file).
 * Does not fetch container status to avoid N+1 queries.
 *
 * @returns {number} - Total project count
 */
async function getTotalProjectCount() {
    try {
        const entries = await fs.readdir(USERS_PATH, { withFileTypes: true });
        let totalCount = 0;

        // Process all user directories in parallel
        await Promise.all(
            entries
                .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
                .map(async (userEntry) => {
                    const userPath = path.join(USERS_PATH, userEntry.name);
                    try {
                        const userContents = await fs.readdir(userPath, { withFileTypes: true });

                        for (const projectEntry of userContents) {
                            if (projectEntry.isDirectory() && !projectEntry.name.startsWith('.')) {
                                // Check if it has a .env file (indicator of a valid project)
                                const envPath = path.join(userPath, projectEntry.name, '.env');
                                try {
                                    await fs.access(envPath);
                                    totalCount++;
                                } catch {
                                    // Not a valid project
                                }
                            }
                        }
                    } catch {
                        // User directory not accessible
                    }
                })
        );

        return totalCount;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return 0;
        }
        throw error;
    }
}

/**
 * Detects the linked database for a project by reading its .env file
 * Searches for database-related variables and matches them against user databases
 *
 * @param {string} systemUsername - System username
 * @param {string} projectName - Project name
 * @param {Array} userDatabases - Array of user's databases (from databaseService)
 * @returns {Object|null} - Linked database info or null if none found
 */
async function getLinkedDatabase(systemUsername, projectName, userDatabases) {
    if (!userDatabases || userDatabases.length === 0) {
        return null;
    }

    try {
        const envPath = await getAppEnvPath(systemUsername, projectName);
        const content = await fs.readFile(envPath, 'utf8');
        const envVars = parseEnvFile(content);

        // Look for database name in known aliases
        const dbNameAliases = DB_VARIABLE_ALIASES.database;
        let configuredDbName = null;

        for (const alias of dbNameAliases) {
            if (envVars[alias]) {
                configuredDbName = envVars[alias];
                break;
            }
        }

        if (!configuredDbName) {
            return null;
        }

        // Match against user's databases
        const linkedDb = userDatabases.find(db => db.database === configuredDbName);
        return linkedDb || null;

    } catch (error) {
        // .env file doesn't exist or couldn't be read
        return null;
    }
}

module.exports = {
    getUserProjects,
    getUserProjectCount,
    getProjectInfo,
    getAvailableTemplates,
    getNextAvailablePort,
    createProject,
    cloneProject,
    deleteProject,
    changeProjectType,
    parseEnvFile,
    readEnvFile,
    writeEnvFile,
    checkEnvExample,
    copyEnvExample,
    appendDbCredentials,
    mergeDbCredentials,
    getUserDbCredentials,
    getLinkedDatabase,
    getTotalProjectCount,
    analyzeCustomDockerCompose
};
