/**
 * Standardized Error Handling Classes
 *
 * Provides a consistent error hierarchy for the application:
 * - AppError: Base class with HTTP status code mapping
 * - ValidationError: For input validation failures (400)
 * - AuthenticationError: For auth failures (401)
 * - AuthorizationError: For permission denied (403)
 * - NotFoundError: For missing resources (404)
 * - ConflictError: For resource conflicts (409)
 * - DatabaseError: For database operation failures (500)
 * - ExternalServiceError: For external service failures (502)
 */

/**
 * Base application error class
 * All custom errors should extend this class
 */
class AppError extends Error {
    /**
     * @param {string} message - Error message
     * @param {number} statusCode - HTTP status code (default: 500)
     * @param {string} code - Error code for programmatic handling
     * @param {object} details - Additional error details
     */
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = {}) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.isOperational = true; // Distinguishes operational errors from programming errors
        this.timestamp = new Date().toISOString();

        // Capture stack trace (excludes constructor from stack)
        Error.captureStackTrace(this, this.constructor);
    }

    /**
     * Returns a JSON-safe representation of the error
     * @param {boolean} includeStack - Whether to include stack trace
     * @returns {object}
     */
    toJSON(includeStack = false) {
        const json = {
            error: {
                name: this.name,
                message: this.message,
                code: this.code,
                statusCode: this.statusCode,
                timestamp: this.timestamp
            }
        };

        if (Object.keys(this.details).length > 0) {
            json.error.details = this.details;
        }

        if (includeStack && this.stack) {
            json.error.stack = this.stack;
        }

        return json;
    }

    /**
     * Returns a user-friendly error response
     * Hides internal details in production
     * @param {boolean} isDevelopment - Whether in development mode
     * @returns {object}
     */
    toResponse(isDevelopment = false) {
        if (isDevelopment) {
            return this.toJSON(true);
        }

        // In production, only show safe information
        return {
            error: {
                message: this.isOperational ? this.message : 'An unexpected error occurred',
                code: this.code
            }
        };
    }
}

/**
 * Validation error - Invalid input data
 * HTTP 400 Bad Request
 */
class ValidationError extends AppError {
    /**
     * @param {string} message - Error message
     * @param {object} fields - Object mapping field names to error messages
     */
    constructor(message = 'Validation failed', fields = {}) {
        super(message, 400, 'VALIDATION_ERROR', { fields });
        this.fields = fields;
    }

    /**
     * Creates a ValidationError from a Joi validation result
     * @param {object} joiError - Joi validation error object
     * @returns {ValidationError}
     */
    static fromJoi(joiError) {
        const fields = {};
        for (const detail of joiError.details || []) {
            const field = detail.path.join('.');
            fields[field] = detail.message;
        }
        return new ValidationError('Validation failed', fields);
    }
}

/**
 * Authentication error - Not authenticated
 * HTTP 401 Unauthorized
 */
class AuthenticationError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 401, 'AUTHENTICATION_ERROR');
    }
}

/**
 * Authorization error - Insufficient permissions
 * HTTP 403 Forbidden
 */
class AuthorizationError extends AppError {
    /**
     * @param {string} message - Error message
     * @param {string} requiredPermission - The permission that was required
     */
    constructor(message = 'Permission denied', requiredPermission = null) {
        super(message, 403, 'AUTHORIZATION_ERROR', requiredPermission ? { requiredPermission } : {});
    }
}

/**
 * Not found error - Resource doesn't exist
 * HTTP 404 Not Found
 */
class NotFoundError extends AppError {
    /**
     * @param {string} resource - Type of resource (e.g., 'Project', 'User')
     * @param {string} identifier - Resource identifier
     */
    constructor(resource = 'Resource', identifier = null) {
        const message = identifier
            ? `${resource} '${identifier}' not found`
            : `${resource} not found`;
        super(message, 404, 'NOT_FOUND', { resource, identifier });
        this.resource = resource;
        this.identifier = identifier;
    }
}

/**
 * Conflict error - Resource conflict (e.g., duplicate)
 * HTTP 409 Conflict
 */
class ConflictError extends AppError {
    /**
     * @param {string} message - Error message
     * @param {string} resource - Type of resource
     */
    constructor(message = 'Resource conflict', resource = null) {
        super(message, 409, 'CONFLICT_ERROR', resource ? { resource } : {});
    }
}

/**
 * Database error - Database operation failed
 * HTTP 500 Internal Server Error
 */
class DatabaseError extends AppError {
    /**
     * @param {string} message - Error message
     * @param {string} operation - Database operation that failed
     * @param {Error} originalError - Original database error
     */
    constructor(message = 'Database operation failed', operation = null, originalError = null) {
        super(message, 500, 'DATABASE_ERROR', { operation });
        this.operation = operation;
        this.originalError = originalError;
    }
}

/**
 * External service error - External service failed
 * HTTP 502 Bad Gateway
 */
class ExternalServiceError extends AppError {
    /**
     * @param {string} service - Name of the external service
     * @param {string} message - Error message
     * @param {Error} originalError - Original service error
     */
    constructor(service, message = 'External service error', originalError = null) {
        super(message, 502, 'EXTERNAL_SERVICE_ERROR', { service });
        this.service = service;
        this.originalError = originalError;
    }
}

/**
 * Rate limit error - Too many requests
 * HTTP 429 Too Many Requests
 */
class RateLimitError extends AppError {
    /**
     * @param {number} retryAfter - Seconds until retry is allowed
     */
    constructor(retryAfter = 60) {
        super('Too many requests', 429, 'RATE_LIMIT_ERROR', { retryAfter });
        this.retryAfter = retryAfter;
    }
}

/**
 * Docker error - Docker operation failed
 * HTTP 500 Internal Server Error
 */
class DockerError extends AppError {
    /**
     * @param {string} operation - Docker operation that failed
     * @param {string} containerId - Container ID (if applicable)
     * @param {Error} originalError - Original Docker error
     */
    constructor(operation, containerId = null, originalError = null) {
        const message = containerId
            ? `Docker ${operation} failed for container ${containerId}`
            : `Docker ${operation} failed`;
        super(message, 500, 'DOCKER_ERROR', { operation, containerId });
        this.operation = operation;
        this.containerId = containerId;
        this.originalError = originalError;
    }
}

/**
 * Checks if an error is an operational AppError
 * @param {Error} error - Error to check
 * @returns {boolean}
 */
function isAppError(error) {
    return error instanceof AppError && error.isOperational;
}

/**
 * Wraps an unknown error in an AppError
 * Preserves AppError instances, wraps others
 * @param {Error} error - Error to wrap
 * @param {string} defaultMessage - Default message for non-AppError
 * @returns {AppError}
 */
function wrapError(error, defaultMessage = 'An unexpected error occurred') {
    if (error instanceof AppError) {
        return error;
    }

    const wrapped = new AppError(
        error.message || defaultMessage,
        500,
        'UNEXPECTED_ERROR'
    );
    wrapped.originalError = error;
    wrapped.isOperational = false;
    return wrapped;
}

module.exports = {
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
};
