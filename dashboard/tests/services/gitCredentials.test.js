/**
 * Tests for gitCredentials.js service
 * Tests encrypted Git credential storage and retrieval
 */

// Mock database pool
const mockExecute = jest.fn();
jest.mock('../../src/config/database', () => ({
    pool: {
        execute: mockExecute
    }
}));

// Mock encryption service
const mockEncrypt = jest.fn();
const mockDecrypt = jest.fn();
jest.mock('../../src/services/encryption', () => ({
    encrypt: mockEncrypt,
    decrypt: mockDecrypt
}));

// Mock logger
jest.mock('../../src/config/logger', () => ({
    logger: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

// Mock fs
const mockFs = {
    existsSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
    unlinkSync: jest.fn()
};
jest.mock('fs', () => mockFs);

// Set SESSION_SECRET for encryption
process.env.SESSION_SECRET = 'test-secret-key-for-testing';

const gitCredentials = require('../../src/services/gitCredentials');

describe('Git Credentials Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEncrypt.mockReturnValue({
            encrypted: Buffer.from('encrypted-data'),
            iv: Buffer.from('1234567890123456')
        });
        mockDecrypt.mockReturnValue('decrypted-token');
    });

    describe('saveCredentials', () => {
        it('should save credentials with encryption when token provided', async () => {
            mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

            await gitCredentials.saveCredentials(
                1,
                'my-project',
                'https://github.com/user/repo',
                'ghp_test_token'
            );

            expect(mockEncrypt).toHaveBeenCalledWith('ghp_test_token', 'test-secret-key-for-testing');
            expect(mockExecute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO git_credentials'),
                expect.arrayContaining([1, 'my-project', 'https://github.com/user/repo'])
            );
        });

        it('should save without encryption when no token provided', async () => {
            mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

            await gitCredentials.saveCredentials(
                1,
                'my-project',
                'https://github.com/user/repo',
                null
            );

            expect(mockEncrypt).not.toHaveBeenCalled();
            expect(mockExecute).toHaveBeenCalled();
        });
    });

    describe('getCredentials', () => {
        it('should return decrypted credentials when found', async () => {
            mockExecute.mockResolvedValue([[{
                repo_url: 'https://github.com/user/repo',
                token_encrypted: Buffer.from('encrypted'),
                token_iv: Buffer.from('1234567890123456')
            }]]);

            const result = await gitCredentials.getCredentials(1, 'my-project');

            expect(mockDecrypt).toHaveBeenCalled();
            expect(result).toEqual({
                repoUrl: 'https://github.com/user/repo',
                token: 'decrypted-token'
            });
        });

        it('should return null when no credentials found', async () => {
            mockExecute.mockResolvedValue([[]]);

            const result = await gitCredentials.getCredentials(1, 'my-project');

            expect(result).toBeNull();
        });

        it('should return null token when decryption fails', async () => {
            mockExecute.mockResolvedValue([[{
                repo_url: 'https://github.com/user/repo',
                token_encrypted: Buffer.from('encrypted'),
                token_iv: Buffer.from('1234567890123456')
            }]]);
            mockDecrypt.mockImplementation(() => {
                throw new Error('Decryption failed');
            });

            const result = await gitCredentials.getCredentials(1, 'my-project');

            expect(result).toEqual({
                repoUrl: 'https://github.com/user/repo',
                token: null
            });
        });

        it('should return null token when no encrypted data', async () => {
            mockExecute.mockResolvedValue([[{
                repo_url: 'https://github.com/user/repo',
                token_encrypted: null,
                token_iv: null
            }]]);

            const result = await gitCredentials.getCredentials(1, 'my-project');

            expect(mockDecrypt).not.toHaveBeenCalled();
            expect(result).toEqual({
                repoUrl: 'https://github.com/user/repo',
                token: null
            });
        });
    });

    describe('deleteCredentials', () => {
        it('should delete credentials from database', async () => {
            mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

            await gitCredentials.deleteCredentials(1, 'my-project');

            expect(mockExecute).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM git_credentials'),
                [1, 'my-project']
            );
        });
    });

    describe('writeTemporaryCredentials', () => {
        it('should write credentials file and return cleanup function', () => {
            mockFs.existsSync.mockReturnValue(false);

            const cleanup = gitCredentials.writeTemporaryCredentials(
                '/path/to/git',
                'https://github.com/user/repo',
                'test-token'
            );

            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                '/path/to/git/.git-credentials',
                expect.stringContaining('test-token@github.com'),
                { mode: 0o600 }
            );
            expect(typeof cleanup).toBe('function');
        });

        it('should return no-op when no token', () => {
            const cleanup = gitCredentials.writeTemporaryCredentials(
                '/path/to/git',
                'https://github.com/user/repo',
                null
            );

            expect(mockFs.writeFileSync).not.toHaveBeenCalled();
            expect(typeof cleanup).toBe('function');
        });

        it('cleanup should remove credentials file', () => {
            mockFs.existsSync.mockReturnValue(true);

            const cleanup = gitCredentials.writeTemporaryCredentials(
                '/path/to/git',
                'https://github.com/user/repo',
                'test-token'
            );

            // Clear previous calls
            mockFs.writeFileSync.mockClear();
            mockFs.existsSync.mockReturnValue(true);

            cleanup();

            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                '/path/to/git/.git-credentials',
                '',
                { mode: 0o600 }
            );
            expect(mockFs.unlinkSync).toHaveBeenCalledWith('/path/to/git/.git-credentials');
        });
    });

    describe('withCredentials', () => {
        it('should execute operation with temporary credentials', async () => {
            mockExecute.mockResolvedValue([[{
                repo_url: 'https://github.com/user/repo',
                token_encrypted: Buffer.from('encrypted'),
                token_iv: Buffer.from('1234567890123456')
            }]]);
            mockFs.existsSync.mockReturnValue(false);

            const operation = jest.fn().mockResolvedValue('result');

            const result = await gitCredentials.withCredentials(
                '/path/to/git',
                1,
                'my-project',
                operation
            );

            expect(operation).toHaveBeenCalled();
            expect(result).toBe('result');
        });

        it('should run operation without credentials when none found', async () => {
            mockExecute.mockResolvedValue([[]]);

            const operation = jest.fn().mockResolvedValue('result');

            const result = await gitCredentials.withCredentials(
                '/path/to/git',
                1,
                'my-project',
                operation
            );

            expect(operation).toHaveBeenCalled();
            expect(result).toBe('result');
        });

        it('should cleanup credentials even on operation failure', async () => {
            mockExecute.mockResolvedValue([[{
                repo_url: 'https://github.com/user/repo',
                token_encrypted: Buffer.from('encrypted'),
                token_iv: Buffer.from('1234567890123456')
            }]]);
            mockFs.existsSync.mockReturnValue(true);

            const operation = jest.fn().mockRejectedValue(new Error('Operation failed'));

            await expect(
                gitCredentials.withCredentials('/path/to/git', 1, 'my-project', operation)
            ).rejects.toThrow('Operation failed');

            // Cleanup should have been called
            expect(mockFs.unlinkSync).toHaveBeenCalled();
        });
    });

    describe('migrateFromFile', () => {
        it('should migrate credentials from file to database', async () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue('https://ghp_token123@github.com/user/repo.git\n');
            mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

            const result = await gitCredentials.migrateFromFile(1, 'my-project', '/path/to/git');

            expect(result).toBe(true);
            expect(mockEncrypt).toHaveBeenCalledWith('ghp_token123', 'test-secret-key-for-testing');
            expect(mockFs.unlinkSync).toHaveBeenCalled();
        });

        it('should return false when no credentials file exists', async () => {
            mockFs.existsSync.mockReturnValue(false);

            const result = await gitCredentials.migrateFromFile(1, 'my-project', '/path/to/git');

            expect(result).toBe(false);
        });

        it('should return false when file format is invalid', async () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue('invalid content');

            const result = await gitCredentials.migrateFromFile(1, 'my-project', '/path/to/git');

            expect(result).toBe(false);
        });
    });

    describe('hasCredentials', () => {
        it('should return true when credentials exist in database', async () => {
            mockExecute.mockResolvedValue([[{
                repo_url: 'https://github.com/user/repo',
                token_encrypted: Buffer.from('encrypted'),
                token_iv: Buffer.from('1234567890123456')
            }]]);

            const result = await gitCredentials.hasCredentials(1, 'my-project', '/path/to/git');

            expect(result).toBe(true);
        });

        it('should return true when credentials file exists', async () => {
            mockExecute.mockResolvedValue([[{
                repo_url: 'https://github.com/user/repo',
                token_encrypted: null,
                token_iv: null
            }]]);
            mockFs.existsSync.mockReturnValue(true);

            const result = await gitCredentials.hasCredentials(1, 'my-project', '/path/to/git');

            expect(result).toBe(true);
        });

        it('should return false when no credentials exist', async () => {
            mockExecute.mockResolvedValue([[]]);
            mockFs.existsSync.mockReturnValue(false);

            const result = await gitCredentials.hasCredentials(1, 'my-project', '/path/to/git');

            expect(result).toBe(false);
        });
    });
});
