/**
 * Project Access Middleware Tests
 */

// Mock services before requiring middleware
jest.mock('../../src/services/project', () => ({
    getProjectInfo: jest.fn()
}));

jest.mock('../../src/services/sharing', () => ({
    getShareInfoByProjectName: jest.fn()
}));

const projectService = require('../../src/services/project');
const sharingService = require('../../src/services/sharing');
const { getProjectAccess, requirePermission, PERMISSION_LEVELS } = require('../../src/middleware/projectAccess');

describe('Project Access Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            params: { name: 'test-project' },
            session: {
                user: {
                    id: 1,
                    system_username: 'testuser'
                }
            },
            flash: jest.fn(),
            t: jest.fn(key => key)
        };
        res = {
            redirect: jest.fn()
        };
        next = jest.fn();

        jest.clearAllMocks();
    });

    describe('PERMISSION_LEVELS', () => {
        it('should export permission levels', () => {
            expect(PERMISSION_LEVELS).toEqual({
                read: 1,
                manage: 2,
                full: 3
            });
        });
    });

    describe('getProjectAccess', () => {
        it('should set projectAccess for own project', async () => {
            const mockProject = {
                name: 'test-project',
                type: 'nodejs',
                port: 3001
            };
            projectService.getProjectInfo.mockResolvedValue(mockProject);

            const middleware = getProjectAccess();
            await middleware(req, res, next);

            expect(projectService.getProjectInfo).toHaveBeenCalledWith('testuser', 'test-project');
            expect(req.projectAccess).toEqual({
                isOwner: true,
                permission: 'owner',
                project: mockProject,
                systemUsername: 'testuser'
            });
            expect(next).toHaveBeenCalled();
            expect(res.redirect).not.toHaveBeenCalled();
        });

        it('should set projectAccess for shared project', async () => {
            // Own project not found
            projectService.getProjectInfo
                .mockResolvedValueOnce(null) // First call - own project
                .mockResolvedValueOnce({ // Second call - shared project
                    name: 'test-project',
                    type: 'php',
                    port: 80
                });

            sharingService.getShareInfoByProjectName.mockResolvedValue({
                permission: 'manage',
                owner_system_username: 'owner_user',
                owner_username: 'owner',
                owner_id: 2
            });

            const middleware = getProjectAccess();
            await middleware(req, res, next);

            expect(sharingService.getShareInfoByProjectName).toHaveBeenCalledWith(1, 'test-project');
            expect(req.projectAccess).toEqual({
                isOwner: false,
                permission: 'manage',
                ownerSystemUsername: 'owner_user',
                ownerUsername: 'owner',
                ownerId: 2,
                project: { name: 'test-project', type: 'php', port: 80 },
                systemUsername: 'owner_user'
            });
            expect(next).toHaveBeenCalled();
        });

        it('should redirect when no access to project', async () => {
            projectService.getProjectInfo.mockResolvedValue(null);
            sharingService.getShareInfoByProjectName.mockResolvedValue(null);

            const middleware = getProjectAccess();
            await middleware(req, res, next);

            expect(req.flash).toHaveBeenCalledWith('error', 'projects:errors.notFound');
            expect(res.redirect).toHaveBeenCalledWith('/projects');
            expect(next).not.toHaveBeenCalled();
        });

        it('should redirect when shared project info not found', async () => {
            projectService.getProjectInfo
                .mockResolvedValueOnce(null) // First call - own project
                .mockResolvedValueOnce(null); // Second call - shared project (not found)

            sharingService.getShareInfoByProjectName.mockResolvedValue({
                permission: 'read',
                owner_system_username: 'owner_user',
                owner_username: 'owner',
                owner_id: 2
            });

            const middleware = getProjectAccess();
            await middleware(req, res, next);

            expect(req.flash).toHaveBeenCalledWith('error', 'projects:errors.notFound');
            expect(res.redirect).toHaveBeenCalledWith('/projects');
            expect(next).not.toHaveBeenCalled();
        });

        it('should use custom param name', async () => {
            req.params = { projectName: 'custom-project' };
            projectService.getProjectInfo.mockResolvedValue({ name: 'custom-project' });

            const middleware = getProjectAccess('projectName');
            await middleware(req, res, next);

            expect(projectService.getProjectInfo).toHaveBeenCalledWith('testuser', 'custom-project');
            expect(next).toHaveBeenCalled();
        });

        it('should handle errors gracefully', async () => {
            projectService.getProjectInfo.mockRejectedValue(new Error('Database error'));

            const middleware = getProjectAccess();
            await middleware(req, res, next);

            expect(req.flash).toHaveBeenCalledWith('error', 'projects:errors.loadError');
            expect(res.redirect).toHaveBeenCalledWith('/projects');
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('requirePermission', () => {
        it('should allow owner for any permission level', () => {
            req.projectAccess = {
                isOwner: true,
                permission: 'owner'
            };

            const middleware = requirePermission('full');
            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.redirect).not.toHaveBeenCalled();
        });

        it('should allow user with sufficient permission', () => {
            req.projectAccess = {
                isOwner: false,
                permission: 'full'
            };

            const middleware = requirePermission('manage');
            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.redirect).not.toHaveBeenCalled();
        });

        it('should allow user with exact permission', () => {
            req.projectAccess = {
                isOwner: false,
                permission: 'manage'
            };

            const middleware = requirePermission('manage');
            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('should deny user with insufficient permission', () => {
            req.projectAccess = {
                isOwner: false,
                permission: 'read'
            };

            const middleware = requirePermission('manage');
            middleware(req, res, next);

            expect(req.flash).toHaveBeenCalledWith('error', 'projects:errors.noPermission');
            expect(res.redirect).toHaveBeenCalledWith('/projects/test-project');
            expect(next).not.toHaveBeenCalled();
        });

        it('should redirect when projectAccess is missing', () => {
            req.projectAccess = null;

            const middleware = requirePermission('read');
            middleware(req, res, next);

            expect(req.flash).toHaveBeenCalledWith('error', 'projects:errors.noAccess');
            expect(res.redirect).toHaveBeenCalledWith('/projects');
            expect(next).not.toHaveBeenCalled();
        });

        it('should use projectName param if name not available', () => {
            req.params = { projectName: 'other-project' };
            req.projectAccess = {
                isOwner: false,
                permission: 'read'
            };

            const middleware = requirePermission('full');
            middleware(req, res, next);

            expect(res.redirect).toHaveBeenCalledWith('/projects/other-project');
        });

        it('should handle unknown permission level', () => {
            req.projectAccess = {
                isOwner: false,
                permission: 'unknown'
            };

            const middleware = requirePermission('read');
            middleware(req, res, next);

            // Unknown permission defaults to 0, which is less than read (1)
            expect(res.redirect).toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
        });

        describe('permission level hierarchy', () => {
            it('should allow full to access read', () => {
                req.projectAccess = { isOwner: false, permission: 'full' };
                requirePermission('read')(req, res, next);
                expect(next).toHaveBeenCalled();
            });

            it('should allow full to access manage', () => {
                req.projectAccess = { isOwner: false, permission: 'full' };
                requirePermission('manage')(req, res, next);
                expect(next).toHaveBeenCalled();
            });

            it('should allow manage to access read', () => {
                req.projectAccess = { isOwner: false, permission: 'manage' };
                requirePermission('read')(req, res, next);
                expect(next).toHaveBeenCalled();
            });

            it('should deny read to access manage', () => {
                req.projectAccess = { isOwner: false, permission: 'read' };
                requirePermission('manage')(req, res, next);
                expect(next).not.toHaveBeenCalled();
            });

            it('should deny read to access full', () => {
                req.projectAccess = { isOwner: false, permission: 'read' };
                requirePermission('full')(req, res, next);
                expect(next).not.toHaveBeenCalled();
            });

            it('should deny manage to access full', () => {
                req.projectAccess = { isOwner: false, permission: 'manage' };
                requirePermission('full')(req, res, next);
                expect(next).not.toHaveBeenCalled();
            });
        });
    });
});
