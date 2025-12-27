// Mock dockerode before requiring the service
const mockContainer = {
    start: jest.fn(),
    stop: jest.fn(),
    restart: jest.fn(),
    logs: jest.fn()
};

const mockDocker = {
    listContainers: jest.fn(),
    getContainer: jest.fn(() => mockContainer)
};

jest.mock('dockerode', () => {
    return jest.fn().mockImplementation(() => mockDocker);
});

// Mock logger
jest.mock('../../src/config/logger', () => ({
    logger: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

// Mock child_process.exec
jest.mock('child_process', () => ({
    exec: jest.fn()
}));

const dockerService = require('../../src/services/docker');
const { exec } = require('child_process');

describe('Docker Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getUserContainers', () => {
        it('should return containers for a specific user', async () => {
            const mockContainers = [
                { Names: ['/testuser-project1-web'], Labels: {} },
                { Names: ['/testuser-project2-db'], Labels: {} },
                { Names: ['/otheruser-project-web'], Labels: {} }
            ];

            mockDocker.listContainers.mockResolvedValue(mockContainers);

            const containers = await dockerService.getUserContainers('testuser');

            expect(mockDocker.listContainers).toHaveBeenCalledWith({ all: true });
            expect(containers).toHaveLength(2);
            expect(containers[0].Names[0]).toBe('/testuser-project1-web');
            expect(containers[1].Names[0]).toBe('/testuser-project2-db');
        });

        it('should include containers with user label', async () => {
            const mockContainers = [
                { Names: ['/some-container'], Labels: { 'com.webserver.user': 'testuser' } },
                { Names: ['/other-container'], Labels: {} }
            ];

            mockDocker.listContainers.mockResolvedValue(mockContainers);

            const containers = await dockerService.getUserContainers('testuser');

            expect(containers).toHaveLength(1);
            expect(containers[0].Labels['com.webserver.user']).toBe('testuser');
        });

        it('should return empty array on error', async () => {
            mockDocker.listContainers.mockRejectedValue(new Error('Docker error'));

            const containers = await dockerService.getUserContainers('testuser');

            expect(containers).toEqual([]);
        });
    });

    describe('getProjectContainers', () => {
        it('should return containers for a specific project', async () => {
            const mockContainers = [
                { Names: ['/myproject-web'] },
                { Names: ['/myproject-db'] },
                { Names: ['/myproject'] },
                { Names: ['/otherproject-web'] }
            ];

            mockDocker.listContainers.mockResolvedValue(mockContainers);

            const containers = await dockerService.getProjectContainers('myproject');

            expect(containers).toHaveLength(3);
        });

        it('should return empty array on error', async () => {
            mockDocker.listContainers.mockRejectedValue(new Error('Docker error'));

            const containers = await dockerService.getProjectContainers('myproject');

            expect(containers).toEqual([]);
        });
    });

    describe('startContainer', () => {
        it('should start a container successfully', async () => {
            mockContainer.start.mockResolvedValue();

            const result = await dockerService.startContainer('container-id');

            expect(mockDocker.getContainer).toHaveBeenCalledWith('container-id');
            expect(mockContainer.start).toHaveBeenCalled();
            expect(result).toEqual({ success: true });
        });

        it('should return error on failure', async () => {
            mockContainer.start.mockRejectedValue(new Error('Container already running'));

            const result = await dockerService.startContainer('container-id');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Container already running');
        });
    });

    describe('stopContainer', () => {
        it('should stop a container successfully', async () => {
            mockContainer.stop.mockResolvedValue();

            const result = await dockerService.stopContainer('container-id');

            expect(mockDocker.getContainer).toHaveBeenCalledWith('container-id');
            expect(mockContainer.stop).toHaveBeenCalled();
            expect(result).toEqual({ success: true });
        });

        it('should return error on failure', async () => {
            mockContainer.stop.mockRejectedValue(new Error('Container not running'));

            const result = await dockerService.stopContainer('container-id');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Container not running');
        });
    });

    describe('restartContainer', () => {
        it('should restart a container successfully', async () => {
            mockContainer.restart.mockResolvedValue();

            const result = await dockerService.restartContainer('container-id');

            expect(mockDocker.getContainer).toHaveBeenCalledWith('container-id');
            expect(mockContainer.restart).toHaveBeenCalled();
            expect(result).toEqual({ success: true });
        });

        it('should return error on failure', async () => {
            mockContainer.restart.mockRejectedValue(new Error('Restart failed'));

            const result = await dockerService.restartContainer('container-id');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Restart failed');
        });
    });

    describe('getContainerLogs', () => {
        it('should return container logs', async () => {
            const mockLogs = Buffer.from('xxxxxxxx2024-01-15 Log line 1\nxxxxxxxx2024-01-15 Log line 2');
            mockContainer.logs.mockResolvedValue(mockLogs);

            const logs = await dockerService.getContainerLogs('container-id', 100);

            expect(mockDocker.getContainer).toHaveBeenCalledWith('container-id');
            expect(mockContainer.logs).toHaveBeenCalledWith({
                stdout: true,
                stderr: true,
                tail: 100,
                timestamps: true
            });
            expect(logs).toContain('Log line');
        });

        it('should return error message on failure', async () => {
            mockContainer.logs.mockRejectedValue(new Error('Logs unavailable'));

            const logs = await dockerService.getContainerLogs('container-id');

            expect(logs).toContain('Error loading logs');
            expect(logs).toContain('Logs unavailable');
        });
    });

    describe('startProject', () => {
        it('should start project using docker compose', async () => {
            exec.mockImplementation((cmd, callback) => {
                callback(null, 'Started successfully', '');
            });

            const result = await dockerService.startProject('/app/users/test/project');

            expect(exec).toHaveBeenCalledWith(
                expect.stringContaining('docker compose'),
                expect.any(Function)
            );
            expect(result).toBe('Started successfully');
        });

        it('should reject on docker compose error', async () => {
            exec.mockImplementation((cmd, callback) => {
                callback(new Error('Failed'), '', 'Error message');
            });

            await expect(dockerService.startProject('/app/users/test/project'))
                .rejects.toThrow('Error message');
        });
    });

    describe('stopProject', () => {
        it('should stop project using docker compose down', async () => {
            exec.mockImplementation((cmd, callback) => {
                expect(cmd).toContain('down');
                callback(null, 'Stopped', '');
            });

            const result = await dockerService.stopProject('/app/users/test/project');

            expect(result).toBe('Stopped');
        });
    });

    describe('restartProject', () => {
        it('should restart project using docker compose restart', async () => {
            exec.mockImplementation((cmd, callback) => {
                expect(cmd).toContain('restart');
                callback(null, 'Restarted', '');
            });

            const result = await dockerService.restartProject('/app/users/test/project');

            expect(result).toBe('Restarted');
        });
    });
});
