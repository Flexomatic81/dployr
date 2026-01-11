/**
 * Tests for Workspace Access Middleware
 */

// Mock workspace service
const mockWorkspaceService = {
    getWorkspace: jest.fn()
};

jest.mock('../../src/services/workspace', () => mockWorkspaceService);

// Mock project access middleware
const mockProjectAccess = {
    getProjectAccess: jest.fn(() => (req, res, next) => next()),
    requirePermission: jest.fn(() => (req, res, next) => next())
};

jest.mock('../../src/middleware/projectAccess', () => mockProjectAccess);

// Mock logger
jest.mock('../../src/config/logger', () => ({
    logger: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

const {
    getWorkspaceAccess,
    requireWorkspace,
    requireRunningWorkspace,
    requireWorkspacePermission
} = require('../../src/middleware/workspaceAccess');

describe('Workspace Access Middleware', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
        jest.clearAllMocks();

        mockReq = {
            params: { projectName: 'test-project' },
            session: { user: { id: 1 } },
            flash: jest.fn(),
            t: jest.fn(key => key)
        };

        mockRes = {
            redirect: jest.fn()
        };

        mockNext = jest.fn();
    });

    describe('getWorkspaceAccess', () => {
        it('should return array of middleware functions', () => {
            const middleware = getWorkspaceAccess();
            expect(Array.isArray(middleware)).toBe(true);
            expect(middleware.length).toBe(2);
        });

        it('should set workspace on request when found', async () => {
            const testWorkspace = { id: 1, status: 'running' };
            mockWorkspaceService.getWorkspace.mockResolvedValue(testWorkspace);

            const middleware = getWorkspaceAccess();
            // Execute second middleware (first is getProjectAccess)
            await middleware[1](mockReq, mockRes, mockNext);

            expect(mockReq.workspace).toEqual(testWorkspace);
            expect(mockNext).toHaveBeenCalled();
        });

        it('should set workspace to null when not found', async () => {
            mockWorkspaceService.getWorkspace.mockResolvedValue(null);

            const middleware = getWorkspaceAccess();
            await middleware[1](mockReq, mockRes, mockNext);

            expect(mockReq.workspace).toBeNull();
            expect(mockNext).toHaveBeenCalled();
        });

        it('should redirect on error', async () => {
            mockWorkspaceService.getWorkspace.mockRejectedValue(new Error('Database error'));

            const middleware = getWorkspaceAccess();
            await middleware[1](mockReq, mockRes, mockNext);

            expect(mockReq.flash).toHaveBeenCalledWith('error', 'workspaces:errors.loadError');
            expect(mockRes.redirect).toHaveBeenCalledWith('/workspaces');
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should use custom param name', async () => {
            mockReq.params = { name: 'custom-project' };
            mockWorkspaceService.getWorkspace.mockResolvedValue({ id: 1 });

            const middleware = getWorkspaceAccess('name');
            await middleware[1](mockReq, mockRes, mockNext);

            expect(mockWorkspaceService.getWorkspace).toHaveBeenCalledWith(1, 'custom-project');
        });
    });

    describe('requireWorkspace', () => {
        it('should call next when workspace exists', () => {
            mockReq.workspace = { id: 1 };

            requireWorkspace(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockRes.redirect).not.toHaveBeenCalled();
        });

        it('should redirect when workspace does not exist', () => {
            mockReq.workspace = null;

            requireWorkspace(mockReq, mockRes, mockNext);

            expect(mockReq.flash).toHaveBeenCalledWith('error', 'workspaces:errors.notFound');
            expect(mockRes.redirect).toHaveBeenCalled();
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should redirect to project page with projectName param', () => {
            mockReq.workspace = null;
            mockReq.params = { projectName: 'my-project' };

            requireWorkspace(mockReq, mockRes, mockNext);

            expect(mockRes.redirect).toHaveBeenCalledWith('/projects/my-project');
        });

        it('should redirect to project page with name param as fallback', () => {
            mockReq.workspace = null;
            mockReq.params = { name: 'my-project' };

            requireWorkspace(mockReq, mockRes, mockNext);

            expect(mockRes.redirect).toHaveBeenCalledWith('/projects/my-project');
        });
    });

    describe('requireRunningWorkspace', () => {
        it('should call next when workspace is running', () => {
            mockReq.workspace = { id: 1, status: 'running' };

            requireRunningWorkspace(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockRes.redirect).not.toHaveBeenCalled();
        });

        it('should redirect when workspace is not running', () => {
            mockReq.workspace = { id: 1, status: 'stopped' };

            requireRunningWorkspace(mockReq, mockRes, mockNext);

            expect(mockReq.flash).toHaveBeenCalledWith('error', 'workspaces:errors.notRunning');
            expect(mockRes.redirect).toHaveBeenCalled();
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should redirect when workspace does not exist', () => {
            mockReq.workspace = null;

            requireRunningWorkspace(mockReq, mockRes, mockNext);

            expect(mockReq.flash).toHaveBeenCalledWith('error', 'workspaces:errors.notRunning');
            expect(mockRes.redirect).toHaveBeenCalled();
        });

        it('should redirect to workspace page', () => {
            mockReq.workspace = { id: 1, status: 'stopped' };
            mockReq.params = { projectName: 'my-project' };

            requireRunningWorkspace(mockReq, mockRes, mockNext);

            expect(mockRes.redirect).toHaveBeenCalledWith('/workspaces/my-project');
        });
    });

    describe('requireWorkspacePermission', () => {
        it('should allow owner access', () => {
            mockReq.projectAccess = { isOwner: true };

            requireWorkspacePermission(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockRes.redirect).not.toHaveBeenCalled();
        });

        it('should allow manage permission', () => {
            mockReq.projectAccess = { isOwner: false, permission: 'manage' };

            requireWorkspacePermission(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should allow full permission', () => {
            mockReq.projectAccess = { isOwner: false, permission: 'full' };

            requireWorkspacePermission(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should deny read-only permission', () => {
            mockReq.projectAccess = { isOwner: false, permission: 'read' };
            mockReq.params = { projectName: 'my-project' };

            requireWorkspacePermission(mockReq, mockRes, mockNext);

            expect(mockReq.flash).toHaveBeenCalledWith('error', 'workspaces:errors.noPermission');
            expect(mockRes.redirect).toHaveBeenCalledWith('/projects/my-project');
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should redirect to project page on denial', () => {
            mockReq.projectAccess = { isOwner: false, permission: 'read' };
            mockReq.params = { name: 'my-project' };

            requireWorkspacePermission(mockReq, mockRes, mockNext);

            expect(mockRes.redirect).toHaveBeenCalledWith('/projects/my-project');
        });
    });
});
