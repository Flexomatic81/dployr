const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const gitService = require('./git');
const { generateNginxConfig } = require('./utils/nginx');
const { logger } = require('../config/logger');
const composeValidator = require('./compose-validator');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

/**
 * Extracts a ZIP file to a target directory
 */
function extractZip(zipPath, destPath) {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destPath, true);
}

/**
 * Checks if the directory contains only a single subfolder
 * and moves its contents up (e.g., project-main/ -> .)
 */
function flattenIfNeeded(destPath) {
    const entries = fs.readdirSync(destPath);

    // Ignore hidden files like .DS_Store
    const visibleEntries = entries.filter(e => !e.startsWith('.'));

    // Only if exactly one entry exists and it's a directory
    if (visibleEntries.length === 1) {
        const singleEntry = visibleEntries[0];
        const singleEntryPath = path.join(destPath, singleEntry);

        if (fs.statSync(singleEntryPath).isDirectory()) {
            logger.debug('ZIP structure: Moving contents up', { folder: singleEntry });

            // Move all files from the subfolder
            const subEntries = fs.readdirSync(singleEntryPath);
            for (const entry of subEntries) {
                const src = path.join(singleEntryPath, entry);
                const dest = path.join(destPath, entry);
                fs.renameSync(src, dest);
            }

            // Delete empty subfolder
            fs.rmdirSync(singleEntryPath);

            return true;
        }
    }

    return false;
}

/**
 * Creates a new project from a ZIP file
 */
async function createProjectFromZip(systemUsername, projectName, zipPath, port) {
    const projectPath = path.join(USERS_PATH, systemUsername, projectName);
    const htmlPath = path.join(projectPath, 'html');

    // Check if project already exists
    if (fs.existsSync(projectPath)) {
        // Delete ZIP file
        cleanupZip(zipPath);
        throw new Error('A project with this name already exists');
    }

    try {
        // Create user directory
        const userPath = path.join(USERS_PATH, systemUsername);
        fs.mkdirSync(userPath, { recursive: true });

        // Create project and html directories
        fs.mkdirSync(htmlPath, { recursive: true });

        // Extract ZIP to html/ subfolder
        logger.info('Extracting ZIP', { htmlPath });
        extractZip(zipPath, htmlPath);

        // Check if only one subfolder exists and flatten if needed
        flattenIfNeeded(htmlPath);

        // Check if user provided docker-compose.yml
        const userCompose = composeValidator.findComposeFile(htmlPath);
        let projectType;
        let portMappings = [];
        let services = [];

        if (userCompose.exists) {
            // User provided docker-compose.yml - validate and transform it
            logger.info('Found user docker-compose.yml in ZIP', { file: userCompose.filename });

            const composeContent = fs.readFileSync(userCompose.path, 'utf8');
            const containerPrefix = `${systemUsername}-${projectName}`;
            const result = composeValidator.processUserCompose(composeContent, containerPrefix, port, userCompose.subdir);

            if (result.success) {
                // Use transformed user compose
                projectType = 'custom';
                portMappings = result.portMappings;
                services = result.services;

                // Write transformed docker-compose.yml to project root
                fs.writeFileSync(path.join(projectPath, 'docker-compose.yml'), result.yaml);

                logger.info('Using user docker-compose.yml from ZIP', {
                    services: result.services,
                    portMappings: result.portMappings
                });
            } else {
                // Validation failed - log errors and fall back to auto-detection
                logger.warn('User docker-compose.yml validation failed, falling back to auto-detection', {
                    errors: result.errors || result.error
                });

                // Remove invalid compose file
                fs.unlinkSync(userCompose.path);

                // Fall back to auto-detection
                projectType = gitService.detectProjectType(projectPath);
                const dockerCompose = gitService.generateDockerCompose(
                    projectType,
                    `${systemUsername}-${projectName}`,
                    port
                );
                fs.writeFileSync(path.join(projectPath, 'docker-compose.yml'), dockerCompose);
            }
        } else {
            // No user compose - use auto-detection (existing behavior)
            projectType = gitService.detectProjectType(projectPath);
            logger.info('Project type detected', { projectType });

            // Generate docker-compose.yml (uses git.js function)
            const dockerCompose = gitService.generateDockerCompose(
                projectType,
                `${systemUsername}-${projectName}`,
                port
            );
            fs.writeFileSync(path.join(projectPath, 'docker-compose.yml'), dockerCompose);
        }

        // Generate .env
        const envContent = `PROJECT_NAME=${systemUsername}-${projectName}\nEXPOSED_PORT=${port}\n`;
        fs.writeFileSync(path.join(projectPath, '.env'), envContent);

        // nginx config for static websites (only for auto-detected static type)
        if (projectType === 'static') {
            const nginxDir = path.join(projectPath, 'nginx');
            fs.mkdirSync(nginxDir, { recursive: true });
            fs.writeFileSync(
                path.join(nginxDir, 'default.conf'),
                generateNginxConfig()
            );
        }

        // Delete ZIP file
        cleanupZip(zipPath);

        return {
            success: true,
            projectType,
            path: projectPath,
            port,
            services,
            portMappings
        };

    } catch (error) {
        // Cleanup on error
        try {
            fs.rmSync(projectPath, { recursive: true, force: true });
        } catch (cleanupError) {
            logger.warn('Failed to cleanup project directory after error', {
                projectPath,
                cleanupError: cleanupError.message,
                originalError: error.message
            });
        }

        cleanupZip(zipPath);

        throw error;
    }
}

/**
 * Deletes the temporary ZIP file
 */
function cleanupZip(zipPath) {
    try {
        if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
        }
    } catch (error) {
        logger.warn('Error deleting ZIP file', { error: error.message });
    }
}

module.exports = {
    createProjectFromZip,
    extractZip,
    flattenIfNeeded
};
