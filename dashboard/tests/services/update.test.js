/**
 * Update Service Tests
 */

const fs = require('fs').promises;
const path = require('path');

const testDir = '/tmp/dployr-test-update';

// Set env BEFORE requiring modules
process.env.HOST_DPLOYR_PATH = testDir;

// Mock child_process with custom promisify support
const { promisify } = require('util');
const mockExecFile = jest.fn();
// Add custom promisify so util.promisify(execFile) returns { stdout, stderr }
mockExecFile[promisify.custom] = (...args) => {
    return new Promise((resolve, reject) => {
        mockExecFile(...args, (err, stdout, stderr) => {
            if (err) {
                err.stdout = stdout;
                err.stderr = stderr;
                reject(err);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
};
jest.mock('child_process', () => ({
    execFile: mockExecFile
}));

// Mock fetch
global.fetch = jest.fn();

const updateService = require('../../src/services/update');

describe('Update Service', () => {
    beforeAll(async () => {
        await fs.mkdir(testDir, { recursive: true });
    });

    afterAll(async () => {
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch {}
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('UPDATE_CHANNELS', () => {
        it('should define stable and beta channels', () => {
            expect(updateService.UPDATE_CHANNELS).toEqual({
                stable: 'main',
                beta: 'dev'
            });
        });
    });

    describe('getUpdateChannel', () => {
        it('should return stable by default when .env does not exist', async () => {
            const channel = await updateService.getUpdateChannel();
            expect(channel).toBe('stable');
        });

        it('should read channel from .env file', async () => {
            const envPath = path.join(testDir, '.env');
            await fs.writeFile(envPath, 'UPDATE_CHANNEL=beta\n');

            const channel = await updateService.getUpdateChannel();
            expect(channel).toBe('beta');

            await fs.unlink(envPath);
        });

        it('should return stable for invalid channel in .env', async () => {
            const envPath = path.join(testDir, '.env');
            await fs.writeFile(envPath, 'UPDATE_CHANNEL=invalid\n');

            const channel = await updateService.getUpdateChannel();
            expect(channel).toBe('stable');

            await fs.unlink(envPath);
        });
    });

    describe('setUpdateChannel', () => {
        it('should reject invalid channel', async () => {
            await expect(updateService.setUpdateChannel('invalid'))
                .rejects.toThrow('Invalid update channel: invalid');
        });

        it('should write channel to new .env file', async () => {
            const envPath = path.join(testDir, '.env');

            // Ensure no .env exists
            try { await fs.unlink(envPath); } catch {}

            await updateService.setUpdateChannel('beta');

            const content = await fs.readFile(envPath, 'utf8');
            expect(content).toContain('UPDATE_CHANNEL=beta');

            await fs.unlink(envPath);
        });

        it('should update existing channel in .env file', async () => {
            const envPath = path.join(testDir, '.env');
            await fs.writeFile(envPath, 'OTHER_VAR=value\nUPDATE_CHANNEL=stable\n');

            await updateService.setUpdateChannel('beta');

            const content = await fs.readFile(envPath, 'utf8');
            expect(content).toContain('UPDATE_CHANNEL=beta');
            expect(content).toContain('OTHER_VAR=value');
            expect(content).not.toContain('UPDATE_CHANNEL=stable');

            await fs.unlink(envPath);
        });
    });

    describe('getCurrentVersion', () => {
        it('should get version from git commands', async () => {
            // Mock execFile to simulate git commands
            mockExecFile.mockImplementation((cmd, args, opts, callback) => {
                if (typeof opts === 'function') {
                    callback = opts;
                }

                if (args.includes('rev-parse')) {
                    callback(null, 'abc1234\n', '');
                } else if (args.includes('log')) {
                    callback(null, '2024-01-15\n', '');
                } else if (args.includes('describe')) {
                    callback(null, 'v1.0.0\n', '');
                } else {
                    callback(null, '', '');
                }
            });

            const version = await updateService.getCurrentVersion();

            expect(version.hash).toBe('abc1234');
            expect(version.date).toBe('2024-01-15');
            expect(version.tag).toBe('v1.0.0');
        });

        it('should handle missing tag gracefully', async () => {
            mockExecFile.mockImplementation((cmd, args, opts, callback) => {
                if (typeof opts === 'function') {
                    callback = opts;
                }

                if (args.includes('rev-parse')) {
                    callback(null, 'abc1234\n', '');
                } else if (args.includes('log')) {
                    callback(null, '2024-01-15\n', '');
                } else if (args.includes('describe')) {
                    callback(new Error('No tag'));
                } else {
                    callback(null, '', '');
                }
            });

            const version = await updateService.getCurrentVersion();

            expect(version.hash).toBe('abc1234');
            expect(version.tag).toBeNull();
        });

        it('should return fallback on git error', async () => {
            mockExecFile.mockImplementation((cmd, args, opts, callback) => {
                if (typeof opts === 'function') {
                    callback = opts;
                }
                callback(new Error('git not found'));
            });

            process.env.GIT_HASH = 'fallback123';
            process.env.GIT_DATE = '2024-01-01';

            const version = await updateService.getCurrentVersion();

            expect(version.hash).toBe('fallback123');
            expect(version.date).toBe('2024-01-01');
            expect(version.tag).toBeNull();

            delete process.env.GIT_HASH;
            delete process.env.GIT_DATE;
        });
    });

    describe('getLatestRelease', () => {
        it('should fetch latest release from GitHub', async () => {
            const mockRelease = {
                tag_name: 'v1.2.0',
                name: 'Release 1.2.0',
                body: '## Changes\n- New feature',
                published_at: '2024-01-20T10:00:00Z',
                html_url: 'https://github.com/Flexomatic81/dployr/releases/tag/v1.2.0'
            };

            fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve(mockRelease)
            });

            const release = await updateService.getLatestRelease();

            expect(release).toEqual({
                tag: 'v1.2.0',
                name: 'Release 1.2.0',
                body: '## Changes\n- New feature',
                publishedAt: '2024-01-20T10:00:00Z',
                htmlUrl: 'https://github.com/Flexomatic81/dployr/releases/tag/v1.2.0'
            });

            expect(fetch).toHaveBeenCalledWith(
                'https://api.github.com/repos/Flexomatic81/dployr/releases/latest',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'User-Agent': 'Dployr-Update-Checker'
                    })
                })
            );
        });

        it('should return null when no releases found (404)', async () => {
            fetch.mockResolvedValue({
                ok: false,
                status: 404
            });

            const release = await updateService.getLatestRelease();
            expect(release).toBeNull();
        });

        it('should return null on API error', async () => {
            fetch.mockResolvedValue({
                ok: false,
                status: 500
            });

            const release = await updateService.getLatestRelease();
            expect(release).toBeNull();
        });

        it('should handle network errors', async () => {
            fetch.mockRejectedValue(new Error('Network error'));

            const release = await updateService.getLatestRelease();
            expect(release).toBeNull();
        });
    });

    describe('getCachedUpdateStatus', () => {
        it('should return cached status', () => {
            const status = updateService.getCachedUpdateStatus();

            expect(status).toHaveProperty('updateAvailable');
            expect(status).toHaveProperty('lastCheck');
        });
    });

    describe('checkForUpdates', () => {
        beforeEach(() => {
            // Reset cache by setting lastCheck to null via setUpdateChannel
            jest.clearAllMocks();
        });

        it('should check for updates on stable channel', async () => {
            // Setup .env for stable channel
            const envPath = path.join(testDir, '.env');
            await fs.writeFile(envPath, 'UPDATE_CHANNEL=stable\n');

            // Mock git commands
            mockExecFile.mockImplementation((cmd, args, opts, callback) => {
                if (typeof opts === 'function') {
                    callback = opts;
                }

                if (args.includes('rev-parse')) {
                    callback(null, 'abc1234\n', '');
                } else if (args[0] === 'log' && args[1] === '-1') {
                    callback(null, '2024-01-15\n', '');
                } else if (args.includes('describe')) {
                    callback(null, 'v1.0.0\n', '');
                } else {
                    callback(null, '', '');
                }
            });

            // Mock GitHub API - new release available
            fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    tag_name: 'v1.1.0',
                    name: 'Release 1.1.0',
                    body: 'New features',
                    published_at: '2024-01-20T10:00:00Z',
                    html_url: 'https://github.com/test/test'
                })
            });

            const result = await updateService.checkForUpdates(true);

            expect(result.channel).toBe('stable');
            expect(result.updateAvailable).toBe(true);
            expect(result.currentVersion.tag).toBe('v1.0.0');
            expect(result.latestVersion.tag).toBe('v1.1.0');

            await fs.unlink(envPath);
        });

        it('should return cached result if recently checked', async () => {
            const envPath = path.join(testDir, '.env');
            await fs.writeFile(envPath, 'UPDATE_CHANNEL=stable\n');

            // First call (force)
            mockExecFile.mockImplementation((cmd, args, opts, callback) => {
                if (typeof opts === 'function') callback = opts;
                if (args.includes('rev-parse')) callback(null, 'abc1234\n', '');
                else if (args[0] === 'log' && args[1] === '-1') callback(null, '2024-01-15\n', '');
                else if (args.includes('describe')) callback(null, 'v1.0.0\n', '');
                else callback(null, '', '');
            });

            fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    tag_name: 'v1.0.0',
                    name: 'Release 1.0.0',
                    body: 'Current release',
                    published_at: '2024-01-15T10:00:00Z',
                    html_url: 'https://github.com/test/test'
                })
            });

            await updateService.checkForUpdates(true);

            // Second call (no force) - should use cache
            const result = await updateService.checkForUpdates(false);
            expect(result.cached).toBe(true);

            await fs.unlink(envPath);
        });
    });

    describe('performUpdate', () => {
        it('should execute deploy script', async () => {
            const envPath = path.join(testDir, '.env');
            const scriptPath = path.join(testDir, 'deploy.sh');

            await fs.writeFile(envPath, 'UPDATE_CHANNEL=stable\n');
            await fs.writeFile(scriptPath, '#!/bin/bash\necho "Update complete"');

            mockExecFile.mockImplementation((cmd, args, opts, callback) => {
                if (typeof opts === 'function') {
                    callback = opts;
                    opts = {};
                }

                if (cmd === 'bash' && args.some(a => a.includes('deploy.sh'))) {
                    callback(null, 'Update complete\n', '');
                } else {
                    callback(null, '', '');
                }
            });

            const result = await updateService.performUpdate();

            expect(result.success).toBe(true);
            expect(result.message).toContain('completed successfully');
            expect(result.output).toContain('Update complete');

            await fs.unlink(envPath);
            await fs.unlink(scriptPath);
        });

        it('should handle missing deploy script', async () => {
            const envPath = path.join(testDir, '.env');
            await fs.writeFile(envPath, 'UPDATE_CHANNEL=stable\n');

            // Ensure no deploy.sh exists
            const scriptPath = path.join(testDir, 'deploy.sh');
            try { await fs.unlink(scriptPath); } catch {}

            const result = await updateService.performUpdate();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Deploy script not found');

            await fs.unlink(envPath);
        });

        it('should handle script execution error', async () => {
            const envPath = path.join(testDir, '.env');
            const scriptPath = path.join(testDir, 'deploy.sh');

            await fs.writeFile(envPath, 'UPDATE_CHANNEL=stable\n');
            await fs.writeFile(scriptPath, '#!/bin/bash\nexit 1');

            mockExecFile.mockImplementation((cmd, args, opts, callback) => {
                if (typeof opts === 'function') {
                    callback = opts;
                    opts = {};
                }

                if (cmd === 'bash' && args.some(a => a.includes('deploy.sh'))) {
                    const error = new Error('Script failed');
                    error.stdout = 'Error output';
                    error.stderr = 'Some error';
                    callback(error);
                } else {
                    callback(null, '', '');
                }
            });

            const result = await updateService.performUpdate();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Update failed');

            await fs.unlink(envPath);
            await fs.unlink(scriptPath);
        });
    });
});
