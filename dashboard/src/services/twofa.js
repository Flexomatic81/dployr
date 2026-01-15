/**
 * Two-Factor Authentication Service
 *
 * Responsible for:
 * - TOTP secret generation and verification
 * - QR code generation for authenticator apps
 * - Backup code generation and verification
 */

const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { logger } = require('../config/logger');

// TOTP configuration
const ISSUER = 'Dployr';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;
const BCRYPT_ROUNDS = 10;

// Configure otplib for better compatibility
authenticator.options = {
    window: 1 // Allow 1 time step before/after (±30 seconds)
};

/**
 * Generates a new TOTP secret
 * @returns {string} Base32-encoded secret
 */
function generateSecret() {
    return authenticator.generateSecret();
}

/**
 * Generates an otpauth URI for authenticator apps
 * @param {string} username - User's username
 * @param {string} secret - TOTP secret
 * @returns {string} otpauth URI
 */
function generateOtpauthUri(username, secret) {
    return authenticator.keyuri(username, ISSUER, secret);
}

/**
 * Generates a QR code as data URL for the otpauth URI
 * @param {string} username - User's username
 * @param {string} secret - TOTP secret
 * @returns {Promise<string>} Data URL of QR code image
 */
async function generateQRCode(username, secret) {
    const otpauthUri = generateOtpauthUri(username, secret);
    try {
        const dataUrl = await QRCode.toDataURL(otpauthUri, {
            width: 256,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });
        return dataUrl;
    } catch (error) {
        logger.error('Failed to generate QR code', { error: error.message, username });
        throw new Error('Failed to generate QR code');
    }
}

/**
 * Verifies a TOTP code against a secret
 * @param {string} code - 6-digit TOTP code
 * @param {string} secret - TOTP secret
 * @returns {boolean} True if code is valid
 */
function verifyCode(code, secret) {
    if (!code || !secret) {
        return false;
    }

    // Normalize code (remove spaces, ensure string)
    const normalizedCode = String(code).replace(/\s/g, '');

    try {
        return authenticator.verify({ token: normalizedCode, secret });
    } catch (error) {
        logger.warn('TOTP verification error', { error: error.message });
        return false;
    }
}

/**
 * Generates random backup codes
 * @returns {string[]} Array of plaintext backup codes
 */
function generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
        // Generate random alphanumeric code (uppercase for readability)
        const code = crypto.randomBytes(BACKUP_CODE_LENGTH)
            .toString('base64')
            .replace(/[^a-zA-Z0-9]/g, '')
            .substring(0, BACKUP_CODE_LENGTH)
            .toUpperCase();
        codes.push(code);
    }
    return codes;
}

/**
 * Hashes backup codes for secure storage
 * @param {string[]} codes - Array of plaintext backup codes
 * @returns {Promise<string[]>} Array of bcrypt hashes
 */
async function hashBackupCodes(codes) {
    const hashedCodes = await Promise.all(
        codes.map(code => bcrypt.hash(code, BCRYPT_ROUNDS))
    );
    return hashedCodes;
}

/**
 * Verifies a backup code against stored hashes
 * @param {string} code - Backup code to verify
 * @param {string[]} hashedCodes - Array of stored hashes
 * @returns {Promise<{valid: boolean, index: number}>} Verification result and index of matching code
 */
async function verifyBackupCode(code, hashedCodes) {
    if (!code || !hashedCodes || !Array.isArray(hashedCodes)) {
        return { valid: false, index: -1 };
    }

    // Normalize code
    const normalizedCode = String(code).replace(/\s/g, '').toUpperCase();

    // Check against all stored hashes
    for (let i = 0; i < hashedCodes.length; i++) {
        if (hashedCodes[i]) {
            try {
                const isMatch = await bcrypt.compare(normalizedCode, hashedCodes[i]);
                if (isMatch) {
                    return { valid: true, index: i };
                }
            } catch (error) {
                logger.warn('Backup code verification error', { error: error.message, index: i });
            }
        }
    }

    return { valid: false, index: -1 };
}

/**
 * Removes a used backup code from the array
 * @param {string[]} hashedCodes - Array of stored hashes
 * @param {number} index - Index of code to remove
 * @returns {string[]} Updated array with null at the used index
 */
function markBackupCodeUsed(hashedCodes, index) {
    if (index >= 0 && index < hashedCodes.length) {
        hashedCodes[index] = null;
    }
    return hashedCodes;
}

/**
 * Counts remaining valid backup codes
 * @param {string[]} hashedCodes - Array of stored hashes
 * @returns {number} Count of non-null codes
 */
function countRemainingBackupCodes(hashedCodes) {
    if (!hashedCodes || !Array.isArray(hashedCodes)) {
        return 0;
    }
    return hashedCodes.filter(code => code !== null).length;
}

/**
 * Formats backup codes for display (groups of 4)
 * @param {string[]} codes - Array of backup codes
 * @returns {string[]} Formatted codes
 */
function formatBackupCodesForDisplay(codes) {
    return codes.map(code => {
        if (code.length === 8) {
            return `${code.substring(0, 4)}-${code.substring(4, 8)}`;
        }
        return code;
    });
}

module.exports = {
    generateSecret,
    generateOtpauthUri,
    generateQRCode,
    verifyCode,
    generateBackupCodes,
    hashBackupCodes,
    verifyBackupCode,
    markBackupCodeUsed,
    countRemainingBackupCodes,
    formatBackupCodesForDisplay,
    BACKUP_CODE_COUNT
};
