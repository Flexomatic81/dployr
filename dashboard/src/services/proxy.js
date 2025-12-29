/**
 * Nginx Proxy Manager API Service
 *
 * Handles communication with NPM's REST API for:
 * - Authentication (JWT tokens)
 * - Proxy host management
 * - SSL certificate management
 */

const axios = require('axios');
const Docker = require('dockerode');
const { pool } = require('../config/database');
const { logger } = require('../config/logger');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const NPM_CONTAINER_NAME = 'dployr-npm';
const NPM_API_URL = process.env.NPM_API_URL || 'http://dployr-npm:81/api';
const NPM_ENABLED = process.env.NPM_ENABLED === 'true';

// Default NPM credentials (created on first start)
const NPM_DEFAULT_EMAIL = 'admin@example.com';
const NPM_DEFAULT_PASSWORD = 'changeme';

// Token cache (in-memory, refreshed on expiry)
let cachedToken = null;
let tokenExpiry = null;

/**
 * Check if NPM integration is enabled
 */
function isEnabled() {
    return NPM_ENABLED;
}

/**
 * Get JWT token for NPM API authentication
 */
async function getToken() {
    // Return cached token if still valid
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        return cachedToken;
    }

    const email = process.env.NPM_API_EMAIL;
    const password = process.env.NPM_API_PASSWORD;

    if (!email || !password) {
        throw new Error('NPM API credentials not configured');
    }

    try {
        const response = await axios.post(`${NPM_API_URL}/tokens`, {
            identity: email,
            secret: password
        }, {
            timeout: 10000
        });

        cachedToken = response.data.token;
        // Token valid for 23 hours (NPM default is 1 day)
        tokenExpiry = Date.now() + (23 * 60 * 60 * 1000);

        logger.info('NPM API token obtained');
        return cachedToken;
    } catch (error) {
        logger.error('NPM API authentication failed', {
            error: error.message,
            status: error.response?.status
        });
        throw new Error('Failed to authenticate with Nginx Proxy Manager');
    }
}

/**
 * Create authenticated axios instance
 */
async function getApiClient() {
    const token = await getToken();
    return axios.create({
        baseURL: NPM_API_URL,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        timeout: 30000
    });
}

/**
 * Create a proxy host for a project
 * @param {string} containerName - The container name to proxy to
 * @param {string} domain - The domain name
 * @param {number} port - The target port
 * @param {object} options - Additional options (sslEnabled, http2)
 */
async function createProxyHost(containerName, domain, port, options = {}) {
    if (!isEnabled()) {
        throw new Error('NPM integration is not enabled');
    }

    const client = await getApiClient();

    const payload = {
        domain_names: [domain],
        forward_scheme: 'http',
        forward_host: containerName,
        forward_port: parseInt(port) || 80,
        certificate_id: 0,
        ssl_forced: false,
        http2_support: options.http2 !== false,
        block_exploits: true,
        allow_websocket_upgrade: true,
        access_list_id: 0,
        meta: {
            letsencrypt_agree: true,
            dns_challenge: false
        },
        advanced_config: ''
    };

    try {
        const response = await client.post('/nginx/proxy-hosts', payload);
        logger.info('Proxy host created', { domain, containerName, proxyHostId: response.data.id });
        return response.data;
    } catch (error) {
        const errorMessage = error.response?.data?.message || error.message;
        logger.error('Failed to create proxy host', {
            domain,
            containerName,
            error: errorMessage,
            status: error.response?.status
        });

        if (error.response?.status === 400 && errorMessage.includes('already exists')) {
            throw new Error('Domain is already configured in another proxy host');
        }
        throw new Error(`Failed to create proxy host: ${errorMessage}`);
    }
}

/**
 * Delete a proxy host
 * @param {number} proxyHostId - The proxy host ID to delete
 */
