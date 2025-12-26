const Joi = require('joi');

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
                'string.pattern.base': 'Benutzername darf nur Kleinbuchstaben, Zahlen, - und _ enthalten',
                'string.min': 'Benutzername muss mindestens 3 Zeichen lang sein',
                'string.max': 'Benutzername darf maximal 30 Zeichen lang sein',
                'any.required': 'Benutzername ist erforderlich'
            }),
        password: Joi.string()
            .min(8)
            .required()
            .messages({
                'string.min': 'Passwort muss mindestens 8 Zeichen lang sein',
                'any.required': 'Passwort ist erforderlich'
            }),
        password_confirm: Joi.string()
            .valid(Joi.ref('password'))
            .required()
            .messages({
                'any.only': 'Passwörter stimmen nicht überein',
                'any.required': 'Passwort-Bestätigung ist erforderlich'
            })
    }),

    login: Joi.object({
        username: Joi.string().required().messages({
            'any.required': 'Benutzername ist erforderlich'
        }),
        password: Joi.string().required().messages({
            'any.required': 'Passwort ist erforderlich'
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
                'string.pattern.base': 'Projektname darf nur Kleinbuchstaben, Zahlen und - enthalten',
                'string.min': 'Projektname muss mindestens 2 Zeichen lang sein',
                'string.max': 'Projektname darf maximal 50 Zeichen lang sein',
                'any.required': 'Projektname ist erforderlich'
            }),
        type: Joi.string()
            .valid('static-website', 'php-website', 'nodejs-app', 'laravel', 'nextjs', 'nodejs-static')
            .required()
            .messages({
                'any.only': 'Ungültiger Projekttyp',
                'any.required': 'Projekttyp ist erforderlich'
            })
    }),

    createProjectFromGit: Joi.object({
        name: Joi.string()
            .pattern(/^[a-z0-9-]+$/)
            .min(2)
            .max(50)
            .required()
            .messages({
                'string.pattern.base': 'Projektname darf nur Kleinbuchstaben, Zahlen und - enthalten',
                'string.min': 'Projektname muss mindestens 2 Zeichen lang sein',
                'string.max': 'Projektname darf maximal 50 Zeichen lang sein',
                'any.required': 'Projektname ist erforderlich'
            }),
        repo_url: Joi.string()
            .uri({ scheme: ['https'] })
            .pattern(/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\//)
            .required()
            .messages({
                'string.uri': 'Ungültige Repository-URL',
                'string.pattern.base': 'Nur GitHub, GitLab und Bitbucket URLs werden unterstützt',
                'any.required': 'Repository-URL ist erforderlich'
            }),
        access_token: Joi.string().allow('').optional()
    }),

    // Database Schemas
    createDatabase: Joi.object({
        name: Joi.string()
            .pattern(/^[a-z0-9_]+$/)
            .min(2)
            .max(30)
            .required()
            .messages({
                'string.pattern.base': 'Datenbankname darf nur Kleinbuchstaben, Zahlen und _ enthalten',
                'string.min': 'Datenbankname muss mindestens 2 Zeichen lang sein',
                'string.max': 'Datenbankname darf maximal 30 Zeichen lang sein',
                'any.required': 'Datenbankname ist erforderlich'
            }),
        type: Joi.string()
            .valid('mariadb', 'postgresql')
            .required()
            .messages({
                'any.only': 'Ungültiger Datenbanktyp',
                'any.required': 'Datenbanktyp ist erforderlich'
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
                'string.pattern.base': 'Ungültiger Benutzername',
                'any.required': 'Benutzername ist erforderlich'
            }),
        permission: Joi.string()
            .valid('read', 'manage', 'full')
            .required()
            .messages({
                'any.only': 'Ungültige Berechtigung',
                'any.required': 'Berechtigung ist erforderlich'
            })
    })
};

/**
 * Validation Middleware Factory
 * @param {string} schemaName - Name des zu verwendenden Schemas
 * @returns {Function} Express Middleware
 */
function validate(schemaName) {
    return (req, res, next) => {
        const schema = schemas[schemaName];
        if (!schema) {
            console.error(`Validation schema '${schemaName}' not found`);
            return next();
        }

        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const messages = error.details.map(detail => detail.message);

            // Für AJAX-Requests JSON zurückgeben
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(400).json({
                    success: false,
                    errors: messages
                });
            }

            // Für normale Requests Flash-Message und Redirect
            req.flash('error', messages.join('. '));
            return res.redirect('back');
        }

        // Validierte Daten im Request speichern
        req.validatedBody = value;
        next();
    };
}

module.exports = {
    validate,
    schemas
};
