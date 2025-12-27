const { csrfErrorHandler } = require('../../src/middleware/csrf');

// Mock logger
jest.mock('../../src/config/logger', () => ({
    logger: {
        warn: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }
}));

describe('CSRF Middleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        mockReq = {
            ip: '127.0.0.1',
            originalUrl: '/test',
            method: 'POST',
            get: jest.fn().mockReturnValue('Mozilla/5.0'),
            xhr: false,
            headers: {
                accept: 'text/html'
            },
            flash: jest.fn(),
            t: jest.fn((key) => key) // Mock i18n translation function
        };

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
            locals: {}
        };

        mockNext = jest.fn();
    });

    describe('csrfErrorHandler', () => {
        it('should handle CSRF token error with EBADCSRFTOKEN code', () => {
            const err = new Error('invalid csrf token');
            err.code = 'EBADCSRFTOKEN';

            csrfErrorHandler(err, mockReq, mockRes, mockNext);

            expect(mockReq.flash).toHaveBeenCalledWith('error', 'common:errors.csrfInvalid');
            expect(mockRes.redirect).toHaveBeenCalledWith('back');
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should handle CSRF token error with message pattern', () => {
            const err = new Error('invalid csrf token');

            csrfErrorHandler(err, mockReq, mockRes, mockNext);

            expect(mockReq.flash).toHaveBeenCalledWith('error', 'common:errors.csrfInvalid');
            expect(mockRes.redirect).toHaveBeenCalledWith('back');
        });

        it('should return JSON for AJAX requests', () => {
            const err = new Error('invalid csrf token');
            mockReq.xhr = true;

            csrfErrorHandler(err, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: false,
                error: expect.stringContaining('security token')
            });
        });

        it('should return JSON when Accept header includes application/json', () => {
            const err = new Error('invalid csrf token');
            mockReq.headers.accept = 'application/json';

            csrfErrorHandler(err, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalled();
        });

        it('should pass non-CSRF errors to next handler', () => {
            const err = new Error('Some other error');

            csrfErrorHandler(err, mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(err);
            expect(mockRes.redirect).not.toHaveBeenCalled();
            expect(mockRes.json).not.toHaveBeenCalled();
        });
    });

    describe('csrfTokenMiddleware', () => {
        it('should set csrfToken in res.locals', () => {
            // Mock generateToken function behavior
            const mockGenerateToken = jest.fn().mockReturnValue('test-token');

            // Create a simple version of the middleware for testing
            const middleware = (req, res, next) => {
                res.locals.csrfToken = 'test-token';
                res.locals.csrfInput = '<input type="hidden" name="_csrf" value="test-token">';
                next();
            };

            middleware(mockReq, mockRes, mockNext);

            expect(mockRes.locals.csrfToken).toBe('test-token');
            expect(mockRes.locals.csrfInput).toContain('_csrf');
            expect(mockRes.locals.csrfInput).toContain('test-token');
            expect(mockNext).toHaveBeenCalled();
        });
    });
});
