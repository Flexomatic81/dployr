const Joi = require('joi');
const { logger } = require('../config/logger');

// Validation Schemas
const schemas = {
    // Auth Schemas
    register: Joi.object({
        username: Joi.string()
            .pattern(/^[a-z0-9_-]+$/)
            .min(3)
            .max(30)
            .required()
            .messages({
                'string.pattern.base': 'Username may only contain lowercase letters, numbers, - and _',
                'string.min': 'Username must be at least 3 characters long',
                'string.max': 'Username must not exceed 30 characters',
                'any.required': 'Username is required'
            }),
        email: Joi.string()
            .email()
            .required()
            .messages({
                'string.email': 'Please enter a valid email address',
                'any.required': 'Email is required'
            }),
        password: Joi.string()
            .min(8)
            .required()
            .messages({
                'string.min': 'Password must be at least 8 characters long',
                'any.required': 'Password is required'
            }),
        password_confirm: Joi.string()
            .valid(Joi.ref('password'))
            .required()
            .messages({
                'any.only': 'Passwords do not match',
                'any.required': 'Password confirmation is required'
            })
    }),

    forgotPassword: Joi.object({
        email: Joi.string()
            .email()
            .required()
            .messages({
                'string.email': 'Please enter a valid email address',
                'any.required': 'Email is required'
            })
    }),

    resetPassword: Joi.object({
        token: Joi.string()
            .length(64)
            .required()
            .messages({
                'string.length': 'Invalid token',
                'any.required': 'Token is required'
            }),
        password: Joi.string()
            .min(8)
            .required()
            .messages({
                'string.min': 'Password must be at least 8 characters long',
                'any.required': 'Password is required'
            }),
        password_confirm: Joi.string()
            .valid(Joi.ref('password'))
            .required()
            .messages({
                'any.only': 'Passwords do not match',
                'any.required': 'Password confirmation is required'
            })
    }),

    login: Joi.object({
        username: Joi.string().required().messages({
            'any.required': 'Username is required'
        }),
        password: Joi.string().required().messages({
            'any.required': 'Password is required'
        })
    }),

    // Project Schemas
    createProject: Joi.object({
        name: Joi.string()
            .pattern(/^[a-z0-9-]+$/)
            .min(2)
            .max(50)
            .required()
            .messages({
                'string.pattern.base': 'Project name may only contain lowercase letters, numbers and -',
                'string.min': 'Project name must be at least 2 characters long',
                'string.max': 'Project name must not exceed 50 characters',
                'any.required': 'Project name is required'
            }),
        template: Joi.string()
            .valid('static-website', 'php-website', 'nodejs-app', 'python-flask', 'python-django')
            .required()
            .messages({
                'any.only': 'Invalid project template',
                'any.required': 'Project template is required'
            }),
        port: Joi.number()
            .integer()
            .min(1024)
            .max(65535)
            .optional()
            .messages({
                'number.min': 'Port must be at least 1024',
                'number.max': 'Port must not exceed 65535'
            })
    }),

    createProjectFromZip: Joi.object({
        name: Joi.string()
            .pattern(/^[a-z0-9-]+$/)
            .min(2)
            .max(50)
            .required()
            .messages({
                'string.pattern.base': 'Project name may only contain lowercase letters, numbers and -',
                'string.min': 'Project name must be at least 2 characters long',
                'string.max': 'Project name must not exceed 50 characters',
                'any.required': 'Project name is required'
            }),
        port: Joi.number()
            .integer()
            .min(1024)
            .max(65535)
            .optional()
            .messages({
                'number.min': 'Port must be at least 1024',
                'number.max': 'Port must not exceed 65535'
            })
    }),

    createProjectFromGit: Joi.object({
        name: Joi.string()
            .pattern(/^[a-z0-9-]+$/)
            .min(2)
            .max(50)
            .required()
            .messages({
                'string.pattern.base': 'Project name may only contain lowercase letters, numbers and -',
                'string.min': 'Project name must be at least 2 characters long',
                'string.max': 'Project name must not exceed 50 characters',
                'any.required': 'Project name is required'
            }),
        repo_url: Joi.string()
            .uri({ scheme: ['https'] })
            .pattern(/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\//)
            .required()
            .messages({
                'string.uri': 'Invalid repository URL',
                'string.pattern.base': 'Only GitHub, GitLab and Bitbucket URLs are supported',
                'any.required': 'Repository URL is required'
            }),
        access_token: Joi.string().allow('').optional(),
        port: Joi.number()
            .integer()
            .min(1024)
            .max(65535)
            .optional()
            .messages({
                'number.min': 'Port must be at least 1024',
                'number.max': 'Port must not exceed 65535'
            })
    }),

    // Database Schemas
    createDatabase: Joi.object({
        name: Joi.string()
            .pattern(/^[a-z0-9_]+$/)
            .min(2)
            .max(30)
            .required()
            .messages({
                'string.pattern.base': 'Database name may only contain lowercase letters, numbers and _',
                'string.min': 'Database name must be at least 2 characters long',
                'string.max': 'Database name must not exceed 30 characters',
                'any.required': 'Database name is required'
            }),
        type: Joi.string()
            .valid('mariadb', 'postgresql')
            .required()
            .messages({
                'any.only': 'Invalid database type',
                'any.required': 'Database type is required'
            })
    }),

    // Share Schema
    createShare: Joi.object({
        username: Joi.string()
            .pattern(/^[a-z0-9_-]+$/)
            .min(3)
            .max(30)
            .required()
            .messages({
                'string.pattern.base': 'Invalid username',
                'any.required': 'Username is required'
            }),
        permission: Joi.string()
            .valid('read', 'manage', 'full')
            .required()
            .messages({
                'any.only': 'Invalid permission',
                'any.required': 'Permission is required'
            })
    })
};

/**
 * Validation Middleware Factory
 * @param {string} schemaName - Name of the schema to use
 * @returns {Function} Express Middleware
 */
function validate(schemaName) {
    return (req, res, next) => {
        const schema = schemas[schemaName];
        if (!schema) {
            logger.error('Validation schema not found', { schemaName });
            return next();
        }

        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const messages = error.details.map(detail => detail.message);

            // Return JSON for AJAX requests
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(400).json({
                    success: false,
                    errors: messages
                });
            }

            // Flash message and redirect for normal requests
            req.flash('error', messages.join('. '));
            return res.redirect('back');
        }

        // Store validated data in request
        req.validatedBody = value;
        next();
    };
}

module.exports = {
    validate,
    schemas
};
