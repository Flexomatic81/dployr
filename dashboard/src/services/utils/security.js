/**
 * Security utilities for file handling
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../config/logger');
const { BLOCKED_PROJECT_FILES } = require('../../config/constants');

/**
 * Removes blocked Docker files from a project directory
 * This prevents users from deploying custom Docker configurations
 *
 * @param {string} projectPath - Path to the project directory
 * @param {string} htmlPath - Path to the html subdirectory (optional)
 * @returns {string[]} - List of removed files
 */
function removeBlockedFiles(projectPath, htmlPath = null) {
    const removedFiles = [];
    const pathsToCheck = [projectPath];

    if (htmlPath && htmlPath !== projectPath) {
        pathsToCheck.push(htmlPath);
    }

    for (const dirPath of pathsToCheck) {
        if (!fs.existsSync(dirPath)) {
            continue;
        }

        for (const blockedFile of BLOCKED_PROJECT_FILES) {
            const filePath = path.join(dirPath, blockedFile);

            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    removedFiles.push(filePath);
                    logger.info('Removed blocked Docker file', {
                        file: blockedFile,
                        path: filePath
                    });
                } catch (error) {
                    logger.error('Failed to remove blocked file', {
                        file: blockedFile,
                        path: filePath,
                        error: error.message
                    });
                }
            }
        }
    }

    return removedFiles;
}

module.exports = {
    removeBlockedFiles
};
