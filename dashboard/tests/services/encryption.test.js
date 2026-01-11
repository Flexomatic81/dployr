/**
 * Tests for Encryption Service
 */

const encryptionService = require('../../src/services/encryption');

describe('Encryption Service', () => {
    const testSecret = 'test-session-secret-for-encryption';
    const testPlaintext = 'sk-ant-api-key-12345';

    describe('deriveKey', () => {
        it('should derive a 32-byte key from secret', () => {
            const key = encryptionService.deriveKey(testSecret);

            expect(key).toBeInstanceOf(Buffer);
            expect(key.length).toBe(32);
        });

        it('should derive the same key for the same secret', () => {
            const key1 = encryptionService.deriveKey(testSecret);
            const key2 = encryptionService.deriveKey(testSecret);

            expect(key1.equals(key2)).toBe(true);
        });

        it('should derive different keys for different secrets', () => {
            const key1 = encryptionService.deriveKey('secret1');
            const key2 = encryptionService.deriveKey('secret2');

            expect(key1.equals(key2)).toBe(false);
        });

        it('should throw error if secret is empty', () => {
            expect(() => encryptionService.deriveKey('')).toThrow('Session secret is required');
        });

        it('should throw error if secret is null', () => {
            expect(() => encryptionService.deriveKey(null)).toThrow('Session secret is required');
        });

        it('should throw error if secret is undefined', () => {
            expect(() => encryptionService.deriveKey(undefined)).toThrow('Session secret is required');
        });
    });

    describe('encrypt', () => {
        it('should encrypt plaintext and return encrypted data with IV', () => {
            const result = encryptionService.encrypt(testPlaintext, testSecret);

            expect(result).toHaveProperty('encrypted');
            expect(result).toHaveProperty('iv');
            expect(result.encrypted).toBeInstanceOf(Buffer);
            expect(result.iv).toBeInstanceOf(Buffer);
            expect(result.iv.length).toBe(16);
        });

        it('should produce different ciphertext for same plaintext (random IV)', () => {
            const result1 = encryptionService.encrypt(testPlaintext, testSecret);
            const result2 = encryptionService.encrypt(testPlaintext, testSecret);

            expect(result1.encrypted.equals(result2.encrypted)).toBe(false);
            expect(result1.iv.equals(result2.iv)).toBe(false);
        });

        it('should throw error if plaintext is empty', () => {
            expect(() => encryptionService.encrypt('', testSecret)).toThrow('Plaintext is required');
        });

        it('should throw error if plaintext is null', () => {
            expect(() => encryptionService.encrypt(null, testSecret)).toThrow('Plaintext is required');
        });

        it('should encrypt special characters correctly', () => {
            const specialPlaintext = '!@#$%^&*()_+-=[]{}|;\':",./<>?`~';
            const result = encryptionService.encrypt(specialPlaintext, testSecret);

            expect(result.encrypted).toBeInstanceOf(Buffer);
            expect(result.encrypted.length).toBeGreaterThan(0);
        });

        it('should encrypt unicode characters correctly', () => {
            const unicodePlaintext = 'Hallo Welt! 你好世界 🎉';
            const result = encryptionService.encrypt(unicodePlaintext, testSecret);

            expect(result.encrypted).toBeInstanceOf(Buffer);
            expect(result.encrypted.length).toBeGreaterThan(0);
        });
    });

    describe('decrypt', () => {
        it('should decrypt encrypted data back to original plaintext', () => {
            const { encrypted, iv } = encryptionService.encrypt(testPlaintext, testSecret);
            const decrypted = encryptionService.decrypt(encrypted, iv, testSecret);

            expect(decrypted).toBe(testPlaintext);
        });

        it('should decrypt special characters correctly', () => {
            const specialPlaintext = '!@#$%^&*()_+-=[]{}|;\':",./<>?`~';
            const { encrypted, iv } = encryptionService.encrypt(specialPlaintext, testSecret);
            const decrypted = encryptionService.decrypt(encrypted, iv, testSecret);

            expect(decrypted).toBe(specialPlaintext);
        });

        it('should decrypt unicode characters correctly', () => {
            const unicodePlaintext = 'Hallo Welt! 你好世界 🎉';
            const { encrypted, iv } = encryptionService.encrypt(unicodePlaintext, testSecret);
            const decrypted = encryptionService.decrypt(encrypted, iv, testSecret);

            expect(decrypted).toBe(unicodePlaintext);
        });

        it('should throw error if encrypted data is empty', () => {
            const { iv } = encryptionService.encrypt(testPlaintext, testSecret);

            expect(() => encryptionService.decrypt(null, iv, testSecret)).toThrow('Encrypted data and IV are required');
        });

        it('should throw error if IV is empty', () => {
            const { encrypted } = encryptionService.encrypt(testPlaintext, testSecret);

            expect(() => encryptionService.decrypt(encrypted, null, testSecret)).toThrow('Encrypted data and IV are required');
        });

        it('should fail with wrong secret', () => {
            const { encrypted, iv } = encryptionService.encrypt(testPlaintext, testSecret);

            expect(() => encryptionService.decrypt(encrypted, iv, 'wrong-secret')).toThrow();
        });

        it('should fail with tampered ciphertext', () => {
            const { encrypted, iv } = encryptionService.encrypt(testPlaintext, testSecret);

            // Tamper with the encrypted data
            encrypted[0] = encrypted[0] ^ 0xFF;

            expect(() => encryptionService.decrypt(encrypted, iv, testSecret)).toThrow();
        });

        it('should fail with wrong IV', () => {
            const { encrypted } = encryptionService.encrypt(testPlaintext, testSecret);
            const wrongIv = Buffer.alloc(16, 0);

            expect(() => encryptionService.decrypt(encrypted, wrongIv, testSecret)).toThrow();
        });
    });

    describe('encrypt and decrypt integration', () => {
        it('should handle long API keys', () => {
            const longKey = 'sk-ant-api03-' + 'x'.repeat(200);
            const { encrypted, iv } = encryptionService.encrypt(longKey, testSecret);
            const decrypted = encryptionService.decrypt(encrypted, iv, testSecret);

            expect(decrypted).toBe(longKey);
        });

        it('should handle multiple encrypt/decrypt cycles', () => {
            const keys = [
                'sk-ant-api-key-1',
                'sk-ant-api-key-2',
                'sk-ant-api-key-3'
            ];

            for (const key of keys) {
                const { encrypted, iv } = encryptionService.encrypt(key, testSecret);
                const decrypted = encryptionService.decrypt(encrypted, iv, testSecret);
                expect(decrypted).toBe(key);
            }
        });
    });
});
