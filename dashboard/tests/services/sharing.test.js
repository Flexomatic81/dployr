// Mock database pool
const mockPool = {
    execute: jest.fn()
};

jest.mock('../../src/config/database', () => ({
    pool: mockPool
}));

const sharingService = require('../../src/services/sharing');

describe('Sharing Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('shareProject', () => {
        it('should share a project with another user', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            const result = await sharingService.shareProject(1, 'owner', 'my-project', 2, 'read');

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO project_shares'),
                [1, 'owner', 'my-project', 2, 'read', 'read']
            );
            expect(result).toEqual({ affectedRows: 1 });
        });

        it('should throw error when sharing with yourself', async () => {
            await expect(
                sharingService.shareProject(1, 'owner', 'my-project', 1, 'read')
            ).rejects.toThrow('You cannot share a project with yourself');
        });

        it('should throw error for invalid permission', async () => {
            await expect(
                sharingService.shareProject(1, 'owner', 'my-project', 2, 'invalid')
            ).rejects.toThrow('Invalid permission');
        });

        it('should use default permission (read) if not specified', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            await sharingService.shareProject(1, 'owner', 'my-project', 2);

            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.any(String),
                [1, 'owner', 'my-project', 2, 'read', 'read']
            );
        });

        it('should accept all valid permission levels', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            for (const permission of ['read', 'manage', 'full']) {
                await sharingService.shareProject(1, 'owner', 'my-project', 2, permission);
            }

            expect(mockPool.execute).toHaveBeenCalledTimes(3);
        });
    });

    describe('unshareProject', () => {
        it('should return true when share is removed', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            const result = await sharingService.unshareProject(1, 'my-project', 2);

            expect(result).toBe(true);
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM project_shares'),
                [1, 'my-project', 2]
            );
        });

        it('should return false when no share exists', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 0 }]);

            const result = await sharingService.unshareProject(1, 'my-project', 2);

            expect(result).toBe(false);
        });
    });

    describe('updateSharePermission', () => {
        it('should update permission successfully', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

            const result = await sharingService.updateSharePermission(1, 'my-project', 2, 'manage');

            expect(result).toBe(true);
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE project_shares SET permission'),
                ['manage', 1, 'my-project', 2]
            );
        });

        it('should return false when share not found', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 0 }]);

            const result = await sharingService.updateSharePermission(1, 'my-project', 2, 'manage');

            expect(result).toBe(false);
        });

        it('should throw error for invalid permission', async () => {
            await expect(
                sharingService.updateSharePermission(1, 'my-project', 2, 'invalid')
            ).rejects.toThrow('Invalid permission');
        });
    });

    describe('getProjectShares', () => {
        it('should return all shares for a project', async () => {
            const mockShares = [
                { shared_with_id: 2, username: 'user2', permission: 'read' },
                { shared_with_id: 3, username: 'user3', permission: 'manage' }
            ];
            mockPool.execute.mockResolvedValue([mockShares]);

            const result = await sharingService.getProjectShares(1, 'my-project');

            expect(result).toEqual(mockShares);
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('JOIN dashboard_users'),
                [1, 'my-project']
            );
        });

        it('should return empty array when no shares exist', async () => {
            mockPool.execute.mockResolvedValue([[]]);

            const result = await sharingService.getProjectShares(1, 'my-project');

            expect(result).toEqual([]);
        });
    });

    describe('getSharedProjects', () => {
        it('should return all projects shared with user', async () => {
            const mockProjects = [
                { project_name: 'project1', owner_username: 'owner1', permission: 'read' },
                { project_name: 'project2', owner_username: 'owner2', permission: 'manage' }
            ];
            mockPool.execute.mockResolvedValue([mockProjects]);

            const result = await sharingService.getSharedProjects(2);

            expect(result).toEqual(mockProjects);
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('shared_with_id = ?'),
                [2]
            );
        });
    });

    describe('hasPermission', () => {
        it('should return true when user has required permission', async () => {
            mockPool.execute.mockResolvedValue([[{
                permission: 'manage'
            }]]);

            const result = await sharingService.hasPermission(2, 'owner', 'my-project', 'read');

            expect(result).toBe(true);
        });

        it('should return true when user has exact permission', async () => {
            mockPool.execute.mockResolvedValue([[{
                permission: 'read'
            }]]);

            const result = await sharingService.hasPermission(2, 'owner', 'my-project', 'read');

            expect(result).toBe(true);
        });

        it('should return false when user has lower permission', async () => {
            mockPool.execute.mockResolvedValue([[{
                permission: 'read'
            }]]);

            const result = await sharingService.hasPermission(2, 'owner', 'my-project', 'manage');

            expect(result).toBe(false);
        });

        it('should return false when no share exists', async () => {
            mockPool.execute.mockResolvedValue([[]]);

            const result = await sharingService.hasPermission(2, 'owner', 'my-project', 'read');

            expect(result).toBe(false);
        });
    });

    describe('getShareInfo', () => {
        it('should return share info when found', async () => {
            const mockShare = {
                shared_with_id: 2,
                permission: 'manage',
                owner_username: 'owner'
            };
            mockPool.execute.mockResolvedValue([[mockShare]]);

            const result = await sharingService.getShareInfo(2, 'owner', 'my-project');

            expect(result).toEqual(mockShare);
        });

        it('should return null when not found', async () => {
            mockPool.execute.mockResolvedValue([[]]);

            const result = await sharingService.getShareInfo(2, 'owner', 'nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('getShareInfoByProjectName', () => {
        it('should return share info by project name', async () => {
            const mockShare = {
                shared_with_id: 2,
                permission: 'read',
                owner_username: 'owner'
            };
            mockPool.execute.mockResolvedValue([[mockShare]]);

            const result = await sharingService.getShareInfoByProjectName(2, 'my-project');

            expect(result).toEqual(mockShare);
        });

        it('should return null when not found', async () => {
            mockPool.execute.mockResolvedValue([[]]);

            const result = await sharingService.getShareInfoByProjectName(2, 'nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('getAllUsersExcept', () => {
        it('should return all approved users except specified', async () => {
            const mockUsers = [
                { id: 2, username: 'user2', system_username: 'user2' },
                { id: 3, username: 'user3', system_username: 'user3' }
            ];
            mockPool.execute.mockResolvedValue([mockUsers]);

            const result = await sharingService.getAllUsersExcept(1);

            expect(result).toEqual(mockUsers);
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('id != ? AND approved = TRUE'),
                [1]
            );
        });
    });

    describe('deleteAllSharesForProject', () => {
        it('should delete all shares and return count', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 3 }]);

            const result = await sharingService.deleteAllSharesForProject(1, 'my-project');

            expect(result).toBe(3);
            expect(mockPool.execute).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM project_shares'),
                [1, 'my-project']
            );
        });

        it('should return 0 when no shares exist', async () => {
            mockPool.execute.mockResolvedValue([{ affectedRows: 0 }]);

            const result = await sharingService.deleteAllSharesForProject(1, 'nonexistent');

            expect(result).toBe(0);
        });
    });

    describe('Helper functions', () => {
        describe('getPermissionLabel', () => {
            it('should return correct labels', () => {
                expect(sharingService.getPermissionLabel('read')).toBe('View');
                expect(sharingService.getPermissionLabel('manage')).toBe('Manage');
                expect(sharingService.getPermissionLabel('full')).toBe('Full access');
            });

            it('should return raw permission for unknown values', () => {
                expect(sharingService.getPermissionLabel('unknown')).toBe('unknown');
            });
        });

        describe('getPermissionIcon', () => {
            it('should return correct icons', () => {
                expect(sharingService.getPermissionIcon('read')).toBe('bi-eye');
                expect(sharingService.getPermissionIcon('manage')).toBe('bi-gear');
                expect(sharingService.getPermissionIcon('full')).toBe('bi-star');
            });

            it('should return question icon for unknown values', () => {
                expect(sharingService.getPermissionIcon('unknown')).toBe('bi-question');
            });
        });
    });

    describe('PERMISSION_LEVELS export', () => {
        it('should export permission levels', () => {
            expect(sharingService.PERMISSION_LEVELS).toBeDefined();
            expect(sharingService.PERMISSION_LEVELS.read).toBeDefined();
            expect(sharingService.PERMISSION_LEVELS.manage).toBeDefined();
            expect(sharingService.PERMISSION_LEVELS.full).toBeDefined();
        });
    });
});
