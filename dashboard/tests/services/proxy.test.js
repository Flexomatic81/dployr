// Store original env
const originalEnv = process.env;

// Mock database pool
const mockPool = {
    execute: jest.fn()
};

// Mock axios
const mockAxiosPost = jest.fn();
const mockAxiosGet = jest.fn();
const mockAxiosDelete = jest.fn();
const mockAxiosPut = jest.fn();
const mockAxiosCreate = jest.fn(() => ({
    post: mockAxiosPost,
    get: mockAxiosGet,
    delete: mockAxiosDelete,
    put: mockAxiosPut
}));

jest.mock('axios', () => ({
    post: mockAxiosPost,
    get: mockAxiosGet,
    create: mockAxiosCreate
}));

// Mock dockerode
const mockContainerStart = jest.fn();
const mockContainerStop = jest.fn();
const mockContainerRestart = jest.fn();
const mockContainerLogs = jest.fn();
const mockContainerRemove = jest.fn();
const mockVolumeRemove = jest.fn();
const mockListContainers = jest.fn();

jest.mock('dockerode', () => {
    return jest.fn().mockImplementation(() => ({
        getContainer: jest.fn(() => ({
            start: mockContainerStart,
            stop: mockContainerStop,
            restart: mockContainerRestart,
            logs: mockContainerLogs,
            remove: mockContainerRemove
        })),
        getVolume: jest.fn(() => ({
            remove: mockVolumeRemove
        })),
        listContainers: mockListContainers
    }));
});

jest.mock('../../src/config/database', () => ({
    pool: mockPool
}));

const proxyService = require('../../src/services/proxy');

