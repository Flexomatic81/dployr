// Mock the database before requiring auth middleware
jest.mock('../../src/config/database', () => ({
    pool: {
        query: jest.fn()
    }
}));

const { requireAuth, requireAdmin, redirectIfAuth, setUserLocals } = require('../../src/middleware/auth');

describe('Auth Middleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        mockReq = {
            session: {},
            flash: jest.fn(),
            t: jest.fn((key) => key) // Mock i18n translation function
        };
        mockRes = {
            redirect: jest.fn(),
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            locals: {}
        };
        mockNext = jest.fn();
    });

    describe('requireAuth', () => {
        it('should call next when user is authenticated', () => {
            mockReq.session.user = { id: 1, username: 'testuser' };

            requireAuth(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockRes.redirect).not.toHaveBeenCalled();
        });

        it('should redirect to login when user is not authenticated', () => {
            mockReq.session.user = null;

            requireAuth(mockReq, mockRes, mockNext);

            expect(mockNext).not.toHaveBeenCalled();
            expect(mockReq.flash).toHaveBeenCalledWith('error', expect.any(String));
            expect(mockRes.redirect).toHaveBeenCalledWith('/login');
        });

        it('should redirect to login when session does not exist', () => {
            mockReq.session = undefined;

            requireAuth(mockReq, mockRes, mockNext);

            expect(mockNext).not.toHaveBeenCalled();
            expect(mockRes.redirect).toHaveBeenCalledWith('/login');
        });
    });

    describe('requireAdmin', () => {
        it('should call next when user is admin', () => {
            mockReq.session.user = { id: 1, username: 'admin', is_admin: true };

            requireAdmin(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockRes.redirect).not.toHaveBeenCalled();
        });

        it('should redirect to dashboard when user is not admin', () => {
            mockReq.session.user = { id: 1, username: 'user', is_admin: false };

            requireAdmin(mockReq, mockRes, mockNext);

            expect(mockNext).not.toHaveBeenCalled();
            expect(mockReq.flash).toHaveBeenCalledWith('error', expect.any(String));
            expect(mockRes.redirect).toHaveBeenCalledWith('/dashboard');
        });

        it('should redirect to dashboard when not authenticated', () => {
            mockReq.session.user = null;

            requireAdmin(mockReq, mockRes, mockNext);

            expect(mockNext).not.toHaveBeenCalled();
            // Note: requireAdmin redirects to /dashboard, requireAuth handles login redirect
            expect(mockRes.redirect).toHaveBeenCalledWith('/dashboard');
        });
    });

    describe('redirectIfAuth', () => {
        it('should redirect to dashboard when user is authenticated', () => {
            mockReq.session.user = { id: 1, username: 'testuser' };

            redirectIfAuth(mockReq, mockRes, mockNext);

            expect(mockNext).not.toHaveBeenCalled();
            expect(mockRes.redirect).toHaveBeenCalledWith('/dashboard');
        });

        it('should call next when user is not authenticated', () => {
            mockReq.session.user = null;

            redirectIfAuth(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockRes.redirect).not.toHaveBeenCalled();
        });
    });

    describe('setUserLocals', () => {
        it('should set user in res.locals when authenticated', () => {
            const user = { id: 1, username: 'testuser', is_admin: false };
            mockReq.session.user = user;

            setUserLocals(mockReq, mockRes, mockNext);

            expect(mockRes.locals.user).toEqual(user);
            expect(mockNext).toHaveBeenCalled();
        });

        it('should set user to null when not authenticated', () => {
            mockReq.session.user = null;

            setUserLocals(mockReq, mockRes, mockNext);

            expect(mockRes.locals.user).toBeNull();
            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle missing session gracefully', () => {
            mockReq.session = undefined;

            setUserLocals(mockReq, mockRes, mockNext);

            expect(mockRes.locals.user).toBeNull();
            expect(mockNext).toHaveBeenCalled();
        });
    });
});