async function deleteProxyHost(proxyHostId) {
    if (!isEnabled() || !proxyHostId) return;

    const client = await getApiClient();

    try {
        await client.delete(`/nginx/proxy-hosts/${proxyHostId}`);
        logger.info('Proxy host deleted', { proxyHostId });
    } catch (error) {
        logger.error('Failed to delete proxy host', {
            proxyHostId,
            error: error.message,
            status: error.response?.status
        });
        // Don't throw - cleanup should not fail the operation
    }
}

/**
 * Get all proxy hosts
 */
async function listProxyHosts() {
    if (!isEnabled()) return [];

    const client = await getApiClient();

    try {
        const response = await client.get('/nginx/proxy-hosts');
        return response.data;
    } catch (error) {
        logger.error('Failed to list proxy hosts', { error: error.message });
        return [];
    }
}

/**
 * Request Let's Encrypt certificate for a domain
 * @param {string} domain - The domain to request certificate for
 * @param {string} email - Email for Let's Encrypt
 */
async function requestCertificate(domain, email) {
    if (!isEnabled()) {
        throw new Error('NPM integration is not enabled');
    }

    const client = await getApiClient();

    // NPM v2+ API format for Let's Encrypt certificates
    const payload = {
        domain_names: [domain],
        provider: 'letsencrypt'
    };

    try {
        const response = await client.post('/nginx/certificates', payload);
        logger.info('Certificate requested', { domain, certificateId: response.data.id });
        return response.data;
    } catch (error) {
        // Log detailed error for debugging
        logger.error('Failed to request certificate', {
            domain,
            error: error.response?.data?.message || error.message,
            details: error.response?.data
        });
        throw new Error('Failed to request SSL certificate. Make sure the domain points to this server.');
    }
}

/**
 * Update proxy host with SSL certificate
 * @param {number} proxyHostId - The proxy host ID
 * @param {number} certificateId - The certificate ID
 */
async function enableSSL(proxyHostId, certificateId) {
    if (!isEnabled()) {
        throw new Error('NPM integration is not enabled');
    }

    const client = await getApiClient();

    try {
        // First get the current proxy host to preserve settings
        const current = await client.get(`/nginx/proxy-hosts/${proxyHostId}`);

        // Only include allowed fields for NPM v2+ API
        const payload = {
            domain_names: current.data.domain_names,
            forward_scheme: current.data.forward_scheme,
            forward_host: current.data.forward_host,
            forward_port: current.data.forward_port,
            certificate_id: certificateId,
            ssl_forced: true,
            http2_support: true,
            block_exploits: current.data.block_exploits || false,
            caching_enabled: current.data.caching_enabled || false,
            allow_websocket_upgrade: current.data.allow_websocket_upgrade || false,
            access_list_id: current.data.access_list_id || 0,
            advanced_config: current.data.advanced_config || '',
            enabled: current.data.enabled !== false,
            meta: current.data.meta || {},
            locations: current.data.locations || []
        };

        const response = await client.put(`/nginx/proxy-hosts/${proxyHostId}`, payload);

        logger.info('SSL enabled for proxy host', { proxyHostId, certificateId });
        return response.data;
    } catch (error) {
        logger.error('Failed to enable SSL', {
            proxyHostId,
            error: error.response?.data?.message || error.message,
            details: error.response?.data
        });
        throw new Error('Failed to enable SSL for this domain');
    }
}

/**
 * Test NPM API connection
 */