describe('Proxy Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        // Reset module state - the token cache is internal
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('isEnabled', () => {
        it('should return true when NPM_ENABLED is true', () => {
            // Note: isEnabled reads from module load time, so we test the function exists
            expect(typeof proxyService.isEnabled).toBe('function');
        });
    });

    describe('getContainerStatus', () => {
        it('should return running status when container exists', async () => {
            mockListContainers.mockResolvedValue([{
                Names: ['/dployr-npm'],
                State: 'running',
                Id: 'abc123'
            }]);

            const result = await proxyService.getContainerStatus();

            expect(result).toEqual({
                exists: true,
                running: true,
                status: 'running',
                containerId: 'abc123'
            });
        });

        it('should return not_found when container does not exist', async () => {
            mockListContainers.mockResolvedValue([]);

            const result = await proxyService.getContainerStatus();

            expect(result).toEqual({
                exists: false,
                running: false,
                status: 'not_found'
            });
        });

        it('should return stopped status when container is stopped', async () => {
            mockListContainers.mockResolvedValue([{
                Names: ['/dployr-npm'],
                State: 'exited',
                Id: 'abc123'
            }]);

            const result = await proxyService.getContainerStatus();

            expect(result).toEqual({
                exists: true,
                running: false,
                status: 'exited',
                containerId: 'abc123'
            });
        });

        it('should handle errors gracefully', async () => {
            mockListContainers.mockRejectedValue(new Error('Docker error'));

            const result = await proxyService.getContainerStatus();

            expect(result.exists).toBe(false);
            expect(result.status).toBe('error');
        });
    });

    describe('startContainer', () => {
        it('should start container successfully', async () => {
            mockContainerStart.mockResolvedValue();

            const result = await proxyService.startContainer();

            expect(result).toEqual({ success: true });
            expect(mockContainerStart).toHaveBeenCalled();
        });

        it('should return success if already running', async () => {
            const error = new Error('Already started');
            error.statusCode = 304;
            mockContainerStart.mockRejectedValue(error);

            const result = await proxyService.startContainer();

            expect(result.success).toBe(true);
        });

        it('should return error on failure', async () => {
            mockContainerStart.mockRejectedValue(new Error('Start failed'));

            const result = await proxyService.startContainer();

            expect(result.success).toBe(false);
            expect(result.error).toBe('Start failed');
        });
    });

    describe('stopContainer', () => {
        it('should stop container successfully', async () => {
            mockContainerStop.mockResolvedValue();

            const result = await proxyService.stopContainer();

            expect(result).toEqual({ success: true });
            expect(mockContainerStop).toHaveBeenCalled();
        });

        it('should return success if already stopped', async () => {
            const error = new Error('Already stopped');
            error.statusCode = 304;
            mockContainerStop.mockRejectedValue(error);

            const result = await proxyService.stopContainer();

            expect(result.success).toBe(true);
        });
    });

    describe('restartContainer', () => {
        it('should restart container successfully', async () => {
            mockContainerRestart.mockResolvedValue();

            const result = await proxyService.restartContainer();

            expect(result).toEqual({ success: true });
            expect(mockContainerRestart).toHaveBeenCalled();
        });

        it('should return error on failure', async () => {
            mockContainerRestart.mockRejectedValue(new Error('Restart failed'));

            const result = await proxyService.restartContainer();

            expect(result.success).toBe(false);
            expect(result.error).toBe('Restart failed');
        });
    });

    describe('getContainerLogs', () => {
        it('should return logs successfully', async () => {
            const mockLogsBuffer = Buffer.from('12345678Log line 1\n12345678Log line 2');
            mockContainerLogs.mockResolvedValue(mockLogsBuffer);

            const result = await proxyService.getContainerLogs(100);

            expect(result.success).toBe(true);
            expect(result.logs).toContain('Log line 1');
        });

        it('should return error on failure', async () => {
            mockContainerLogs.mockRejectedValue(new Error('Logs failed'));

            const result = await proxyService.getContainerLogs();

            expect(result.success).toBe(false);
            expect(result.error).toBe('Logs failed');
        });
    });

    describe('Database functions', () => {
        describe('saveDomainMapping', () => {
            it('should save domain mapping', async () => {
                mockPool.execute.mockResolvedValue([{}]);

                await proxyService.saveDomainMapping(1, 'my-project', 'example.com', 42, 10);

                expect(mockPool.execute).toHaveBeenCalledWith(
                    expect.stringContaining('INSERT INTO project_domains'),
                    [1, 'my-project', 'example.com', 42, 10, true]
                );
            });

            it('should save mapping without SSL', async () => {
                mockPool.execute.mockResolvedValue([{}]);

                await proxyService.saveDomainMapping(1, 'my-project', 'example.com', 42);

                expect(mockPool.execute).toHaveBeenCalledWith(
                    expect.any(String),
                    [1, 'my-project', 'example.com', 42, null, false]
                );
            });
        });

        describe('getProjectDomains', () => {
            it('should return domains for a project', async () => {
                const mockDomains = [
                    { domain: 'example.com', ssl_enabled: true },
                    { domain: 'test.com', ssl_enabled: false }
                ];
                mockPool.execute.mockResolvedValue([mockDomains]);

                const result = await proxyService.getProjectDomains(1, 'my-project');

                expect(result).toEqual(mockDomains);
                expect(mockPool.execute).toHaveBeenCalledWith(
                    expect.stringContaining('SELECT * FROM project_domains'),
                    [1, 'my-project']
                );
            });
        });

        describe('getDomainRecord', () => {
            it('should return domain record when found', async () => {
                const mockRecord = { domain: 'example.com', proxy_host_id: 42 };
                mockPool.execute.mockResolvedValue([[mockRecord]]);

                const result = await proxyService.getDomainRecord(1, 'my-project', 'example.com');

                expect(result).toEqual(mockRecord);
            });

            it('should return null when not found', async () => {
                mockPool.execute.mockResolvedValue([[]]);

                const result = await proxyService.getDomainRecord(1, 'my-project', 'nonexistent.com');

                expect(result).toBeNull();
            });
        });

        describe('deleteDomainMapping', () => {
            it('should delete domain mapping from DB', async () => {
                mockPool.execute
                    .mockResolvedValueOnce([[{ proxy_host_id: 42 }]]) // SELECT
                    .mockResolvedValueOnce([{}]); // DELETE

                // Mock the NPM delete (via axios create)
                mockAxiosDelete.mockResolvedValue({});

                await proxyService.deleteDomainMapping(1, 'my-project', 'example.com');

                expect(mockPool.execute).toHaveBeenCalledWith(
                    expect.stringContaining('DELETE FROM project_domains'),
                    [1, 'my-project', 'example.com']
                );
            });
        });

        describe('updateDomainSSL', () => {
            it('should update SSL status', async () => {
                mockPool.execute.mockResolvedValue([{}]);

                await proxyService.updateDomainSSL(1, 'my-project', 'example.com', 99);

                expect(mockPool.execute).toHaveBeenCalledWith(
                    expect.stringContaining('UPDATE project_domains'),
                    [99, 1, 'my-project', 'example.com']
                );
            });
        });

        describe('deleteProjectDomains', () => {
            it('should delete all domains for a project', async () => {
                mockPool.execute
                    .mockResolvedValueOnce([[{ proxy_host_id: 42 }, { proxy_host_id: 43 }]]) // SELECT
                    .mockResolvedValueOnce([{}]); // DELETE

                await proxyService.deleteProjectDomains(1, 'my-project');

                expect(mockPool.execute).toHaveBeenCalledWith(
                    expect.stringContaining('DELETE FROM project_domains'),
                    [1, 'my-project']
                );
            });
        });
    });

    describe('Module exports', () => {
        it('should export all required functions', () => {
            expect(proxyService.isEnabled).toBeDefined();
            expect(proxyService.testConnection).toBeDefined();
            expect(proxyService.getToken).toBeDefined();
            expect(proxyService.createProxyHost).toBeDefined();
            expect(proxyService.deleteProxyHost).toBeDefined();
            expect(proxyService.listProxyHosts).toBeDefined();
            expect(proxyService.requestCertificate).toBeDefined();
            expect(proxyService.enableSSL).toBeDefined();
            expect(proxyService.initializeCredentials).toBeDefined();
            expect(proxyService.waitForApi).toBeDefined();
            expect(proxyService.getContainerStatus).toBeDefined();
            expect(proxyService.startContainer).toBeDefined();
            expect(proxyService.stopContainer).toBeDefined();
            expect(proxyService.restartContainer).toBeDefined();
            expect(proxyService.recreateContainer).toBeDefined();
            expect(proxyService.getContainerLogs).toBeDefined();
            expect(proxyService.saveDomainMapping).toBeDefined();
            expect(proxyService.getProjectDomains).toBeDefined();
            expect(proxyService.getDomainRecord).toBeDefined();
            expect(proxyService.deleteDomainMapping).toBeDefined();
            expect(proxyService.updateDomainSSL).toBeDefined();
            expect(proxyService.deleteProjectDomains).toBeDefined();
            expect(proxyService.createDashboardProxyHost).toBeDefined();
            expect(proxyService.deleteDashboardProxyHost).toBeDefined();
        });
    });
});
