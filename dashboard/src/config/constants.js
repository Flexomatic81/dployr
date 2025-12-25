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

module.exports = {
    PERMISSION_LEVELS,
    VALID_INTERVALS,
    PROJECT_TYPES
};
