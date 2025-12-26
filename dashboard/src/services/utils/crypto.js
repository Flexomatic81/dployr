/**
 * Cryptographic utility functions
 * Central place for secure random generation
 */

const crypto = require('crypto');

/**
 * Generates a secure random password
 * @param {number} length - Password length (default: 16)
 * @returns {string} Secure password
 */
function generatePassword(length = 16) {
    return crypto.randomBytes(length).toString('base64').slice(0, length).replace(/[+/=]/g, 'x');
}

module.exports = {
    generatePassword
};
