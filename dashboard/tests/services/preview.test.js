/**
 * Tests for Preview Service
 */

// Mock Docker
const mockContainer = {
    start: jest.fn(),
    stop: jest.fn(),
    remove: jest.fn()
};

const mockDocker = {
    createContainer: jest.fn(() => Promise.resolve({ id: 'container-123', ...mockContainer })),
    getContainer: jest.fn(() => mockContainer)
};

jest.mock('dockerode', () => jest.fn(() => mockDocker));

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

// Mock bcrypt
jest.mock('bcrypt', () => ({
    hash: jest.fn(() => Promise.resolve('hashed-password')),
    compare: jest.fn()
}));

const previewService = require('../../src/services/preview');

describe('Preview Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.SERVER_IP = 'test.example.com';
    });

    afterEach(() => {
        delete process.env.SERVER_IP;
    });

    describe('PREVIEW_STATUS', () => {
        it('should export all status constants', () => {
            expect(previewService.PREVIEW_STATUS).toEqual({
                CREATING: 'creating',
                RUNNING: 'running',
                STOPPING: 'stopping',
                STOPPED: 'stopped',
                EXPIRED: 'expired',
                ERROR: 'error'
            });
        });
    });

    describe('getWorkspacePreviews', () => {
        it('should return previews for a workspace', async () => {
            const mockPreviews = [
                { id: 1, preview_hash: 'hash1' },
                { id: 2, preview_hash: 'hash2' }
            ];
            mockPool.query.mockResolvedValueOnce([mockPreviews]);

            const result = await previewService.getWorkspacePreviews(1, 1);

            expect(result).toEqual(mockPreviews);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM preview_environments'),
                [1, 1]
            );
        });

        it('should return empty array when no previews exist', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            const result = await previewService.getWorkspacePreviews(1, 1);

            expect(result).toEqual([]);
        });

        it('should throw error on database failure', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Database error'));

            await expect(previewService.getWorkspacePreviews(1, 1)).rejects.toThrow('Database error');
        });
    });

    describe('getPreviewByHash', () => {
        it('should return preview when found', async () => {
            const mockPreview = { id: 1, preview_hash: 'abc123' };
            mockPool.query.mockResolvedValueOnce([[mockPreview]]);

            const result = await previewService.getPreviewByHash('abc123');

            expect(result).toEqual(mockPreview);
            expect(mockPool.query).toHaveBeenCalledWith(
                'SELECT * FROM preview_environments WHERE preview_hash = ?',
                ['abc123']
            );
        });

        it('should return null when not found', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            const result = await previewService.getPreviewByHash('nonexistent');

            expect(result).toBeNull();
        });

        it('should return null on error', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Database error'));

            const result = await previewService.getPreviewByHash('abc123');

            expect(result).toBeNull();
        });
    });

    describe('validatePreviewAccess', () => {
        it('should return false for non-existent preview', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            const result = await previewService.validatePreviewAccess('nonexistent');

            expect(result).toBe(false);
        });

        it('should return false for non-running preview', async () => {
            const mockPreview = {
                id: 1,
                status: 'stopped',
                expires_at: new Date(Date.now() + 10000)
            };
            mockPool.query.mockResolvedValueOnce([[mockPreview]]);

            const result = await previewService.validatePreviewAccess('hash123');

            expect(result).toBe(false);
        });

        it('should return false for expired preview', async () => {
            const mockPreview = {
                id: 1,
                status: 'running',
                expires_at: new Date(Date.now() - 10000) // Expired
            };
            mockPool.query.mockResolvedValueOnce([[mockPreview]]);

            const result = await previewService.validatePreviewAccess('hash123');

            expect(result).toBe(false);
        });

        it('should return true for running, non-expired preview without password', async () => {
            const mockPreview = {
                id: 1,
                status: 'running',
                expires_at: new Date(Date.now() + 60000),
                password_hash: null
            };
            mockPool.query.mockResolvedValueOnce([[mockPreview]]);

            const result = await previewService.validatePreviewAccess('hash123');

            expect(result).toBe(true);
        });

        it('should return false when password required but not provided', async () => {
            const mockPreview = {
                id: 1,
                status: 'running',
                expires_at: new Date(Date.now() + 60000),
                password_hash: 'hashed-password'
            };
            mockPool.query.mockResolvedValueOnce([[mockPreview]]);

            const result = await previewService.validatePreviewAccess('hash123');

            expect(result).toBe(false);
        });

        it('should validate password when provided', async () => {
            const bcrypt = require('bcrypt');
            bcrypt.compare.mockResolvedValueOnce(true);

            const mockPreview = {
                id: 1,
                status: 'running',
                expires_at: new Date(Date.now() + 60000),
                password_hash: 'hashed-password'
            };
            mockPool.query.mockResolvedValueOnce([[mockPreview]]);

            const result = await previewService.validatePreviewAccess('hash123', 'correct-password');

            expect(result).toBe(true);
            expect(bcrypt.compare).toHaveBeenCalledWith('correct-password', 'hashed-password');
        });

        it('should return false for wrong password', async () => {
            const bcrypt = require('bcrypt');
            bcrypt.compare.mockResolvedValueOnce(false);

            const mockPreview = {
                id: 1,
                status: 'running',
                expires_at: new Date(Date.now() + 60000),
                password_hash: 'hashed-password'
            };
            mockPool.query.mockResolvedValueOnce([[mockPreview]]);

            const result = await previewService.validatePreviewAccess('hash123', 'wrong-password');

            expect(result).toBe(false);
        });

        it('should return false on error', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Database error'));

            const result = await previewService.validatePreviewAccess('hash123');

            expect(result).toBe(false);
        });
    });

    describe('deletePreview', () => {
        it('should throw error when preview not found', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            await expect(previewService.deletePreview(1, 1)).rejects.toThrow('Preview not found');
        });

        it('should delete preview and cleanup container', async () => {
            const mockPreview = {
                id: 1,
                container_id: 'container-123',
                assigned_port: 10000,
                preview_hash: 'hash123'
            };

            mockPool.query
                .mockResolvedValueOnce([[mockPreview]]) // SELECT preview
                .mockResolvedValueOnce([]) // UPDATE status
                .mockResolvedValueOnce([]); // DELETE

            mockContainer.stop.mockResolvedValue();
            mockContainer.remove.mockResolvedValue();

            await previewService.deletePreview(1, 1);

            expect(mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
            expect(mockContainer.remove).toHaveBeenCalled();
            expect(mockPortManager.releasePort).toHaveBeenCalledWith(10000);
        });

        it('should handle container stop failure gracefully', async () => {
            const mockPreview = {
                id: 1,
                container_id: 'container-123',
                assigned_port: 10000,
                preview_hash: 'hash123'
            };

            mockPool.query
                .mockResolvedValueOnce([[mockPreview]])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            mockContainer.stop.mockRejectedValue(new Error('Container not found'));

            // Should not throw
            await previewService.deletePreview(1, 1);

            expect(mockPortManager.releasePort).toHaveBeenCalled();
        });
    });

    describe('extendPreview', () => {
        it('should throw error when preview not found', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            await expect(previewService.extendPreview(1, 1, 24)).rejects.toThrow('Preview not found');
        });

        it('should extend preview lifetime', async () => {
            const currentExpires = new Date();
            const mockPreview = {
                id: 1,
                preview_hash: 'hash123',
                expires_at: currentExpires
            };

            const updatedPreview = {
                ...mockPreview,
                expires_at: new Date(currentExpires.getTime() + 24 * 60 * 60 * 1000)
            };

            mockPool.query
                .mockResolvedValueOnce([[mockPreview]]) // SELECT
                .mockResolvedValueOnce([]) // UPDATE
                .mockResolvedValueOnce([[updatedPreview]]); // SELECT updated

            const result = await previewService.extendPreview(1, 1, 24);

            expect(result).toEqual(updatedPreview);
            expect(mockPool.query).toHaveBeenCalledWith(
                'UPDATE preview_environments SET expires_at = ? WHERE id = ?',
                expect.any(Array)
            );
        });

        it('should use default 24 hours when not specified', async () => {
            const currentExpires = new Date();
            const mockPreview = { id: 1, preview_hash: 'hash123', expires_at: currentExpires };

            mockPool.query
                .mockResolvedValueOnce([[mockPreview]])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([[mockPreview]]);

            await previewService.extendPreview(1, 1);

            const updateCall = mockPool.query.mock.calls[1];
            const newExpires = updateCall[1][0];
            const expectedMs = 24 * 60 * 60 * 1000;
            const actualDiff = newExpires.getTime() - currentExpires.getTime();

            expect(actualDiff).toBe(expectedMs);
        });
    });

    describe('cleanupExpiredPreviews', () => {
        it('should return 0 when no expired previews', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            const result = await previewService.cleanupExpiredPreviews();

            expect(result).toBe(0);
        });

        it('should cleanup expired previews', async () => {
            const expiredPreviews = [
                { id: 1, container_id: 'container-1', assigned_port: 10000, preview_hash: 'hash1' },
                { id: 2, container_id: 'container-2', assigned_port: 10001, preview_hash: 'hash2' }
            ];

            mockPool.query
                .mockResolvedValueOnce([expiredPreviews])
                .mockResolvedValue([]);

            mockContainer.stop.mockResolvedValue();
            mockContainer.remove.mockResolvedValue();

            const result = await previewService.cleanupExpiredPreviews();

            expect(result).toBe(2);
            expect(mockPortManager.releasePort).toHaveBeenCalledTimes(2);
        });

        it('should continue cleanup even if one fails', async () => {
            const expiredPreviews = [
                { id: 1, container_id: 'container-1', assigned_port: 10000, preview_hash: 'hash1' },
                { id: 2, container_id: 'container-2', assigned_port: 10001, preview_hash: 'hash2' }
            ];

            mockPool.query
                .mockResolvedValueOnce([expiredPreviews])
                .mockResolvedValueOnce([]) // First update fails
                .mockRejectedValueOnce(new Error('Update failed'))
                .mockResolvedValue([]);

            // First container fails
            mockContainer.stop
                .mockRejectedValueOnce(new Error('Container gone'))
                .mockResolvedValueOnce();

            mockContainer.remove.mockResolvedValue();

            const result = await previewService.cleanupExpiredPreviews();

            // Should still clean up the second one
            expect(result).toBeGreaterThanOrEqual(1);
        });

        it('should return 0 on database error', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Database error'));

            const result = await previewService.cleanupExpiredPreviews();

            expect(result).toBe(0);
        });
    });

    describe('createPreview', () => {
        it('should throw error when workspace not found', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            await expect(previewService.createPreview(1, 1)).rejects.toThrow('Workspace not found');
        });

        it('should throw error when max previews reached', async () => {
            mockPool.query
                .mockResolvedValueOnce([[{ id: 1, project_name: 'test' }]]) // Workspace found
                .mockResolvedValueOnce([[{ count: 3 }]]); // Max previews

            await expect(previewService.createPreview(1, 1)).rejects.toThrow('Maximum 3 previews');
        });

        it('should create preview successfully', async () => {
            const mockWorkspace = { id: 1, project_name: 'test-project', internal_port: 3000 };
            const mockPreviewResult = { insertId: 1 };
            const mockPreview = { id: 1, preview_hash: 'hash123', status: 'running' };

            mockPool.query
                .mockResolvedValueOnce([[mockWorkspace]]) // Workspace
                .mockResolvedValueOnce([[{ count: 0 }]]) // Preview count
                .mockResolvedValueOnce([mockPreviewResult]) // INSERT
                .mockResolvedValueOnce([]) // UPDATE
                .mockResolvedValueOnce([[mockPreview]]); // SELECT

            mockPortManager.allocatePort.mockResolvedValue(10000);
            mockDocker.createContainer.mockResolvedValue({
                id: 'container-123',
                start: jest.fn().mockResolvedValue()
            });

            const result = await previewService.createPreview(1, 1);

            expect(result).toEqual(mockPreview);
            expect(mockPortManager.allocatePort).toHaveBeenCalled();
        });

        it('should hash password when provided', async () => {
            const bcrypt = require('bcrypt');
            const mockWorkspace = { id: 1, project_name: 'test-project' };

            mockPool.query
                .mockResolvedValueOnce([[mockWorkspace]])
                .mockResolvedValueOnce([[{ count: 0 }]])
                .mockResolvedValueOnce([{ insertId: 1 }])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([[{ id: 1 }]]);

            mockPortManager.allocatePort.mockResolvedValue(10000);
            mockDocker.createContainer.mockResolvedValue({
                id: 'container-123',
                start: jest.fn().mockResolvedValue()
            });

            await previewService.createPreview(1, 1, { password: 'secret123' });

            expect(bcrypt.hash).toHaveBeenCalledWith('secret123', 10);
        });
    });

    describe('getPreviewsForWorkspaces', () => {
        it('should return empty map when no workspaceIds provided', async () => {
            const result = await previewService.getPreviewsForWorkspaces([], 1);

            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(0);
        });

        it('should return empty map when workspaceIds is null', async () => {
            const result = await previewService.getPreviewsForWorkspaces(null, 1);

            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(0);
        });

        it('should return previews grouped by workspace_id', async () => {
            const mockPreviews = [
                { id: 1, workspace_id: 10, preview_hash: 'hash1' },
                { id: 2, workspace_id: 10, preview_hash: 'hash2' },
                { id: 3, workspace_id: 20, preview_hash: 'hash3' }
            ];

            mockPool.query.mockResolvedValueOnce([mockPreviews]);

            const result = await previewService.getPreviewsForWorkspaces([10, 20, 30], 1);

            expect(result).toBeInstanceOf(Map);
            expect(result.get(10)).toHaveLength(2);
            expect(result.get(20)).toHaveLength(1);
            expect(result.get(30)).toHaveLength(0); // No previews for workspace 30
        });

        it('should initialize empty arrays for all requested workspace IDs', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            const result = await previewService.getPreviewsForWorkspaces([1, 2, 3], 1);

            expect(result.get(1)).toEqual([]);
            expect(result.get(2)).toEqual([]);
            expect(result.get(3)).toEqual([]);
        });

        it('should return empty map on database error', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Database error'));

            const result = await previewService.getPreviewsForWorkspaces([1, 2], 1);

            expect(result).toBeInstanceOf(Map);
            expect(result.get(1)).toEqual([]);
            expect(result.get(2)).toEqual([]);
        });
    });

    describe('getPreviewCountsForWorkspaces', () => {
        it('should return empty map when no workspaceIds provided', async () => {
            const result = await previewService.getPreviewCountsForWorkspaces([], 1);

            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(0);
        });

        it('should return counts grouped by workspace_id', async () => {
            const mockCounts = [
                { workspace_id: 10, count: 3 },
                { workspace_id: 20, count: 1 }
            ];

            mockPool.query.mockResolvedValueOnce([mockCounts]);

            const result = await previewService.getPreviewCountsForWorkspaces([10, 20, 30], 1);

            expect(result).toBeInstanceOf(Map);
            expect(result.get(10)).toBe(3);
            expect(result.get(20)).toBe(1);
            expect(result.get(30)).toBe(0); // No previews for workspace 30
        });

        it('should initialize zeros for all requested workspace IDs', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            const result = await previewService.getPreviewCountsForWorkspaces([1, 2, 3], 1);

            expect(result.get(1)).toBe(0);
            expect(result.get(2)).toBe(0);
            expect(result.get(3)).toBe(0);
        });

        it('should return zeros on database error', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Database error'));

            const result = await previewService.getPreviewCountsForWorkspaces([1, 2], 1);

            expect(result).toBeInstanceOf(Map);
            expect(result.get(1)).toBe(0);
            expect(result.get(2)).toBe(0);
        });
    });
});
