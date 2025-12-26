/**
 * Zentrale Konstanten für das Dployr-Dashboard
 */

// Berechtigungsstufen für Projekt-Sharing (aufsteigend)
const PERMISSION_LEVELS = {
    read: 1,
    manage: 2,
    full: 3
};

// Gültige Auto-Deploy Intervalle (in Minuten)
const VALID_INTERVALS = [5, 10, 15, 30, 60];

// Unterstützte Projekttypen
const PROJECT_TYPES = [
    'static',
    'php',
    'nodejs',
    'laravel',
    'nodejs-static',
    'nextjs'
];

// Bekannte Aliase für Datenbank-Umgebungsvariablen
// Ermöglicht intelligentes Ersetzen von DB-Credentials in .env Dateien
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
    DB_VARIABLE_ALIASES
};
