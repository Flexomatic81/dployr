/**
 * Tests for AppError class hierarchy
 */

const {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    DatabaseError,
    ExternalServiceError,
    RateLimitError,
    DockerError,
    isAppError,
    wrapError
} = require('../../src/errors/AppError');

describe('AppError', () => {
    describe('Base AppError', () => {
        it('should create error with default values', () => {
            const error = new AppError('Test error');

            expect(error.message).toBe('Test error');
            expect(error.statusCode).toBe(500);
            expect(error.code).toBe('INTERNAL_ERROR');
            expect(error.details).toEqual({});
            expect(error.isOperational).toBe(true);
            expect(error.name).toBe('AppError');
            expect(error.timestamp).toBeDefined();
        });

        it('should create error with custom values', () => {
            const error = new AppError('Custom error', 418, 'TEAPOT_ERROR', { foo: 'bar' });

            expect(error.message).toBe('Custom error');
            expect(error.statusCode).toBe(418);
            expect(error.code).toBe('TEAPOT_ERROR');
            expect(error.details).toEqual({ foo: 'bar' });
        });

        it('should have stack trace', () => {
            const error = new AppError('Test');

            expect(error.stack).toBeDefined();
            expect(error.stack).toContain('AppError');
        });

        it('should be instanceof Error', () => {
            const error = new AppError('Test');

            expect(error instanceof Error).toBe(true);
            expect(error instanceof AppError).toBe(true);
        });
    });

    describe('toJSON', () => {
        it('should return JSON representation without stack', () => {
            const error = new AppError('Test error', 400, 'TEST_ERROR');
            const json = error.toJSON();

            expect(json.error.name).toBe('AppError');
            expect(json.error.message).toBe('Test error');
            expect(json.error.code).toBe('TEST_ERROR');
            expect(json.error.statusCode).toBe(400);
            expect(json.error.timestamp).toBeDefined();
            expect(json.error.stack).toBeUndefined();
        });

        it('should include stack when requested', () => {
            const error = new AppError('Test error');
            const json = error.toJSON(true);

            expect(json.error.stack).toBeDefined();
        });

        it('should include details when present', () => {
            const error = new AppError('Test', 400, 'TEST', { field: 'value' });
            const json = error.toJSON();

            expect(json.error.details).toEqual({ field: 'value' });
        });
    });

    describe('toResponse', () => {
        it('should return full error in development mode', () => {
            const error = new AppError('Test error', 400, 'TEST_ERROR');
            const response = error.toResponse(true);

            expect(response.error.message).toBe('Test error');
            expect(response.error.stack).toBeDefined();
        });

        it('should return sanitized error in production mode', () => {
            const error = new AppError('Test error', 400, 'TEST_ERROR');
            const response = error.toResponse(false);

            expect(response.error.message).toBe('Test error');
            expect(response.error.code).toBe('TEST_ERROR');
            expect(response.error.stack).toBeUndefined();
        });

        it('should hide message for non-operational errors in production', () => {
            const error = new AppError('Internal details');
            error.isOperational = false;
            const response = error.toResponse(false);

            expect(response.error.message).toBe('An unexpected error occurred');
        });
    });
});

