/**
 * Project Ports Service Tests
 */

const path = require('path');

// Mock database
const mockConnection = {
    beginTransaction: jest.fn(),
    execute: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn()
};

const mockPool = {
    query: jest.fn(),
    execute: jest.fn(),
    getConnection: jest.fn().mockResolvedValue(mockConnection)
};

jest.mock('../../src/config/database', () => ({
    getPool: () => mockPool
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

// Mock fs
const mockFs = {
    readdir: jest.fn(),
    readFile: jest.fn()
};

jest.mock('fs', () => ({
    promises: mockFs
}));

const projectPorts = require('../../src/services/projectPorts');

describe('ProjectPorts Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPool.getConnection.mockResolvedValue(mockConnection);
    });

    describe('registerPorts', () => {
        it('should register port mappings in database', async () => {
            const portMappings = [
                { service: 'web', internal: 80, external: 8001, protocol: 'tcp' },
                { service: 'api', internal: 3000, external: 8002, protocol: 'tcp' }
            ];

            await projectPorts.registerPorts(1, 'my-project', portMappings);

            expect(mockConnection.beginTransaction).toHaveBeenCalled();
            expect(mockConnection.execute).toHaveBeenCalledWith(
                'DELETE FROM project_ports WHERE user_id = ? AND project_name = ?',
                [1, 'my-project']
            );
            // 1 DELETE + 2 INSERTs
            expect(mockConnection.execute).toHaveBeenCalledTimes(3);
            expect(mockConnection.commit).toHaveBeenCalled();
            expect(mockConnection.release).toHaveBeenCalled();
        });

        it('should skip when portMappings is empty', async () => {
            await projectPorts.registerPorts(1, 'my-project', []);

            expect(mockPool.getConnection).not.toHaveBeenCalled();
        });

        it('should skip when portMappings is null', async () => {
            await projectPorts.registerPorts(1, 'my-project', null);

            expect(mockPool.getConnection).not.toHaveBeenCalled();
        });

        it('should rollback on error', async () => {
            mockConnection.execute.mockRejectedValueOnce(new Error('DB error'));

            await expect(projectPorts.registerPorts(1, 'my-project', [
                { service: 'web', internal: 80, external: 8001 }
            ])).rejects.toThrow('DB error');

            expect(mockConnection.rollback).toHaveBeenCalled();
            expect(mockConnection.release).toHaveBeenCalled();
        });

        it('should default protocol to tcp', async () => {
            await projectPorts.registerPorts(1, 'my-project', [
                { service: 'web', internal: 80, external: 8001 }
            ]);

            // Second execute call is the INSERT
            expect(mockConnection.execute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO project_ports'),
                [1, 'my-project', 'web', 80, 8001, 'tcp']
            );
        });
    });

    describe('registerBasePort', () => {
        it('should register a single port with service name "main"', async () => {
            await projectPorts.registerBasePort(1, 'my-project', 8001);

            expect(mockConnection.execute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO project_ports'),
                [1, 'my-project', 'main', 0, 8001, 'tcp']
            );
        });
    });

    describe('releasePorts', () => {
        it('should delete all ports for a project', async () => {
            await projectPorts.releasePorts(1, 'my-project');

            expect(mockPool.execute).toHaveBeenCalledWith(
                'DELETE FROM project_ports WHERE user_id = ? AND project_name = ?',
                [1, 'my-project']
            );
        });
    });

    describe('getAllUsedPorts', () => {
        it('should return set of all used external ports', async () => {
            mockPool.query.mockResolvedValue([
                [{ external_port: 8001 }, { external_port: 8003 }, { external_port: 8005 }]
            ]);

            const result = await projectPorts.getAllUsedPorts();

            expect(result).toEqual(new Set([8001, 8003, 8005]));
        });

        it('should return empty set when no ports registered', async () => {
            mockPool.query.mockResolvedValue([[]]);

            const result = await projectPorts.getAllUsedPorts();

            expect(result).toEqual(new Set());
        });
    });

    describe('scanFilesystemPorts', () => {
        it('should find EXPOSED_PORT values from .env files', async () => {
            mockFs.readdir
                .mockResolvedValueOnce([{ name: 'user1', isDirectory: () => true }])
                .mockResolvedValueOnce([
                    { name: 'project1', isDirectory: () => true },
                    { name: 'project2', isDirectory: () => true }
                ]);
            mockFs.readFile
                .mockResolvedValueOnce('PROJECT_NAME=user1-project1\nEXPOSED_PORT=8001')
                .mockResolvedValueOnce('PROJECT_NAME=user1-project2\nEXPOSED_PORT=8003');

            const result = await projectPorts.scanFilesystemPorts();

            expect(result).toEqual(new Set([8001, 8003]));
        });

        it('should skip hidden directories', async () => {
            mockFs.readdir
                .mockResolvedValueOnce([{ name: 'user1', isDirectory: () => true }])
                .mockResolvedValueOnce([
                    { name: '.backups', isDirectory: () => true },
                    { name: 'project1', isDirectory: () => true }
                ]);
            mockFs.readFile
                .mockResolvedValueOnce('EXPOSED_PORT=8001');

            const result = await projectPorts.scanFilesystemPorts();

            expect(result).toEqual(new Set([8001]));
        });

        it('should return empty set when USERS_PATH is not accessible', async () => {
            mockFs.readdir.mockRejectedValue(new Error('ENOENT'));

            const result = await projectPorts.scanFilesystemPorts();

            expect(result).toEqual(new Set());
        });
    });

    describe('findNextAvailablePort', () => {
        it('should return 8001 when no ports are used', async () => {
            mockPool.query.mockResolvedValue([[]]);
            mockFs.readdir.mockResolvedValue([]);

            const result = await projectPorts.findNextAvailablePort();

            expect(result).toBe(8001);
        });

        it('should skip used ports from database', async () => {
            mockPool.query.mockResolvedValue([
                [{ external_port: 8001 }, { external_port: 8002 }]
            ]);
            mockFs.readdir.mockResolvedValue([]);

            const result = await projectPorts.findNextAvailablePort();

            expect(result).toBe(8003);
        });

        it('should merge database and filesystem ports', async () => {
            // DB has 8001, filesystem has 8002
            mockPool.query.mockResolvedValue([[{ external_port: 8001 }]]);
            mockFs.readdir
                .mockResolvedValueOnce([{ name: 'user1', isDirectory: () => true }])
                .mockResolvedValueOnce([{ name: 'project2', isDirectory: () => true }]);
            mockFs.readFile.mockResolvedValueOnce('EXPOSED_PORT=8002');

            const result = await projectPorts.findNextAvailablePort();

            expect(result).toBe(8003);
        });

        it('should fill gaps in port numbers', async () => {
            mockPool.query.mockResolvedValue([
                [{ external_port: 8001 }, { external_port: 8003 }]
            ]);
            mockFs.readdir.mockResolvedValue([]);

            const result = await projectPorts.findNextAvailablePort();

            expect(result).toBe(8002);
        });

        it('should find consecutive block when count > 1', async () => {
            mockPool.query.mockResolvedValue([
                [{ external_port: 8001 }, { external_port: 8003 }]
            ]);
            mockFs.readdir.mockResolvedValue([]);

            // Need 3 consecutive ports: 8001 taken, 8002 free but 8003 taken, so start at 8004
            const result = await projectPorts.findNextAvailablePort(3);

            expect(result).toBe(8004);
        });

        it('should fallback to filesystem when database fails', async () => {
            mockPool.query.mockRejectedValue(new Error('DB unavailable'));
            mockFs.readdir
                .mockResolvedValueOnce([{ name: 'user1', isDirectory: () => true }])
                .mockResolvedValueOnce([{ name: 'project1', isDirectory: () => true }]);
            mockFs.readFile.mockResolvedValueOnce('EXPOSED_PORT=8001');

            const result = await projectPorts.findNextAvailablePort();

            expect(result).toBe(8002);
        });
    });

    describe('backfillPorts', () => {
        it('should backfill ports from existing projects', async () => {
            // Mock user list from DB
            mockPool.query.mockResolvedValue([
                [{ id: 1, system_username: 'admin' }]
            ]);

            // Mock filesystem
            mockFs.readdir
                .mockResolvedValueOnce([{ name: 'admin', isDirectory: () => true }]) // users
                .mockResolvedValueOnce([{ name: 'project1', isDirectory: () => true }]); // projects
            mockFs.readFile
                .mockResolvedValueOnce('PROJECT_NAME=admin-project1\nEXPOSED_PORT=8001') // .env
                .mockRejectedValueOnce(new Error('ENOENT')); // docker-compose.yml not found

            const stats = await projectPorts.backfillPorts();

            expect(stats.processed).toBe(1);
            expect(stats.registered).toBe(1);
            expect(stats.errors).toBe(0);
        });

        it('should handle custom compose projects', async () => {
            mockPool.query.mockResolvedValue([
                [{ id: 1, system_username: 'admin' }]
            ]);

            mockFs.readdir
                .mockResolvedValueOnce([{ name: 'admin', isDirectory: () => true }])
                .mockResolvedValueOnce([{ name: 'custom-app', isDirectory: () => true }]);
            mockFs.readFile
                .mockResolvedValueOnce('EXPOSED_PORT=8001') // .env
                .mockResolvedValueOnce([ // docker-compose.yml
                    'x-dployr:',
                    '  dployr-custom: "true"',
                    'services:',
                    '  web:',
                    '    image: nginx',
                    '    ports:',
                    '      - "8001:80"',
                    '  redis:',
                    '    image: redis',
                    '    ports:',
                    '      - "8002:6379"'
                ].join('\n'));

            const stats = await projectPorts.backfillPorts();

            expect(stats.processed).toBe(1);
            expect(stats.registered).toBe(2); // 2 port mappings
        });

        it('should skip unknown user directories', async () => {
            mockPool.query.mockResolvedValue([
                [{ id: 1, system_username: 'admin' }]
            ]);

            mockFs.readdir
                .mockResolvedValueOnce([
                    { name: 'admin', isDirectory: () => true },
                    { name: 'unknown-user', isDirectory: () => true }
                ])
                .mockResolvedValueOnce([{ name: 'project1', isDirectory: () => true }])
                // unknown-user directory is skipped, no second readdir for it
                ;
            mockFs.readFile
                .mockResolvedValueOnce('EXPOSED_PORT=8001')
                .mockRejectedValueOnce(new Error('ENOENT'));

            const stats = await projectPorts.backfillPorts();

            expect(stats.processed).toBe(1);
        });

        it('should return empty stats when USERS_PATH is not accessible', async () => {
            mockPool.query.mockResolvedValue([[{ id: 1, system_username: 'admin' }]]);
            mockFs.readdir.mockRejectedValue(new Error('ENOENT'));

            const stats = await projectPorts.backfillPorts();

            expect(stats.processed).toBe(0);
            expect(stats.registered).toBe(0);
        });
    });
});
