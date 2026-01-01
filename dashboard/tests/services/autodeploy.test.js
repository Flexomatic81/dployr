// Mock database pool
const mockPool = {
    execute: jest.fn()
};

// Mock child_process
const mockExecSync = jest.fn();

// Mock fs
const mockFs = {
    existsSync: jest.fn()
};

// Mock services
const mockGitService = {
    isGitRepository: jest.fn(),
    getGitPath: jest.fn(),
    pullChanges: jest.fn()
};

const mockDockerService = {
    restartProject: jest.fn()
};

const mockUserService = {
    getNotificationPreferences: jest.fn(),
    getUserById: jest.fn(),
    getUserLanguage: jest.fn()
};

const mockEmailService = {
    isEnabled: jest.fn(),
    sendDeploymentSuccessEmail: jest.fn(),
    sendDeploymentFailureEmail: jest.fn()
};

const mockGenerateWebhookSecret = jest.fn();

// Set up mocks before requiring the module
jest.mock('../../src/config/database', () => ({
    pool: mockPool
}));

jest.mock('child_process', () => ({
    execSync: mockExecSync
}));

jest.mock('fs', () => mockFs);

jest.mock('../../src/services/git', () => mockGitService);
jest.mock('../../src/services/docker', () => mockDockerService);
jest.mock('../../src/services/user', () => mockUserService);
jest.mock('../../src/services/email', () => mockEmailService);
jest.mock('../../src/services/utils/webhook', () => ({
    generateWebhookSecret: mockGenerateWebhookSecret
}));

const autoDeployService = require('../../src/services/autodeploy');

