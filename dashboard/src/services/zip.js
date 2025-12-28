const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const gitService = require('./git');
const { generateNginxConfig } = require('./utils/nginx');
const { removeBlockedFiles } = require('./utils/security');
const { logger } = require('../config/logger');

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

        // Create project directory
        fs.mkdirSync(projectPath, { recursive: true });

        // Extract ZIP
        logger.info('Extracting ZIP', { projectPath });
        extractZip(zipPath, projectPath);

        // Check if only one subfolder exists and flatten if needed
        flattenIfNeeded(projectPath);

        // Detect project type (uses git.js function)
        const projectType = gitService.detectProjectType(projectPath);
        logger.info('Project type detected', { projectType });

        // Generate docker-compose.yml (uses git.js function)
        const dockerCompose = gitService.generateDockerCompose(
            projectType,
            `${systemUsername}-${projectName}`,
            port
        );
        fs.writeFileSync(path.join(projectPath, 'docker-compose.yml'), dockerCompose);

        // Generate .env
        const envContent = `PROJECT_NAME=${systemUsername}-${projectName}\nEXPOSED_PORT=${port}\n`;
        fs.writeFileSync(path.join(projectPath, '.env'), envContent);

        // nginx config for static websites
        if (projectType === 'static') {
            const nginxDir = path.join(projectPath, 'nginx');
            fs.mkdirSync(nginxDir, { recursive: true });
            fs.writeFileSync(
                path.join(nginxDir, 'default.conf'),
                generateNginxConfig()
            );
        }

        // Remove blocked Docker files from user upload (security)
        // Only check html/ subfolder if it exists - projectPath contains our system-generated docker-compose.yml
        // Note: ZIP extracts to projectPath, so user's docker-compose.yml is overwritten by ours above
        const htmlPath = path.join(projectPath, 'html');
        if (fs.existsSync(htmlPath)) {
            const removedFiles = removeBlockedFiles(htmlPath);
            if (removedFiles.length > 0) {
                logger.info('Removed blocked files after ZIP extraction', { files: removedFiles });
            }
        }

        // Delete ZIP file
        cleanupZip(zipPath);

        return {
            success: true,
            projectType,
            path: projectPath,
            port
        };

    } catch (error) {
        // Cleanup on error
        try {
            fs.rmSync(projectPath, { recursive: true, force: true });
        } catch {}

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