describe('ValidationError', () => {
    it('should create with default message', () => {
        const error = new ValidationError();

        expect(error.message).toBe('Validation failed');
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('should create with field errors', () => {
        const error = new ValidationError('Invalid input', {
            email: 'Invalid email format',
            password: 'Password too short'
        });

        expect(error.fields).toEqual({
            email: 'Invalid email format',
            password: 'Password too short'
        });
        expect(error.details.fields).toEqual({
            email: 'Invalid email format',
            password: 'Password too short'
        });
    });

    it('should create from Joi error', () => {
        const joiError = {
            details: [
                { path: ['email'], message: 'Email is required' },
                { path: ['user', 'name'], message: 'Name is required' }
            ]
        };

        const error = ValidationError.fromJoi(joiError);

        expect(error.fields).toEqual({
            'email': 'Email is required',
            'user.name': 'Name is required'
        });
    });

    it('should handle empty Joi error', () => {
        const error = ValidationError.fromJoi({});

        expect(error.fields).toEqual({});
    });
});

describe('AuthenticationError', () => {
    it('should create with default message', () => {
        const error = new AuthenticationError();

        expect(error.message).toBe('Authentication required');
        expect(error.statusCode).toBe(401);
        expect(error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('should create with custom message', () => {
        const error = new AuthenticationError('Invalid token');

        expect(error.message).toBe('Invalid token');
    });
});

describe('AuthorizationError', () => {
    it('should create with default message', () => {
        const error = new AuthorizationError();

        expect(error.message).toBe('Permission denied');
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe('AUTHORIZATION_ERROR');
    });

    it('should include required permission', () => {
        const error = new AuthorizationError('Cannot edit', 'project:edit');

        expect(error.details.requiredPermission).toBe('project:edit');
    });
});

describe('NotFoundError', () => {
    it('should create with resource name', () => {
        const error = new NotFoundError('Project');

        expect(error.message).toBe('Project not found');
        expect(error.statusCode).toBe(404);
        expect(error.code).toBe('NOT_FOUND');
        expect(error.resource).toBe('Project');
    });

    it('should include identifier', () => {
        const error = new NotFoundError('User', 'john@example.com');

        expect(error.message).toBe("User 'john@example.com' not found");
        expect(error.identifier).toBe('john@example.com');
    });
});

describe('ConflictError', () => {
    it('should create with default message', () => {
        const error = new ConflictError();

        expect(error.message).toBe('Resource conflict');
        expect(error.statusCode).toBe(409);
        expect(error.code).toBe('CONFLICT_ERROR');
    });

    it('should include resource type', () => {
        const error = new ConflictError('Project already exists', 'Project');

        expect(error.details.resource).toBe('Project');
    });
});

describe('DatabaseError', () => {
    it('should create with default message', () => {
        const error = new DatabaseError();

        expect(error.message).toBe('Database operation failed');
        expect(error.statusCode).toBe(500);
        expect(error.code).toBe('DATABASE_ERROR');
    });

    it('should include operation and original error', () => {
        const originalError = new Error('Connection refused');
        const error = new DatabaseError('Query failed', 'SELECT', originalError);

        expect(error.operation).toBe('SELECT');
        expect(error.originalError).toBe(originalError);
        expect(error.details.operation).toBe('SELECT');
    });
});

describe('ExternalServiceError', () => {
    it('should create with service name', () => {
        const error = new ExternalServiceError('GitHub API');

        expect(error.message).toBe('External service error');
        expect(error.statusCode).toBe(502);
        expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
        expect(error.service).toBe('GitHub API');
        expect(error.details.service).toBe('GitHub API');
    });

    it('should include custom message and original error', () => {
        const originalError = new Error('Timeout');
        const error = new ExternalServiceError('Docker', 'Container start timeout', originalError);

        expect(error.message).toBe('Container start timeout');
        expect(error.originalError).toBe(originalError);
    });
});

describe('RateLimitError', () => {
    it('should create with default retry time', () => {
        const error = new RateLimitError();

        expect(error.message).toBe('Too many requests');
        expect(error.statusCode).toBe(429);
        expect(error.code).toBe('RATE_LIMIT_ERROR');
        expect(error.retryAfter).toBe(60);
    });

    it('should include custom retry time', () => {
        const error = new RateLimitError(120);

        expect(error.retryAfter).toBe(120);
        expect(error.details.retryAfter).toBe(120);
    });
});

describe('DockerError', () => {
    it('should create with operation', () => {
        const error = new DockerError('start');

        expect(error.message).toBe('Docker start failed');
        expect(error.statusCode).toBe(500);
        expect(error.code).toBe('DOCKER_ERROR');
        expect(error.operation).toBe('start');
    });

    it('should include container ID', () => {
        const error = new DockerError('stop', 'abc123');

        expect(error.message).toBe('Docker stop failed for container abc123');
        expect(error.containerId).toBe('abc123');
    });

    it('should include original error', () => {
        const originalError = new Error('Container not found');
        const error = new DockerError('remove', null, originalError);

        expect(error.originalError).toBe(originalError);
    });
});

describe('isAppError', () => {
    it('should return true for AppError instances', () => {
        expect(isAppError(new AppError('Test'))).toBe(true);
        expect(isAppError(new ValidationError())).toBe(true);
        expect(isAppError(new NotFoundError('Resource'))).toBe(true);
    });

    it('should return false for non-AppError', () => {
        expect(isAppError(new Error('Test'))).toBe(false);
        expect(isAppError(new TypeError('Test'))).toBe(false);
        expect(isAppError(null)).toBe(false);
        expect(isAppError(undefined)).toBe(false);
    });

    it('should return false for non-operational AppError', () => {
        const error = new AppError('Test');
        error.isOperational = false;

        expect(isAppError(error)).toBe(false);
    });
});

describe('wrapError', () => {
    it('should return AppError instances unchanged', () => {
        const original = new ValidationError('Invalid');
        const wrapped = wrapError(original);

        expect(wrapped).toBe(original);
    });

    it('should wrap regular Error', () => {
        const original = new Error('Something went wrong');
        const wrapped = wrapError(original);

        expect(wrapped instanceof AppError).toBe(true);
        expect(wrapped.message).toBe('Something went wrong');
        expect(wrapped.code).toBe('UNEXPECTED_ERROR');
        expect(wrapped.isOperational).toBe(false);
        expect(wrapped.originalError).toBe(original);
    });

    it('should use default message for errors without message', () => {
        const original = new Error();
        const wrapped = wrapError(original, 'Default message');

        expect(wrapped.message).toBe('Default message');
    });
});