describe('AutoDeploy Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('enableAutoDeploy', () => {
        it('should enable auto-deploy for a project', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            const result = await autoDeployService.enableAutoDeploy(1, 'my-project', 'main');

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO project_autodeploy'),
                [1, 'my-project', 'main', 'main']
            );
            expect(result).toEqual({ affectedRows: 1 });
        });

        it('should use default branch if not specified', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            await autoDeployService.enableAutoDeploy(1, 'my-project');

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO project_autodeploy'),
                [1, 'my-project', 'main', 'main']
            );
        });
    });

    describe('disableAutoDeploy', () => {
        it('should disable auto-deploy for a project', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            const result = await autoDeployService.disableAutoDeploy(1, 'my-project');

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE project_autodeploy SET enabled = FALSE'),
                [1, 'my-project']
            );
            expect(result).toEqual({ affectedRows: 1 });
        });
    });

    describe('updateInterval', () => {
        it('should update interval with valid value', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            await autoDeployService.updateInterval(1, 'my-project', 15);

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE project_autodeploy SET interval_minutes'),
                [15, 1, 'my-project']
            );
        });

        it('should use default interval (5) for invalid value', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            await autoDeployService.updateInterval(1, 'my-project', 999);

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE project_autodeploy SET interval_minutes'),
                [5, 1, 'my-project']
            );
        });
    });

    describe('deleteAutoDeploy', () => {
        it('should delete auto-deploy config and logs', async () => {
            mockPool.execute.mockResolvedValue([{}]);

            await autoDeployService.deleteAutoDeploy(1, 'my-project');

            expect(mockPool.execute).toHaveBeenCalledTimes(2);
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM project_autodeploy'),
                [1, 'my-project']
            );
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM deployment_logs'),
                [1, 'my-project']
            );
        });
    });

    describe('getAutoDeployConfig', () => {
        it('should return config when found', async () => {
            const mockConfig = {
                id: 1,
                user_id: 1,
                project_name: 'my-project',
                enabled: true,
                interval_minutes: 5
            };
            mockPool.execute.mockResolvedValue([[mockConfig]]);

            const result = await autoDeployService.getAutoDeployConfig(1, 'my-project');

            expect(result).toEqual(mockConfig);
        });

        it('should return null when not found', async () => {
            mockPool.execute.mockResolvedValue([[]]);

            const result = await autoDeployService.getAutoDeployConfig(1, 'nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('getAllActiveAutoDeployConfigs', () => {
        it('should return all active configurations', async () => {
            const mockConfigs = [
                { id: 1, project_name: 'project1', enabled: true },
                { id: 2, project_name: 'project2', enabled: true }
            ];
            mockPool.execute.mockResolvedValue([mockConfigs]);

            const result = await autoDeployService.getAllActiveAutoDeployConfigs();

            expect(result).toEqual(mockConfigs);
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('WHERE pa.enabled = TRUE')
            );
        });
    });

    describe('checkForUpdates', () => {
        it('should return hasUpdates false if not a git repository', async () => {
            mockGitService.isGitRepository.mockReturnValue(false);

            const result = await autoDeployService.checkForUpdates('user', 'project', 'main');

            expect(result).toEqual({
                hasUpdates: false,
                error: 'Not a Git repository'
            });
        });

        it('should return hasUpdates true when local and remote differ', async () => {
            mockGitService.isGitRepository.mockReturnValue(true);
            mockGitService.getGitPath.mockReturnValue('/app/users/user/project/html');
            mockExecSync
                .mockReturnValueOnce('') // git fetch
                .mockReturnValueOnce('abc1234567890') // local HEAD
                .mockReturnValueOnce('def9876543210'); // remote HEAD

            const result = await autoDeployService.checkForUpdates('user', 'project', 'main');

            expect(result.hasUpdates).toBe(true);
            expect(result.localCommit).toBe('abc1234');
            expect(result.remoteCommit).toBe('def9876');
        });

        it('should return hasUpdates false when local and remote are same', async () => {
            mockGitService.isGitRepository.mockReturnValue(true);
            mockGitService.getGitPath.mockReturnValue('/app/users/user/project/html');
            mockExecSync
                .mockReturnValueOnce('') // git fetch
                .mockReturnValueOnce('abc1234567890') // local HEAD
                .mockReturnValueOnce('abc1234567890'); // remote HEAD (same)

            const result = await autoDeployService.checkForUpdates('user', 'project', 'main');

            expect(result.hasUpdates).toBe(false);
        });
    });

    describe('logDeployment', () => {
        it('should log a deployment with all data', async () => {
            mockPool.execute.mockResolvedValue([{}]);

            await autoDeployService.logDeployment(1, 'my-project', 'manual', {
                status: 'success',
                oldCommitHash: 'abc1234',
                newCommitHash: 'def5678',
                commitMessage: 'Fix bug',
                durationMs: 5000
            });

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO deployment_logs'),
                [1, 'my-project', 'manual', 'abc1234', 'def5678', 'Fix bug', 'success', null, 5000]
            );
        });

        it('should log a deployment with default values', async () => {
            mockPool.execute.mockResolvedValue([{}]);

            await autoDeployService.logDeployment(1, 'my-project', 'clone');

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO deployment_logs'),
                [1, 'my-project', 'clone', null, null, null, 'success', null, null]
            );
        });
    });

    describe('getDeploymentHistory', () => {
        it('should return deployment history', async () => {
            const mockHistory = [
                { id: 1, status: 'success' },
                { id: 2, status: 'failed' }
            ];
            mockPool.execute.mockResolvedValue([mockHistory]);

            const result = await autoDeployService.getDeploymentHistory(1, 'my-project', 10);

            expect(result).toEqual(mockHistory);
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY created_at DESC'),
                [1, 'my-project', 10]
            );
        });
    });

    describe('getLastSuccessfulDeployment', () => {
        it('should return last successful deployment', async () => {
            const mockDeployment = { id: 1, status: 'success' };
            mockPool.execute.mockResolvedValue([[mockDeployment]]);

            const result = await autoDeployService.getLastSuccessfulDeployment(1, 'my-project');

            expect(result).toEqual(mockDeployment);
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining("status = 'success'"),
                [1, 'my-project']
            );
        });

        it('should return null when no successful deployment', async () => {
            mockPool.execute.mockResolvedValue([[]]);

            const result = await autoDeployService.getLastSuccessfulDeployment(1, 'my-project');

            expect(result).toBeNull();
        });
    });

    describe('Webhook functions', () => {
        describe('enableWebhook', () => {
            it('should enable webhook and return secret', async () => {
                mockGenerateWebhookSecret.mockReturnValue('test-secret-123');
                mockPool.execute
                    .mockResolvedValueOnce([{}]) // INSERT
                    .mockResolvedValueOnce([[{ id: 42 }]]); // SELECT

                const result = await autoDeployService.enableWebhook(1, 'my-project', 'main');

                expect(result).toEqual({
                    secret: 'test-secret-123',
                    webhookId: 42
                });
            });
        });

        describe('disableWebhook', () => {
            it('should disable webhook', async () => {
                mockPool.execute.mockResolvedValue([{}]);

                await autoDeployService.disableWebhook(1, 'my-project');

                expect(mockPool.execute).toHaveBeenCalledWith(
                    expect.stringContaining('webhook_enabled = FALSE'),
                    [1, 'my-project']
                );
            });
        });

        describe('regenerateWebhookSecret', () => {
            it('should regenerate webhook secret', async () => {
                mockGenerateWebhookSecret.mockReturnValue('new-secret-456');
                mockPool.execute.mockResolvedValue([{}]);

                const result = await autoDeployService.regenerateWebhookSecret(1, 'my-project');

                expect(result).toBe('new-secret-456');
                expect(mockPool.execute).toHaveBeenCalledWith(
                    expect.stringContaining('webhook_secret = ?'),
                    ['new-secret-456', 1, 'my-project']
                );
            });
        });

        describe('getWebhookConfig', () => {
            it('should return webhook config when found', async () => {
                const mockConfig = {
                    id: 1,
                    webhook_enabled: true,
                    webhook_secret: 'secret',
                    branch: 'main'
                };
                mockPool.execute.mockResolvedValue([[mockConfig]]);

                const result = await autoDeployService.getWebhookConfig(1, 'my-project');

                expect(result).toEqual(mockConfig);
            });

            it('should return null when not found', async () => {
                mockPool.execute.mockResolvedValue([[]]);

                const result = await autoDeployService.getWebhookConfig(1, 'nonexistent');

                expect(result).toBeNull();
            });
        });

        describe('findProjectByWebhook', () => {
            it('should find project by webhook ID', async () => {
                const mockProject = {
                    id: 42,
                    project_name: 'my-project',
                    system_username: 'user'
                };
                mockPool.execute.mockResolvedValue([[mockProject]]);

                const result = await autoDeployService.findProjectByWebhook(42);

                expect(result).toEqual(mockProject);
                expect(mockPool.execute).toHaveBeenCalledWith(
                    expect.stringContaining('webhook_enabled = TRUE'),
                    [42]
                );
            });

            it('should return null when webhook not found', async () => {
                mockPool.execute.mockResolvedValue([[]]);

                const result = await autoDeployService.findProjectByWebhook(999);

                expect(result).toBeNull();
            });
        });
    });

    describe('VALID_INTERVALS export', () => {
        it('should export valid intervals array', () => {
            expect(autoDeployService.VALID_INTERVALS).toBeDefined();
            expect(Array.isArray(autoDeployService.VALID_INTERVALS)).toBe(true);
            expect(autoDeployService.VALID_INTERVALS).toContain(5);
            expect(autoDeployService.VALID_INTERVALS).toContain(60);
        });
    });
});
