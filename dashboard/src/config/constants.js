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
    'nextjs',
    'nuxtjs',
    'python-flask',
    'python-django',
    'custom'  // User-provided docker-compose.yml
];

// Blocked files that should be removed from user uploads (security)
// Note: Docker files are now ALLOWED - users can bring their own docker-compose.yml
// Only files that could expose secrets or bypass security are blocked
const BLOCKED_PROJECT_FILES = [
    // Empty - Docker files are now validated and transformed instead of blocked
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

// Blocked docker-compose options for security
// These options could be used for privilege escalation or host access
const BLOCKED_COMPOSE_OPTIONS = {
    service_level: [
        'privileged',
        'cap_add',
        'cap_drop',
        'cgroup_parent',
        'devices',
        'dns',
        'dns_search',
        'external_links',
        'extra_hosts',
        'ipc',
        'links',
        'network_mode',
        'pid',
        'security_opt',
        'shm_size',
        'sysctls',
        'userns_mode',
        'uts'
    ],
    blocked_volume_sources: [
        '/var/run/docker.sock',
        '/var/run/',
        '/etc/',
        '/root/',
        '/home/',
        '/proc/',
        '/sys/',
        '/dev/'
    ],
    blocked_network_modes: ['host', 'none']
};

// Maximum resource limits for user containers
const MAX_RESOURCE_LIMITS = {
    cpus: 2,
    memory: '2G',
    services_per_project: 10
};

// Default resource limits applied to containers
const DEFAULT_RESOURCE_LIMITS = {
    cpus: '1',
    memory: '512M'
};

module.exports = {
    PERMISSION_LEVELS,
    VALID_INTERVALS,
    PROJECT_TYPES,
    BLOCKED_PROJECT_FILES,
    DB_VARIABLE_ALIASES,
    BLOCKED_COMPOSE_OPTIONS,
    MAX_RESOURCE_LIMITS,
    DEFAULT_RESOURCE_LIMITS
};
