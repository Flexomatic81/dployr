/**
 * Security utilities for file handling
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../config/logger');
const { BLOCKED_PROJECT_FILES } = require('../../config/constants');

/**
 * Removes blocked Docker files from user-uploaded content
 * This prevents users from deploying custom Docker configurations
 *
 * IMPORTANT: Only removes files from htmlPath (user content), NOT from projectPath
 * because projectPath contains our system-generated docker-compose.yml
 *
 * @param {string} htmlPath - Path to the html subdirectory (user content)
 * @returns {string[]} - List of removed files
 */
function removeBlockedFiles(htmlPath) {
    const removedFiles = [];

    if (!htmlPath || !fs.existsSync(htmlPath)) {
        return removedFiles;
    }

    for (const blockedFile of BLOCKED_PROJECT_FILES) {
        const filePath = path.join(htmlPath, blockedFile);

        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                removedFiles.push(filePath);
                logger.info('Removed blocked Docker file from user content', {
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

    return removedFiles;
}

module.exports = {
    removeBlockedFiles
};
