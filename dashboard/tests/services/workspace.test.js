/**
 * Tests for Workspace Service
 *
 * Note: Due to Jest's module caching behavior and the complexity of the workspace service's
 * dependency chain (Docker, database transactions, encryption), we focus on testing
 * functions that have simpler mock requirements. Integration tests would provide
 * better coverage for the full lifecycle operations.
 */

// Mock Docker
const mockContainer = {
    start: jest.fn(),
    stop: jest.fn(),
    remove: jest.fn(),
    inspect: jest.fn()
};

const mockDocker = {
    createContainer: jest.fn(() => Promise.resolve({ id: 'container-123', ...mockContainer })),
    getContainer: jest.fn(() => mockContainer),
    listContainers: jest.fn(),
    getImage: jest.fn()
};

jest.mock('dockerode', () => jest.fn(() => mockDocker));

// Mock fs
const mockFs = {
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    promises: {
        access: jest.fn(),
        readFile: jest.fn(),
        writeFile: jest.fn(),
        mkdir: jest.fn()
    }
};

jest.mock('fs', () => mockFs);

// Mock database pool
const mockPool = {
    query: jest.fn()
};

jest.mock('../../src/config/database', () => ({
    pool: mockPool
}));

// Mock logger
jest.mock('../../src/config/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }
}));

// Mock portManager
const mockPortManager = {
    allocatePort: jest.fn(),
    releasePort: jest.fn()
};

jest.mock('../../src/services/portManager', () => mockPortManager);

// Mock encryption
const mockEncryption = {
    encrypt: jest.fn(),
    decrypt: jest.fn()
};

jest.mock('../../src/services/encryption', () => mockEncryption);

// Mock http/https for IP detection
jest.mock('http', () => ({
    get: jest.fn()
}));

jest.mock('https', () => ({
    get: jest.fn()
}));

const workspaceService = require('../../src/services/workspace');

describe('Workspace Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mock implementations
        mockPool.query.mockReset();
    });

    describe('getWorkspace', () => {
        it('should return workspace when found', async () => {
            const mockWorkspace = {
                id: 1,
                user_id: 1,
                project_name: 'test-project',
                status: 'running'
            };
            mockPool.query.mockResolvedValueOnce([[mockWorkspace]]);

            const result = await workspaceService.getWorkspace(1, 'test-project');

            expect(result).toEqual(mockWorkspace);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM workspaces'),
                [1, 'test-project']
            );
        });

        it('should return null when workspace not found', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            const result = await workspaceService.getWorkspace(1, 'nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('getWorkspaceById', () => {
        it('should return workspace by ID', async () => {
            const mockWorkspace = { id: 1, project_name: 'test' };
            mockPool.query.mockResolvedValueOnce([[mockWorkspace]]);

            const result = await workspaceService.getWorkspaceById(1);

            expect(result).toEqual(mockWorkspace);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE id = ?'),
                [1]
            );
        });

        it('should return null when not found', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            const result = await workspaceService.getWorkspaceById(999);

            expect(result).toBeNull();
        });
    });

    describe('getUserWorkspaces', () => {
        it('should return all workspaces for user', async () => {
            const mockWorkspaces = [
                { id: 1, project_name: 'project1' },
                { id: 2, project_name: 'project2' }
            ];
            mockPool.query.mockResolvedValueOnce([mockWorkspaces]);

            const result = await workspaceService.getUserWorkspaces(1);

            expect(result).toEqual(mockWorkspaces);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE user_id = ?'),
                [1]
            );
        });

        it('should return empty array when no workspaces', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            const result = await workspaceService.getUserWorkspaces(1);

            expect(result).toEqual([]);
        });
    });

    describe('getActiveWorkspaces', () => {
        it('should return running workspaces for user', async () => {
            const mockWorkspaces = [
                { id: 1, project_name: 'project1', status: 'running' }
            ];
            mockPool.query.mockResolvedValueOnce([mockWorkspaces]);

            const result = await workspaceService.getActiveWorkspaces(1);

            expect(result).toEqual(mockWorkspaces);
        });
    });

    describe('updateActivity', () => {
        it('should update last activity timestamp', async () => {
            mockPool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

            await workspaceService.updateActivity(1);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('last_activity'),
                [1]
            );
        });
    });

    describe('checkIdleWorkspaces', () => {
        it('should return 0 when no idle workspaces', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            const result = await workspaceService.checkIdleWorkspaces();

            expect(result).toBe(0);
        });
    });

    describe('deleteApiKey', () => {
        it('should clear API key from database', async () => {
            mockPool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

            await workspaceService.deleteApiKey(1, 'anthropic');

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('= NULL'),
                expect.any(Array)
            );
        });
    });

    describe('STATUS constant', () => {
        it('should export STATUS object with expected values', () => {
            expect(workspaceService.STATUS).toBeDefined();
            expect(workspaceService.STATUS).toHaveProperty('STOPPED', 'stopped');
            expect(workspaceService.STATUS).toHaveProperty('STARTING', 'starting');
            expect(workspaceService.STATUS).toHaveProperty('RUNNING', 'running');
            expect(workspaceService.STATUS).toHaveProperty('STOPPING', 'stopping');
            expect(workspaceService.STATUS).toHaveProperty('ERROR', 'error');
        });
    });

    describe('deleteWorkspace', () => {
        it('should throw error when workspace not found', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            await expect(workspaceService.deleteWorkspace(999)).rejects.toThrow('Workspace not found');
        });
    });
});
