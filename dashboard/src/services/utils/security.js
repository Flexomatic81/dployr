/**
 * Security utilities for file handling
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../config/logger');
const { BLOCKED_PROJECT_FILES } = require('../../config/constants');

/**
 * Validates and sanitizes a redirect URL to prevent Open Redirect attacks.
 * Only allows relative paths starting with / and containing safe characters.
 * @param {string} returnTo - The URL to validate
 * @param {string} fallback - Fallback URL if validation fails
 * @returns {string} Safe redirect URL
 */
function sanitizeReturnUrl(returnTo, fallback) {
    if (!returnTo || typeof returnTo !== 'string') {
        return fallback;
    }

    // Only allow paths starting with / and not containing protocol or double slashes
    // This prevents: //evil.com, http://evil.com, javascript:, etc.
    const isLocalPath = /^\/[a-zA-Z0-9/_-]*$/.test(returnTo);

    if (!isLocalPath) {
        return fallback;
    }

    return returnTo;
}

/**
 * Removes blocked files from user-uploaded content
 *
 * NOTE: As of the custom docker-compose feature, Docker files (Dockerfile,
 * docker-compose.yml) are now ALLOWED. They are validated and transformed
 * by compose-validator.js instead of being blocked.
 *
 * This function now only removes files from BLOCKED_PROJECT_FILES constant,
 * which is empty by default. It remains for potential future use (e.g.,
 * blocking .env files with secrets).
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

/**
 * Maximum length for SQL identifiers (database names, usernames)
 * MySQL limit is 64, PostgreSQL is 63. Using 63 to be safe.
 */
const MAX_SQL_IDENTIFIER_LENGTH = 63;

/**
 * Validates a SQL identifier (database name, username) for safety.
 * Only allows alphanumeric characters and underscores.
 * This is a defense-in-depth measure to prevent SQL injection
 * even if upstream validation is bypassed.
 *
 * @param {string} identifier - The identifier to validate
 * @returns {boolean} - True if the identifier is valid
 */
function isValidSqlIdentifier(identifier) {
    if (!identifier || typeof identifier !== 'string') {
        return false;
    }

    // Check length
    if (identifier.length === 0 || identifier.length > MAX_SQL_IDENTIFIER_LENGTH) {
        return false;
    }

    // Only allow alphanumeric characters and underscores
    // Must start with letter or underscore (not a number)
    const validPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    return validPattern.test(identifier);
}

/**
 * Asserts that a SQL identifier is valid, throws an error if not.
 * Use this before any SQL execution with user-supplied identifiers.
 *
 * @param {string} identifier - The identifier to validate
 * @param {string} context - Context for error message (e.g., 'database name', 'username')
 * @throws {Error} - If the identifier is invalid
 */
function assertValidSqlIdentifier(identifier, context = 'identifier') {
    if (!isValidSqlIdentifier(identifier)) {
        throw new Error(`Invalid ${context}: "${identifier}". Only alphanumeric characters and underscores are allowed, must start with letter or underscore, max ${MAX_SQL_IDENTIFIER_LENGTH} characters.`);
    }
}

module.exports = {
    removeBlockedFiles,
    sanitizeReturnUrl,
    isValidSqlIdentifier,
    assertValidSqlIdentifier,
    MAX_SQL_IDENTIFIER_LENGTH
};
