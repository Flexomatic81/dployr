/**
 * Docker Compose Validator Service
 *
 * Parses, validates, and transforms user-provided docker-compose.yml files
 * for secure deployment on the dployr platform.
 */

const YAML = require('yaml');
const path = require('path');
const { logger } = require('../config/logger');

// Blocked options for security
const BLOCKED_SERVICE_OPTIONS = [
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
];

// Volume sources that are blocked for security
const BLOCKED_VOLUME_SOURCES = [
    '/var/run/docker.sock',
    '/var/run/',
    '/etc/',
    '/root/',
    '/home/',
    '/proc/',
    '/sys/',
    '/dev/',
    '/boot/',
    '/lib/',
    '/lib64/',
    '/usr/',
    '/bin/',
    '/sbin/',
    '/opt/',
    '/tmp/'
];

// Network modes that are blocked
const BLOCKED_NETWORK_MODES = ['host', 'none'];

// Default resource limits
const DEFAULT_RESOURCE_LIMITS = {
    cpus: '1',
    memory: '512M'
};

// Maximum resource limits
const MAX_RESOURCE_LIMITS = {
    cpus: 2,
    memory: '2G'
};

/**
 * Parse docker-compose.yml content
 * @param {string} content - YAML content
 * @returns {object} - Parsed compose object or error
 */
function parseCompose(content) {
    try {
        const parsed = YAML.parse(content);
        if (!parsed || typeof parsed !== 'object') {
            return { success: false, error: 'Invalid YAML structure' };
        }
        return { success: true, compose: parsed };
    } catch (error) {
        return { success: false, error: `YAML parse error: ${error.message}` };
    }
}

/**
 * Validate compose file against security rules
 * @param {object} compose - Parsed compose object
 * @returns {object} - Validation result with errors array
 */
