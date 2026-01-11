/**
 * Tests for Port Manager Service
 */

// Mock database pool
const mockConnection = {
    beginTransaction: jest.fn().mockResolvedValue(),
    query: jest.fn(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn()
};

const mockPool = {
    getConnection: jest.fn(() => Promise.resolve(mockConnection)),
    query: jest.fn()
};

jest.mock('../../src/config/database', () => ({
    pool: mockPool
}));

// Mock logger
jest.mock('../../src/config/logger', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

const portManager = require('../../src/services/portManager');

describe('Port Manager Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockConnection.beginTransaction.mockResolvedValue();
        mockConnection.commit.mockResolvedValue();
        mockConnection.rollback.mockResolvedValue();
    });

    describe('allocatePort', () => {
        it('should allocate the first available port when none are in use', async () => {
            // Mock query chain for connection
            mockConnection.query
                .mockResolvedValueOnce([]) // LOCK TABLES
                .mockResolvedValueOnce([[]]) // SELECT used ports (empty)
                .mockResolvedValueOnce([]); // UNLOCK TABLES

            const port = await portManager.allocatePort();

            expect(port).toBe(portManager.PORT_RANGE.start);
            expect(mockConnection.beginTransaction).toHaveBeenCalled();
            expect(mockConnection.commit).toHaveBeenCalled();
            expect(mockConnection.release).toHaveBeenCalled();
        });

        it('should skip used ports and allocate next available', async () => {
            // Ports 10000, 10001 are in use
            mockConnection.query
                .mockResolvedValueOnce([]) // LOCK TABLES
                .mockResolvedValueOnce([[
                    { assigned_port: 10000 },
                    { assigned_port: 10001 }
                ]]) // SELECT used ports
                .mockResolvedValueOnce([]); // UNLOCK TABLES

            const port = await portManager.allocatePort();

            expect(port).toBe(10002);
        });

        it('should throw error when no ports are available', async () => {
            // All ports in use
            const allPorts = [];
            for (let i = portManager.PORT_RANGE.start; i <= portManager.PORT_RANGE.end; i++) {
                allPorts.push({ assigned_port: i });
            }

            mockConnection.query
                .mockResolvedValueOnce([]) // LOCK TABLES
                .mockResolvedValueOnce([allPorts]) // SELECT used ports
                .mockResolvedValueOnce([]); // UNLOCK TABLES

            await expect(portManager.allocatePort()).rejects.toThrow('No available ports');
            expect(mockConnection.rollback).toHaveBeenCalled();
            expect(mockConnection.release).toHaveBeenCalled();
        });

        it('should cleanup and rethrow on database error', async () => {
            mockConnection.query.mockRejectedValueOnce(new Error('Database error'));

            await expect(portManager.allocatePort()).rejects.toThrow('Database error');
            expect(mockConnection.release).toHaveBeenCalled();
        });
    });

    describe('releasePort', () => {
        it('should log port release', async () => {
            const { logger } = require('../../src/config/logger');

            await portManager.releasePort(10005);

            expect(logger.debug).toHaveBeenCalledWith('Port released', { port: 10005 });
        });
    });

    describe('isPortInUse', () => {
        it('should return true if port is in use', async () => {
            mockPool.query.mockResolvedValueOnce([[{ count: 1 }]]);

            const result = await portManager.isPortInUse(10000);

            expect(result).toBe(true);
            expect(mockPool.query).toHaveBeenCalled();
        });

        it('should return false if port is not in use', async () => {
            mockPool.query.mockResolvedValueOnce([[{ count: 0 }]]);

            const result = await portManager.isPortInUse(10000);

            expect(result).toBe(false);
        });

        it('should return true on error (safe default)', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Query error'));

            const result = await portManager.isPortInUse(10000);

            expect(result).toBe(true);
        });
    });

    describe('getPortStats', () => {
        it('should return port usage statistics', async () => {
            mockPool.query.mockResolvedValueOnce([[{ used: 5 }]]);

            const stats = await portManager.getPortStats();

            expect(stats).toHaveProperty('total');
            expect(stats).toHaveProperty('used', 5);
            expect(stats).toHaveProperty('available');
            expect(stats).toHaveProperty('range');
            expect(stats.available).toBe(stats.total - 5);
        });

        it('should throw on database error', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Database error'));

            await expect(portManager.getPortStats()).rejects.toThrow('Database error');
        });
    });

    describe('PORT_RANGE', () => {
        it('should have start and end properties', () => {
            expect(portManager.PORT_RANGE).toHaveProperty('start');
            expect(portManager.PORT_RANGE).toHaveProperty('end');
            expect(portManager.PORT_RANGE.start).toBeLessThan(portManager.PORT_RANGE.end);
        });
    });
});
