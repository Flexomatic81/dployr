const Docker = require('dockerode');
const { spawn } = require('child_process');
const path = require('path');
const { logger } = require('../config/logger');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const USERS_PATH = process.env.USERS_PATH || '/app/users';
const HOST_USERS_PATH = process.env.HOST_USERS_PATH || '/opt/dployr/users';

// Container list cache configuration
const CONTAINER_CACHE_TTL = 5000; // 5 seconds TTL
let containerCache = null;
let containerCacheTime = 0;

/**
 * Gets all containers with caching to reduce Docker API calls
 * @returns {Promise<Array>} List of all containers
 */
async function getAllContainersCached() {
    const now = Date.now();
    if (containerCache && (now - containerCacheTime) < CONTAINER_CACHE_TTL) {
        return containerCache;
    }

    try {
        containerCache = await docker.listContainers({ all: true });
        containerCacheTime = now;
        return containerCache;
    } catch (error) {
        logger.error('Error fetching containers', { error: error.message });
        // Return cached data if available, even if stale
        if (containerCache) {
            return containerCache;
        }
        return [];
    }
}

/**
 * Invalidates the container cache (call after state-changing operations)
 */
function invalidateContainerCache() {
    containerCache = null;
    containerCacheTime = 0;
}

// Converts container path to host path for Docker commands
function toHostPath(containerPath) {
    if (containerPath.startsWith(USERS_PATH)) {
        return containerPath.replace(USERS_PATH, HOST_USERS_PATH);
    }
    return containerPath;
}

/**
 * Spawns a docker compose command without shell interpretation
 * @param {string} hostPath - Host path to the project directory
 * @param {string[]} args - Additional arguments for docker compose
 * @param {object} [options] - Options (timeout, maxStdout)
 * @returns {Promise<string>} stdout output
 */
function spawnCompose(hostPath, args, options = {}) {
    const { timeout, maxStdout = 5 * 1024 * 1024, onOutput } = options;
    const composeFile = path.join(hostPath, 'docker-compose.yml');
    const fullArgs = ['compose', '-f', composeFile, '--project-directory', hostPath, ...args];

    return new Promise((resolve, reject) => {
        const proc = spawn('docker', fullArgs);

        let stdout = '';
        let stderr = '';
        let stdoutOverflow = false;
        let timer;

        if (timeout) {
            timer = setTimeout(() => {
                proc.kill('SIGTERM');
                reject(new Error(`Command timed out after ${timeout}ms`));
            }, timeout);
        }

        proc.stdout.on('data', (data) => {
            if (!stdoutOverflow) {
                stdout += data.toString();
                if (stdout.length > maxStdout) {
                    stdoutOverflow = true;
                }
            }
            if (onOutput) onOutput(data.toString());
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
            if (onOutput) onOutput(data.toString());
        });

        proc.on('error', (err) => {
            if (timer) clearTimeout(timer);
            reject(err);
        });

        proc.on('close', (code) => {
            if (timer) clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(stderr || `Process exited with code ${code}`));
            } else {
                resolve(stdout);
            }
        });
    });
}

// Get container list for a user
async function getUserContainers(systemUsername) {
    const containers = await getAllContainersCached();

    // Filter containers belonging to the user (based on container name)
    return containers.filter(container => {
        const name = container.Names[0].replace('/', '');
        return name.startsWith(systemUsername + '-') ||
               container.Labels['com.webserver.user'] === systemUsername;
    });
}

// Get container status for a project
async function getProjectContainers(projectName) {
    const containers = await getAllContainersCached();

    return containers.filter(container => {
        const name = container.Names[0].replace('/', '');
        return name === projectName || name.startsWith(projectName + '-');
    });
}

// Start container
async function startContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.start();
        invalidateContainerCache();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Stop container
async function stopContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.stop();
        invalidateContainerCache();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Restart container
async function restartContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.restart();
        invalidateContainerCache();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Get container logs
async function getContainerLogs(containerId, lines = 100) {
    try {
        const container = docker.getContainer(containerId);
        const logs = await container.logs({
            stdout: true,
            stderr: true,
            tail: lines,
            timestamps: true
        });

        // Convert buffer to string and clean up
        return logs.toString('utf8')
            .split('\n')
            .map(line => line.substring(8)) // Remove Docker log prefix
            .filter(line => line.trim())
            .join('\n');
    } catch (error) {
        logger.error('Error fetching logs', { error: error.message });
        return 'Error loading logs: ' + error.message;
    }
}

// Start project with docker-compose
async function startProject(projectPath, options = {}) {
    const hostPath = toHostPath(projectPath);
    const args = ['up', '-d', ...(options.build ? ['--build'] : [])];
    try {
        return await spawnCompose(hostPath, args, { onOutput: options.onOutput });
    } finally {
        invalidateContainerCache();
    }
}

// Stop project with docker-compose
async function stopProject(projectPath, options = {}) {
    const hostPath = toHostPath(projectPath);
    try {
        return await spawnCompose(hostPath, ['down'], { onOutput: options.onOutput });
    } finally {
        invalidateContainerCache();
    }
}

// Restart project with docker-compose
async function restartProject(projectPath, options = {}) {
    const hostPath = toHostPath(projectPath);
    try {
        return await spawnCompose(hostPath, ['restart'], { onOutput: options.onOutput });
    } finally {
        invalidateContainerCache();
    }
}

// Get detailed service information for multi-container projects
async function getProjectServices(projectPath) {
    const hostPath = toHostPath(projectPath);
    try {
        const stdout = await spawnCompose(hostPath, ['ps', '--format', 'json']);
        // Each line is a JSON object
        const services = stdout.trim().split('\n')
            .filter(line => line.trim())
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(s => s !== null);
        return services;
    } catch {
        // If compose file doesn't exist or project not started, return empty
        return [];
    }
}

// Get logs for a specific service in a multi-container project
async function getServiceLogs(projectPath, serviceName, lines = 100) {
    const hostPath = toHostPath(projectPath);
    try {
        const stdout = await spawnCompose(hostPath, ['logs', '--tail', String(lines), serviceName], { maxStdout: 5 * 1024 * 1024 });
        return stdout || 'No logs available';
    } catch (error) {
        return `Error loading logs for ${serviceName}: ${error.message}`;
    }
}

// Restart a specific service in a multi-container project
async function restartService(projectPath, serviceName) {
    const hostPath = toHostPath(projectPath);
    return spawnCompose(hostPath, ['restart', serviceName]);
}

// Rebuild and restart project (for projects with build context)
async function rebuildProject(projectPath, options = {}) {
    const hostPath = toHostPath(projectPath);
    return spawnCompose(hostPath, ['up', '-d', '--build'], { timeout: 300000, onOutput: options.onOutput });
}

module.exports = {
    docker,
    getUserContainers,
    getProjectContainers,
    startContainer,
    stopContainer,
    restartContainer,
    getContainerLogs,
    startProject,
    stopProject,
    restartProject,
    // Multi-container support
    getProjectServices,
    getServiceLogs,
    restartService,
    rebuildProject,
    // Cache management (for testing)
    invalidateContainerCache
};
