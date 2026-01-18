/**
 * Tests for Two-Factor Authentication Service
 */

const twofaService = require('../../src/services/twofa');

describe('Two-Factor Authentication Service', () => {
    describe('generateSecret', () => {
        it('should generate a base32 encoded secret', () => {
            const secret = twofaService.generateSecret();

            expect(typeof secret).toBe('string');
            expect(secret.length).toBeGreaterThan(0);
            // Base32 characters only
            expect(secret).toMatch(/^[A-Z2-7]+=*$/);
        });

        it('should generate unique secrets', () => {
            const secret1 = twofaService.generateSecret();
            const secret2 = twofaService.generateSecret();

            expect(secret1).not.toBe(secret2);
        });
    });

    describe('generateOtpauthUri', () => {
        it('should generate a valid otpauth URI', () => {
            const username = 'testuser';
            const secret = twofaService.generateSecret();
            const uri = twofaService.generateOtpauthUri(username, secret);

            expect(uri).toContain('otpauth://totp/');
            expect(uri).toContain('Dployr');
            expect(uri).toContain(username);
            expect(uri).toContain('secret=');
        });

        it('should include correct parameters', () => {
            const username = 'testuser';
            const secret = twofaService.generateSecret();
            const uri = twofaService.generateOtpauthUri(username, secret);

            expect(uri).toContain('algorithm=SHA1');
            expect(uri).toContain('digits=6');
            expect(uri).toContain('period=30');
        });
    });

    describe('generateQRCode', () => {
        it('should generate a data URL for QR code', async () => {
            const username = 'testuser';
            const secret = twofaService.generateSecret();
            const dataUrl = await twofaService.generateQRCode(username, secret);

            expect(dataUrl).toMatch(/^data:image\/png;base64,/);
        });

        it('should generate different QR codes for different users', async () => {
            const secret = twofaService.generateSecret();
            const qr1 = await twofaService.generateQRCode('user1', secret);
            const qr2 = await twofaService.generateQRCode('user2', secret);

            expect(qr1).not.toBe(qr2);
        });
    });

    describe('verifyCode', () => {
        it('should verify a valid TOTP code', () => {
            const secret = twofaService.generateSecret();

            // Generate a valid code using the same library
            const { TOTP, Secret } = require('otpauth');
            const totp = new TOTP({
                secret: Secret.fromBase32(secret),
                algorithm: 'SHA1',
                digits: 6,
                period: 30
            });
            const validCode = totp.generate();

            const result = twofaService.verifyCode(validCode, secret);

            expect(result).toBe(true);
        });

        it('should reject an invalid code', () => {
            const secret = twofaService.generateSecret();
            const result = twofaService.verifyCode('000000', secret);

            expect(result).toBe(false);
        });

        it('should return false for empty code', () => {
            const secret = twofaService.generateSecret();

            expect(twofaService.verifyCode('', secret)).toBe(false);
            expect(twofaService.verifyCode(null, secret)).toBe(false);
            expect(twofaService.verifyCode(undefined, secret)).toBe(false);
        });

        it('should return false for empty secret', () => {
            expect(twofaService.verifyCode('123456', '')).toBe(false);
            expect(twofaService.verifyCode('123456', null)).toBe(false);
            expect(twofaService.verifyCode('123456', undefined)).toBe(false);
        });

        it('should normalize codes with spaces and dashes', () => {
            const secret = twofaService.generateSecret();

            const { TOTP, Secret } = require('otpauth');
            const totp = new TOTP({
                secret: Secret.fromBase32(secret),
                algorithm: 'SHA1',
                digits: 6,
                period: 30
            });
            const validCode = totp.generate();

            // Add spaces and dashes
            const formattedCode = validCode.slice(0, 3) + ' ' + validCode.slice(3);

            expect(twofaService.verifyCode(formattedCode, secret)).toBe(true);
        });
    });

    describe('generateBackupCodes', () => {
        it('should generate correct number of codes', () => {
            const codes = twofaService.generateBackupCodes();

            expect(codes.length).toBe(twofaService.BACKUP_CODE_COUNT);
        });

        it('should generate alphanumeric uppercase codes', () => {
            const codes = twofaService.generateBackupCodes();

            for (const code of codes) {
                expect(code).toMatch(/^[A-Z0-9]+$/);
                expect(code.length).toBe(8);
            }
        });

        it('should generate unique codes', () => {
            const codes = twofaService.generateBackupCodes();
            const uniqueCodes = new Set(codes);

            expect(uniqueCodes.size).toBe(codes.length);
        });
    });

    describe('hashBackupCodes', () => {
        it('should hash all backup codes', async () => {
            const codes = ['CODE1234', 'CODE5678'];
            const hashes = await twofaService.hashBackupCodes(codes);

            expect(hashes.length).toBe(codes.length);
            for (const hash of hashes) {
                expect(hash).toMatch(/^\$2[aby]?\$/); // bcrypt hash prefix
            }
        });

        it('should produce different hashes for same code', async () => {
            const codes = ['SAMECODE', 'SAMECODE'];
            const hashes = await twofaService.hashBackupCodes(codes);

            expect(hashes[0]).not.toBe(hashes[1]);
        });
    });

    describe('verifyBackupCode', () => {
        it('should verify a valid backup code', async () => {
            const codes = ['TESTCODE'];
            const hashes = await twofaService.hashBackupCodes(codes);

            const result = await twofaService.verifyBackupCode('TESTCODE', hashes);

            expect(result.valid).toBe(true);
            expect(result.index).toBe(0);
        });

        it('should reject an invalid backup code', async () => {
            const codes = ['TESTCODE'];
            const hashes = await twofaService.hashBackupCodes(codes);

            const result = await twofaService.verifyBackupCode('WRONGCOD', hashes);

            expect(result.valid).toBe(false);
            expect(result.index).toBe(-1);
        });

        it('should normalize code input (spaces, dashes, lowercase)', async () => {
            const codes = ['TESTCODE'];
            const hashes = await twofaService.hashBackupCodes(codes);

            // Test with lowercase and formatted input
            const result = await twofaService.verifyBackupCode('test-code', hashes);

            expect(result.valid).toBe(true);
        });

        it('should handle empty inputs', async () => {
            expect((await twofaService.verifyBackupCode('', [])).valid).toBe(false);
            expect((await twofaService.verifyBackupCode(null, [])).valid).toBe(false);
            expect((await twofaService.verifyBackupCode('CODE', null)).valid).toBe(false);
            expect((await twofaService.verifyBackupCode('CODE', 'notarray')).valid).toBe(false);
        });

        it('should find correct index in multiple codes', async () => {
            const codes = ['CODE0001', 'CODE0002', 'CODE0003'];
            const hashes = await twofaService.hashBackupCodes(codes);

            const result = await twofaService.verifyBackupCode('CODE0002', hashes);

            expect(result.valid).toBe(true);
            expect(result.index).toBe(1);
        });

        it('should skip null entries in hashes', async () => {
            const codes = ['CODE0001', 'CODE0002'];
            const hashes = await twofaService.hashBackupCodes(codes);
            hashes[0] = null; // Mark first as used

            const result = await twofaService.verifyBackupCode('CODE0002', hashes);

            expect(result.valid).toBe(true);
            expect(result.index).toBe(1);
        });
    });

    describe('markBackupCodeUsed', () => {
        it('should set code at index to null', () => {
            const hashes = ['hash1', 'hash2', 'hash3'];
            const result = twofaService.markBackupCodeUsed(hashes, 1);

            expect(result[0]).toBe('hash1');
            expect(result[1]).toBe(null);
            expect(result[2]).toBe('hash3');
        });

        it('should handle out of bounds index', () => {
            const hashes = ['hash1', 'hash2'];

            // Should not throw
            const result1 = twofaService.markBackupCodeUsed(hashes, -1);
            const result2 = twofaService.markBackupCodeUsed(hashes, 10);

            expect(result1).toEqual(hashes);
            expect(result2).toEqual(hashes);
        });
    });

    describe('countRemainingBackupCodes', () => {
        it('should count non-null codes', () => {
            const hashes = ['hash1', null, 'hash3', null, 'hash5'];
            const count = twofaService.countRemainingBackupCodes(hashes);

            expect(count).toBe(3);
        });

        it('should return 0 for empty array', () => {
            expect(twofaService.countRemainingBackupCodes([])).toBe(0);
        });

        it('should handle null/undefined input', () => {
            expect(twofaService.countRemainingBackupCodes(null)).toBe(0);
            expect(twofaService.countRemainingBackupCodes(undefined)).toBe(0);
        });

        it('should count all codes when none used', () => {
            const hashes = ['hash1', 'hash2', 'hash3'];
            expect(twofaService.countRemainingBackupCodes(hashes)).toBe(3);
        });
    });

    describe('formatBackupCodesForDisplay', () => {
        it('should format 8-character codes with dash', () => {
            const codes = ['ABCD1234', 'EFGH5678'];
            const formatted = twofaService.formatBackupCodesForDisplay(codes);

            expect(formatted[0]).toBe('ABCD-1234');
            expect(formatted[1]).toBe('EFGH-5678');
        });

        it('should not modify codes with different lengths', () => {
            const codes = ['SHORT', 'VERYLONGCODE'];
            const formatted = twofaService.formatBackupCodesForDisplay(codes);

            expect(formatted[0]).toBe('SHORT');
            expect(formatted[1]).toBe('VERYLONGCODE');
        });
    });

    describe('Integration: Full 2FA flow', () => {
        it('should complete full TOTP setup and verification flow', async () => {
            // 1. Generate secret
            const secret = twofaService.generateSecret();
            expect(secret).toBeTruthy();

            // 2. Generate QR code
            const qrCode = await twofaService.generateQRCode('testuser', secret);
            expect(qrCode).toContain('data:image/png;base64,');

            // 3. Generate and verify TOTP code
            const { TOTP, Secret } = require('otpauth');
            const totp = new TOTP({
                secret: Secret.fromBase32(secret),
                algorithm: 'SHA1',
                digits: 6,
                period: 30
            });
            const code = totp.generate();

            expect(twofaService.verifyCode(code, secret)).toBe(true);
        });

        it('should complete full backup code flow', async () => {
            // 1. Generate backup codes
            const codes = twofaService.generateBackupCodes();
            expect(codes.length).toBe(twofaService.BACKUP_CODE_COUNT);

            // 2. Hash for storage
            const hashes = await twofaService.hashBackupCodes(codes);
            expect(hashes.length).toBe(codes.length);

            // 3. Verify a code
            const result = await twofaService.verifyBackupCode(codes[0], hashes);
            expect(result.valid).toBe(true);

            // 4. Mark as used
            const updatedHashes = twofaService.markBackupCodeUsed(hashes, result.index);
            expect(updatedHashes[result.index]).toBe(null);

            // 5. Count remaining
            const remaining = twofaService.countRemainingBackupCodes(updatedHashes);
            expect(remaining).toBe(codes.length - 1);

            // 6. Used code should no longer work
            const reusedResult = await twofaService.verifyBackupCode(codes[0], updatedHashes);
            expect(reusedResult.valid).toBe(false);
        });
    });
});
