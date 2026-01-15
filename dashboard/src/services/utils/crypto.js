/**
 * Cryptographic utility functions
 * Central place for secure random generation
 */

const crypto = require('crypto');

/**
 * Generates a secure random password using only alphanumeric characters
 * @param {number} length - Password length (default: 16)
 * @returns {string} Secure password (alphanumeric only, safe for SQL and shell)
 */
function generatePassword(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        password += chars[bytes[i] % chars.length];
    }
    return password;
}

/**
 * Escapes a string for safe use in SQL single-quoted strings
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeSqlString(str) {
    if (typeof str !== 'string') {
        throw new Error('escapeSqlString requires a string argument');
    }
    // Escape single quotes by doubling them, and escape backslashes
    return str.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * Escapes a string for safe use in shell double-quoted strings
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeShellArg(str) {
    if (typeof str !== 'string') {
        throw new Error('escapeShellArg requires a string argument');
    }
    // Escape characters that have special meaning in double-quoted shell strings
    // These are: $ ` \ " ! (history expansion)
    return str.replace(/([\\$`"!])/g, '\\$1');
}

module.exports = {
    generatePassword,
    escapeSqlString,
    escapeShellArg
};