async function testConnection() {
    if (!isEnabled()) return false;

    try {
        await getToken();
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Check if NPM needs initial setup (no admin user created yet)
 * @returns {Promise<{needsSetup: boolean, error?: string}>}
 */
async function checkSetupStatus() {
    try {
        const response = await axios.get(`${NPM_API_URL}/`, { timeout: 5000 });
        return { needsSetup: response.data.setup === false };
    } catch (error) {
        return { needsSetup: false, error: error.message };
    }
}

/**
 * Initialize NPM with configured credentials
 * Handles both fresh NPM instances (setup:false) and legacy instances with default credentials.
 *
 * @param {string} email - The new admin email
 * @param {string} password - The new admin password
 * @returns {Promise<{success: boolean, error?: string, alreadyInitialized?: boolean}>}
 */
async function initializeCredentials(email, password) {
    if (!email || !password) {
        return { success: false, error: 'Email and password are required' };
    }

    // First try to login with the configured credentials (already initialized)
    try {
        const response = await axios.post(`${NPM_API_URL}/tokens`, {
            identity: email,
            secret: password
        }, { timeout: 10000 });

        if (response.data.token) {
            logger.info('NPM already initialized with configured credentials');
            return { success: true, alreadyInitialized: true };
        }
    } catch (error) {
        // Continue - credentials might not be set yet
    }

    // Check if NPM needs initial setup (newer versions >= 2.9.0)
    // NPM uses INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD env vars on first start
    const setupStatus = await checkSetupStatus();
    if (setupStatus.needsSetup) {
        logger.info('NPM needs initial setup - container needs to be recreated with env vars');
        // NPM hasn't been set up yet. The INITIAL_ADMIN_* env vars are only read on first database creation.
        // We need to delete the NPM data and restart the container.
        return {
            success: false,
            needsRecreate: true,
            error: 'NPM needs fresh start. Please use "Recreate" button to apply credentials.'
        };
    }

    // Try to login with default credentials (legacy NPM versions with changeme password)
    let defaultToken;
    try {
        const response = await axios.post(`${NPM_API_URL}/tokens`, {
            identity: NPM_DEFAULT_EMAIL,
            secret: NPM_DEFAULT_PASSWORD
        }, { timeout: 10000 });

        defaultToken = response.data.token;
        logger.info('Logged in with default NPM credentials, will update to configured ones');
    } catch (error) {
        // Default credentials don't work - NPM is already initialized with different credentials
        logger.error('Cannot initialize NPM', { error: error.message });
        return {
            success: false,
            error: 'NPM is already initialized with different credentials. Use "Recreate" to reset.'
        };
    }

    // Update default user to configured credentials
    try {
        const client = axios.create({
            baseURL: NPM_API_URL,
            headers: {
                'Authorization': `Bearer ${defaultToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        // Get users list to find admin user
        const usersResponse = await client.get('/users');
        const adminUser = usersResponse.data.find(u => u.email === NPM_DEFAULT_EMAIL);

        if (!adminUser) {
            return { success: false, error: 'Default admin user not found' };
        }

        // Update user credentials
        await client.put(`/users/${adminUser.id}`, {
            email: email,
            name: 'Administrator',
            nickname: 'Admin',
            is_disabled: false,
            roles: ['admin']
        });

        // Change password (separate API call)
        await client.put(`/users/${adminUser.id}/auth`, {
            type: 'password',
            current: NPM_DEFAULT_PASSWORD,
            secret: password
        });

        // Clear cached token so next request uses new credentials
        cachedToken = null;
        tokenExpiry = null;

        logger.info('NPM credentials initialized successfully', { email });
        return { success: true };
    } catch (error) {
        logger.error('Failed to update NPM credentials', {
            error: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        return {
            success: false,
            error: error.response?.data?.message || error.message
        };
    }
}

/**
 * Recreate NPM container with fresh database
 * This deletes the NPM data volume and restarts the container,
 * allowing INITIAL_ADMIN_* env vars to take effect.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function recreateContainer() {
    try {
        const container = docker.getContainer(NPM_CONTAINER_NAME);

        // Stop container if running
        try {
            await container.stop();
            logger.info('NPM container stopped for recreation');
        } catch (err) {
            // Ignore if already stopped
        }

        // Remove container
        try {
            await container.remove();
            logger.info('NPM container removed');
        } catch (err) {
            logger.error('Failed to remove NPM container', { error: err.message });
        }

        // Remove data volumes
        try {
            const dataVolume = docker.getVolume('dployr-npm-data');
            await dataVolume.remove();
            logger.info('NPM data volume removed');
        } catch (err) {
            // Volume might not exist
            logger.debug('Could not remove npm-data volume', { error: err.message });
        }

        try {
            const certVolume = docker.getVolume('dployr-npm-letsencrypt');
            await certVolume.remove();
            logger.info('NPM letsencrypt volume removed');
        } catch (err) {
            // Volume might not exist
            logger.debug('Could not remove npm-letsencrypt volume', { error: err.message });
        }

        // Note: We cannot use docker-compose from inside the container.
        // The admin will need to run 'docker compose up -d npm' on the host,
        // or we provide instructions.
        logger.info('NPM container and volumes removed. Run "docker compose up -d npm" on host to recreate.');

        return {
            success: true,
            needsManualStart: true,
            message: 'Container removed. Run "docker compose up -d npm" on the server to recreate with new credentials.'
        };
    } catch (error) {
        logger.error('Failed to recreate NPM container', { error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Wait for NPM API to become available
 * @param {number} maxAttempts - Maximum number of attempts
 * @param {number} delayMs - Delay between attempts in milliseconds
 * @returns {Promise<boolean>}
 */
async function waitForApi(maxAttempts = 30, delayMs = 2000) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            // Just check if the API responds at all
            await axios.get(`${NPM_API_URL}/`, { timeout: 5000 });
            return true;
        } catch (error) {
            // API might return 401/404, but that means it's running
            if (error.response) {
                return true;
            }
            // Connection refused or timeout - keep waiting
            logger.debug('Waiting for NPM API...', { attempt: i + 1 });
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    return false;
}

// ============================================
// Container control functions
// ============================================

/**
 * Get the NPM container status
 * @returns {Promise<{exists: boolean, running: boolean, status: string}>}
 */
async function getContainerStatus() {
    try {
        const containers = await docker.listContainers({ all: true });
        const npmContainer = containers.find(c =>
            c.Names.some(name => name === '/' + NPM_CONTAINER_NAME || name === NPM_CONTAINER_NAME)
        );

        if (!npmContainer) {
            return { exists: false, running: false, status: 'not_found' };
        }

        const isRunning = npmContainer.State === 'running';
        return {
            exists: true,
            running: isRunning,
            status: npmContainer.State,
            containerId: npmContainer.Id
        };
    } catch (error) {
        logger.error('Failed to get NPM container status', { error: error.message });
        return { exists: false, running: false, status: 'error', error: error.message };
    }
}

/**
 * Start the NPM container
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function startContainer() {
    try {
        const container = docker.getContainer(NPM_CONTAINER_NAME);
        await container.start();
        logger.info('NPM container started');
        return { success: true };
    } catch (error) {
        // Container might already be running
        if (error.statusCode === 304) {
            return { success: true, message: 'Container already running' };
        }
        logger.error('Failed to start NPM container', { error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Stop the NPM container
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function stopContainer() {
    try {
        const container = docker.getContainer(NPM_CONTAINER_NAME);
        await container.stop();
        logger.info('NPM container stopped');
        return { success: true };
    } catch (error) {
        // Container might already be stopped
        if (error.statusCode === 304) {
            return { success: true, message: 'Container already stopped' };
        }
        logger.error('Failed to stop NPM container', { error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Restart the NPM container
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function restartContainer() {
    try {
        const container = docker.getContainer(NPM_CONTAINER_NAME);
        await container.restart();
        logger.info('NPM container restarted');
        return { success: true };
    } catch (error) {
        logger.error('Failed to restart NPM container', { error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Get NPM container logs
 * @param {number} lines - Number of log lines to retrieve
 * @returns {Promise<string>}
 */
async function getContainerLogs(lines = 100) {
    try {
        const container = docker.getContainer(NPM_CONTAINER_NAME);
        const logs = await container.logs({
            stdout: true,
            stderr: true,
            tail: lines,
            timestamps: true
        });

        // Convert buffer to string and clean up
        const logString = logs.toString('utf8')
            .split('\n')
            .map(line => line.substring(8)) // Remove Docker log prefix
            .filter(line => line.trim())
            .join('\n');

        return { success: true, logs: logString };
    } catch (error) {
        logger.error('Failed to get NPM container logs', { error: error.message });
        return { success: false, error: error.message };
    }
}

// ============================================
// Database functions for project_domains table
// ============================================

/**
 * Save domain mapping to database
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @param {string} domain - Domain name
 * @param {number} proxyHostId - NPM proxy host ID
 * @param {number} certificateId - NPM certificate ID (optional)
 */
async function saveDomainMapping(userId, projectName, domain, proxyHostId, certificateId = null) {
    await pool.execute(
        `INSERT INTO project_domains (user_id, project_name, domain, proxy_host_id, certificate_id, ssl_enabled)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            proxy_host_id = VALUES(proxy_host_id),
            certificate_id = VALUES(certificate_id),
            ssl_enabled = VALUES(ssl_enabled),
            updated_at = CURRENT_TIMESTAMP`,
        [userId, projectName, domain, proxyHostId, certificateId, certificateId ? true : false]
    );
    logger.info('Domain mapping saved', { userId, projectName, domain });
}

/**
 * Get domains for a project
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 */
async function getProjectDomains(userId, projectName) {
    const [rows] = await pool.execute(
        `SELECT * FROM project_domains WHERE user_id = ? AND project_name = ? ORDER BY created_at DESC`,
        [userId, projectName]
    );
    return rows;
}

/**
 * Get a single domain record
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @param {string} domain - Domain name
 */
async function getDomainRecord(userId, projectName, domain) {
    const [rows] = await pool.execute(
        `SELECT * FROM project_domains WHERE user_id = ? AND project_name = ? AND domain = ?`,
        [userId, projectName, domain]
    );
    return rows[0] || null;
}

/**
 * Delete domain mapping and cleanup NPM proxy host
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @param {string} domain - Domain name
 */
async function deleteDomainMapping(userId, projectName, domain) {
    // Get the proxy host ID first
    const [rows] = await pool.execute(
        `SELECT proxy_host_id FROM project_domains
         WHERE user_id = ? AND project_name = ? AND domain = ?`,
        [userId, projectName, domain]
    );

    if (rows.length > 0 && rows[0].proxy_host_id) {
        // Delete from NPM first
        await deleteProxyHost(rows[0].proxy_host_id);
    }

    // Delete from database
    await pool.execute(
        `DELETE FROM project_domains WHERE user_id = ? AND project_name = ? AND domain = ?`,
        [userId, projectName, domain]
    );

    logger.info('Domain mapping deleted', { userId, projectName, domain });
}

/**
 * Update SSL status for a domain
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 * @param {string} domain - Domain name
 * @param {number} certificateId - Certificate ID
 */
async function updateDomainSSL(userId, projectName, domain, certificateId) {
    await pool.execute(
        `UPDATE project_domains
         SET certificate_id = ?, ssl_enabled = TRUE, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND project_name = ? AND domain = ?`,
        [certificateId, userId, projectName, domain]
    );
    logger.info('Domain SSL updated', { userId, projectName, domain, certificateId });
}

/**
 * Delete all domains for a project (used when deleting project)
 * @param {number} userId - User ID
 * @param {string} projectName - Project name
 */
async function deleteProjectDomains(userId, projectName) {
    // Get all proxy host IDs
    const [rows] = await pool.execute(
        `SELECT proxy_host_id FROM project_domains WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );

    // Delete from NPM
    for (const row of rows) {
        if (row.proxy_host_id) {
            await deleteProxyHost(row.proxy_host_id);
        }
    }

    // Delete from database
    await pool.execute(
        `DELETE FROM project_domains WHERE user_id = ? AND project_name = ?`,
        [userId, projectName]
    );

    logger.info('All project domains deleted', { userId, projectName });
}

// ============================================
// Dashboard Domain functions
// ============================================

// Use in-memory cache for dashboard proxy host ID to avoid database dependency
let dashboardProxyHostId = null;

/**
 * Create proxy host for the dashboard container
 * Routes traffic from a custom domain to dashboard:3000
 * @param {string} domain - The domain name (e.g., app.dployr.de)
 * @param {boolean} withSsl - Whether to request SSL certificate
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function createDashboardProxyHost(domain, withSsl = true) {
    if (!isEnabled()) {
        return { success: false, error: 'NPM integration is not enabled' };
    }

    try {
        // First check if we already have a proxy host for the dashboard
        const existingHosts = await listProxyHosts();
        const dashboardHost = existingHosts.find(h =>
            h.forward_host === 'dashboard' ||
            h.forward_host === 'dployr-dashboard'
        );

        // If a dashboard proxy host exists, delete it first
        if (dashboardHost) {
            await deleteProxyHost(dashboardHost.id);
            logger.info('Removed existing dashboard proxy host', { proxyHostId: dashboardHost.id });
        }

        // Create new proxy host pointing to dashboard container
        const proxyHost = await createProxyHost('dashboard', domain, 3000, {
            http2: true
        });

        dashboardProxyHostId = proxyHost.id;
        logger.info('Dashboard proxy host created', { domain, proxyHostId: proxyHost.id });

        // Request SSL certificate if requested
        if (withSsl) {
            try {
                const cert = await requestCertificate(domain);
                if (cert && cert.id) {
                    await enableSSL(proxyHost.id, cert.id);
                    logger.info('SSL enabled for dashboard domain', { domain, certificateId: cert.id });
                }
            } catch (sslError) {
                // SSL request might fail (e.g., DNS not configured yet)
                // Log the error but don't fail the whole operation
                logger.warn('SSL certificate request failed for dashboard domain', {
                    domain,
                    error: sslError.message
                });
            }
        }

        return { success: true, proxyHostId: proxyHost.id };
    } catch (error) {
        logger.error('Failed to create dashboard proxy host', { domain, error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Delete the dashboard proxy host
 * @param {string} domain - The domain name (used for logging)
 * @returns {Promise<void>}
 */
async function deleteDashboardProxyHost(domain) {
    if (!isEnabled()) return;

    try {
        // Find the dashboard proxy host by looking for the one forwarding to dashboard container
        const existingHosts = await listProxyHosts();
        const dashboardHost = existingHosts.find(h =>
            h.forward_host === 'dashboard' ||
            h.forward_host === 'dployr-dashboard' ||
            (h.domain_names && h.domain_names.includes(domain))
        );

        if (dashboardHost) {
            await deleteProxyHost(dashboardHost.id);
            dashboardProxyHostId = null;
            logger.info('Dashboard proxy host deleted', { domain, proxyHostId: dashboardHost.id });
        }
    } catch (error) {
        logger.error('Failed to delete dashboard proxy host', { domain, error: error.message });
        // Don't throw - cleanup should not fail the operation
    }
}

module.exports = {
    // Status
    isEnabled,
    testConnection,

    // NPM API functions
    getToken,
    createProxyHost,
    deleteProxyHost,
    listProxyHosts,
    requestCertificate,
    enableSSL,

    // Initialization functions
    initializeCredentials,
    waitForApi,

    // Container control functions
    getContainerStatus,
    startContainer,
    stopContainer,
    restartContainer,
    recreateContainer,
    getContainerLogs,

    // Database functions
    saveDomainMapping,
    getProjectDomains,
    getDomainRecord,
    deleteDomainMapping,
    updateDomainSSL,
    deleteProjectDomains,

    // Dashboard Domain functions
    createDashboardProxyHost,
    deleteDashboardProxyHost
};