function validateCompose(compose) {
    const errors = [];

    // Check if services exist
    if (!compose.services || typeof compose.services !== 'object') {
        errors.push('No services defined in docker-compose.yml');
        return { valid: false, errors };
    }

    // Validate each service
    for (const [serviceName, service] of Object.entries(compose.services)) {
        if (!service || typeof service !== 'object') {
            errors.push(`Service "${serviceName}" is invalid`);
            continue;
        }

        // Check for blocked options
        for (const option of BLOCKED_SERVICE_OPTIONS) {
            if (service[option] !== undefined) {
                // Special handling for network_mode
                if (option === 'network_mode') {
                    if (BLOCKED_NETWORK_MODES.includes(service[option])) {
                        errors.push(`Service "${serviceName}": network_mode "${service[option]}" is not allowed`);
                    }
                } else {
                    errors.push(`Service "${serviceName}": option "${option}" is not allowed for security reasons`);
                }
            }
        }

        // Validate volumes
        if (service.volumes && Array.isArray(service.volumes)) {
            for (const volume of service.volumes) {
                const volumeStr = typeof volume === 'string' ? volume : volume.source || '';
                const sourcePath = volumeStr.split(':')[0];

                // Check for absolute paths to blocked locations
                if (sourcePath.startsWith('/')) {
                    for (const blocked of BLOCKED_VOLUME_SOURCES) {
                        if (sourcePath === blocked || sourcePath.startsWith(blocked)) {
                            errors.push(`Service "${serviceName}": volume mount to "${sourcePath}" is not allowed`);
                            break;
                        }
                    }
                }
            }
        }

        // Validate build context if specified
        if (service.build) {
            const buildContext = typeof service.build === 'string'
                ? service.build
                : service.build.context || '.';

            // Ensure build context is relative (within project)
            if (buildContext.startsWith('/') || buildContext.startsWith('..')) {
                errors.push(`Service "${serviceName}": build context must be relative to project directory`);
            }
        }
    }

    // Validate networks
    if (compose.networks) {
        for (const [networkName, network] of Object.entries(compose.networks)) {
            if (network && network.external === true && networkName !== 'dployr-network') {
                errors.push(`Network "${networkName}": external networks other than "dployr-network" are not allowed`);
            }
            if (network && network.driver && ['host', 'macvlan', 'ipvlan'].includes(network.driver)) {
                errors.push(`Network "${networkName}": driver "${network.driver}" is not allowed`);
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Transform compose file for dployr compatibility
 * @param {object} compose - Parsed compose object
 * @param {string} containerPrefix - Prefix for container names (username-projectname)
 * @param {number} basePort - Base port for port allocation
 * @returns {object} - Transformed compose and port mappings
 */
function transformCompose(compose, containerPrefix, basePort) {
    const transformed = JSON.parse(JSON.stringify(compose)); // Deep copy
    const portMappings = [];
    let currentPort = basePort;

    // Remove version (deprecated in modern Docker Compose)
    delete transformed.version;

    // Transform each service
    for (const [serviceName, service] of Object.entries(transformed.services)) {
        // Prefix container name
        service.container_name = `${containerPrefix}-${serviceName}`;

        // Add labels to identify as custom dployr project
        if (!service.labels) {
            service.labels = {};
        }
        if (Array.isArray(service.labels)) {
            service.labels.push('dployr-custom=true');
        } else {
            service.labels['dployr-custom'] = 'true';
        }

        // Add restart policy if not set
        if (!service.restart) {
            service.restart = 'unless-stopped';
        }

        // Add resource limits
        if (!service.deploy) {
            service.deploy = {};
        }
        if (!service.deploy.resources) {
            service.deploy.resources = {};
        }
        if (!service.deploy.resources.limits) {
            service.deploy.resources.limits = {
                cpus: DEFAULT_RESOURCE_LIMITS.cpus,
                memory: DEFAULT_RESOURCE_LIMITS.memory
            };
        }

        // Add timezone
        if (!service.environment) {
            service.environment = [];
        }
        if (Array.isArray(service.environment)) {
            if (!service.environment.some(e => e.startsWith('TZ='))) {
                service.environment.push('TZ=Europe/Berlin');
            }
        } else if (typeof service.environment === 'object') {
            if (!service.environment.TZ) {
                service.environment.TZ = 'Europe/Berlin';
            }
        }

        // Remap ports
        if (service.ports && Array.isArray(service.ports)) {
            const newPorts = [];
            for (const port of service.ports) {
                let internalPort;
                let protocol = 'tcp';

                if (typeof port === 'string') {
                    // Parse port string (e.g., "8080:80", "3000", "8080:80/tcp")
                    const portStr = port.replace(/\/\w+$/, ''); // Remove protocol suffix
                    if (port.includes('/')) {
                        protocol = port.split('/')[1];
                    }
                    const parts = portStr.split(':');
                    internalPort = parseInt(parts[parts.length - 1], 10);
                } else if (typeof port === 'object') {
                    internalPort = port.target;
                    protocol = port.protocol || 'tcp';
                } else {
                    internalPort = port;
                }

                if (internalPort) {
                    const externalPort = currentPort++;
                    newPorts.push(`${externalPort}:${internalPort}${protocol !== 'tcp' ? '/' + protocol : ''}`);
                    portMappings.push({
                        service: serviceName,
                        internal: internalPort,
                        external: externalPort,
                        protocol
                    });
                }
            }
            service.ports = newPorts;
        }

        // Ensure service joins dployr-network
        if (!service.networks) {
            service.networks = ['dployr-network'];
        } else if (Array.isArray(service.networks)) {
            if (!service.networks.includes('dployr-network')) {
                service.networks.push('dployr-network');
            }
        } else if (typeof service.networks === 'object') {
            if (!service.networks['dployr-network']) {
                service.networks['dployr-network'] = {};
            }
        }

        // Transform volume paths to be relative to project
        if (service.volumes && Array.isArray(service.volumes)) {
            service.volumes = service.volumes.map(volume => {
                if (typeof volume === 'string') {
                    const parts = volume.split(':');
                    if (parts.length >= 2) {
                        let source = parts[0];
                        // If source is relative (starts with . or no /), prefix with ./html/
                        if (!source.startsWith('/') && !source.startsWith('./html')) {
                            if (source === '.') {
                                source = './html';
                            } else if (source.startsWith('./')) {
                                source = './html/' + source.slice(2);
                            } else {
                                source = './html/' + source;
                            }
                        }
                        parts[0] = source;
                        return parts.join(':');
                    }
                }
                return volume;
            });
        }

        // Transform build context
        if (service.build) {
            if (typeof service.build === 'string') {
                service.build = './html/' + service.build.replace(/^\.\//, '');
            } else if (service.build.context) {
                const context = service.build.context;
                if (!context.startsWith('./html')) {
                    service.build.context = './html/' + context.replace(/^\.\//, '');
                }
            }
        }
    }

    // Ensure dployr-network is defined
    if (!transformed.networks) {
        transformed.networks = {};
    }
    transformed.networks['dployr-network'] = { external: true };

    return { compose: transformed, portMappings };
}

/**
 * Convert compose object back to YAML string
 * @param {object} compose - Compose object
 * @returns {string} - YAML string
 */
function stringifyCompose(compose) {
    // Add custom marker as x-dployr extension for detection
    compose['x-dployr'] = {
        'dployr-custom': 'true',
        'generated': new Date().toISOString()
    };

    return YAML.stringify(compose, {
        indent: 2,
        lineWidth: 0 // Don't wrap lines
    });
}

/**
 * Process a user's docker-compose.yml file
 * @param {string} content - Raw YAML content
 * @param {string} containerPrefix - Container name prefix
 * @param {number} basePort - Starting port for allocation
 * @returns {object} - Result with sanitized YAML and port mappings
 */
function processUserCompose(content, containerPrefix, basePort) {
    // Parse
    const parseResult = parseCompose(content);
    if (!parseResult.success) {
        logger.warn('Failed to parse user docker-compose.yml', { error: parseResult.error });
        return { success: false, error: parseResult.error };
    }

    // Validate
    const validation = validateCompose(parseResult.compose);
    if (!validation.valid) {
        logger.warn('User docker-compose.yml validation failed', { errors: validation.errors });
        return { success: false, errors: validation.errors };
    }

    // Transform
    const { compose, portMappings } = transformCompose(parseResult.compose, containerPrefix, basePort);

    // Stringify
    const yamlOutput = stringifyCompose(compose);

    logger.info('Successfully processed user docker-compose.yml', {
        containerPrefix,
        services: Object.keys(compose.services),
        portMappings
    });

    return {
        success: true,
        yaml: yamlOutput,
        compose,
        services: Object.keys(compose.services),
        portMappings
    };
}

/**
 * Check if a docker-compose file exists in the given path
 * @param {string} dirPath - Directory to check
 * @returns {object} - Result with exists flag and file path
 */
function findComposeFile(dirPath) {
    const fs = require('fs');
    const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

    for (const filename of composeFiles) {
        const filePath = path.join(dirPath, filename);
        if (fs.existsSync(filePath)) {
            return { exists: true, path: filePath, filename };
        }
    }

    return { exists: false };
}

/**
 * Check if a Dockerfile exists in the given path
 * @param {string} dirPath - Directory to check
 * @returns {object} - Result with exists flag and file path
 */
function findDockerfile(dirPath) {
    const fs = require('fs');
    const dockerfiles = ['Dockerfile', 'dockerfile'];

    for (const filename of dockerfiles) {
        const filePath = path.join(dirPath, filename);
        if (fs.existsSync(filePath)) {
            return { exists: true, path: filePath, filename };
        }
    }

    return { exists: false };
}

module.exports = {
    parseCompose,
    validateCompose,
    transformCompose,
    stringifyCompose,
    processUserCompose,
    findComposeFile,
    findDockerfile,
    BLOCKED_SERVICE_OPTIONS,
    BLOCKED_VOLUME_SOURCES,
    DEFAULT_RESOURCE_LIMITS,
    MAX_RESOURCE_LIMITS
};
