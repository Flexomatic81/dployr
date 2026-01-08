/**
 * Encryption Service
 *
 * Responsible for:
 * - Secure encryption of API keys
 * - Key derivation from session secret
 * - AES-256-GCM authenticated encryption
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives an encryption key from the session secret
 * @param {string} secret - The session secret
 * @returns {Buffer} Derived key
 */
function deriveKey(secret) {
    if (!secret) {
        throw new Error('Session secret is required for encryption');
    }
    return crypto.scryptSync(secret, 'dployr-api-keys', KEY_LENGTH);
}

/**
 * Encrypts a plaintext value using AES-256-GCM
 * @param {string} plaintext - The value to encrypt
 * @param {string} secret - The session secret
 * @returns {{encrypted: Buffer, iv: Buffer}} Encrypted data and IV
 */
function encrypt(plaintext, secret) {
    if (!plaintext) {
        throw new Error('Plaintext is required for encryption');
    }

    const key = deriveKey(secret);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    // Get auth tag for authenticated encryption
    const authTag = cipher.getAuthTag();

    // Combine encrypted data with auth tag
    const combined = Buffer.concat([encrypted, authTag]);

    return { encrypted: combined, iv };
}

/**
 * Decrypts an encrypted value using AES-256-GCM
 * @param {Buffer} encryptedWithTag - The encrypted data with auth tag
 * @param {Buffer} iv - The initialization vector
 * @param {string} secret - The session secret
 * @returns {string} Decrypted plaintext
 */
function decrypt(encryptedWithTag, iv, secret) {
    if (!encryptedWithTag || !iv) {
        throw new Error('Encrypted data and IV are required for decryption');
    }

    const key = deriveKey(secret);

    // Separate encrypted data and auth tag
    const authTag = encryptedWithTag.slice(-AUTH_TAG_LENGTH);
    const encrypted = encryptedWithTag.slice(0, -AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
}

module.exports = {
    encrypt,
    decrypt,
    deriveKey
};
