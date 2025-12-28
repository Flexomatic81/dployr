/**
 * Central constants for the Dployr dashboard
 */

// Permission levels for project sharing (ascending)
const PERMISSION_LEVELS = {
    read: 1,
    manage: 2,
    full: 3
};

// Valid auto-deploy intervals (in minutes)
const VALID_INTERVALS = [5, 10, 15, 30, 60];

// Supported project types
const PROJECT_TYPES = [
    'static',
    'php',
    'nodejs',
    'laravel',
    'nodejs-static',
    'nextjs'
];

// Blocked files that should be removed from user uploads (security)
// These files could be used to override Docker configuration or execute malicious code
const BLOCKED_PROJECT_FILES = [
    'Dockerfile',
    'dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
    '.dockerignore'
];

// Known aliases for database environment variables
// Enables intelligent replacement of DB credentials in .env files
const DB_VARIABLE_ALIASES = {
    host: ['DB_HOST', 'DATABASE_HOST', 'MYSQL_HOST', 'POSTGRES_HOST', 'MARIADB_HOST', 'PG_HOST'],
    port: ['DB_PORT', 'DATABASE_PORT', 'MYSQL_PORT', 'POSTGRES_PORT', 'MARIADB_PORT', 'PG_PORT'],
    database: ['DB_DATABASE', 'DB_NAME', 'DATABASE_NAME', 'MYSQL_DATABASE', 'POSTGRES_DB', 'PG_DATABASE'],
    username: ['DB_USERNAME', 'DB_USER', 'DATABASE_USER', 'DATABASE_USERNAME', 'MYSQL_USER', 'POSTGRES_USER', 'PG_USER'],
    password: ['DB_PASSWORD', 'DATABASE_PASSWORD', 'MYSQL_PASSWORD', 'POSTGRES_PASSWORD', 'PG_PASSWORD']
};

module.exports = {
    PERMISSION_LEVELS,
    VALID_INTERVALS,
    PROJECT_TYPES,
    BLOCKED_PROJECT_FILES,
    DB_VARIABLE_ALIASES
};
