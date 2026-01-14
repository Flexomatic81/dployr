const Docker = require('dockerode');
const { logger } = require('../config/logger');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const USERS_PATH = process.env.USERS_PATH || '/app/users';
const HOST_USERS_PATH = process.env.HOST_USERS_PATH || '/opt/dployr/users';

// Converts container path to host path for Docker commands
function toHostPath(containerPath) {
    if (containerPath.startsWith(USERS_PATH)) {
        return containerPath.replace(USERS_PATH, HOST_USERS_PATH);
    }
    return containerPath;
}

// Get container list for a user
async function getUserContainers(systemUsername) {
    try {
        const containers = await docker.listContainers({ all: true });

        // Filter containers belonging to the user (based on container name)
        return containers.filter(container => {
            const name = container.Names[0].replace('/', '');
            return name.startsWith(systemUsername + '-') ||
                   container.Labels['com.webserver.user'] === systemUsername;
        });
    } catch (error) {
        logger.error('Error fetching containers', { error: error.message });
        return [];
    }
}

// Get container status for a project
async function getProjectContainers(projectName) {
    try {
        const containers = await docker.listContainers({ all: true });

        return containers.filter(container => {
            const name = container.Names[0].replace('/', '');
            return name === projectName || name.startsWith(projectName + '-');
        });
    } catch (error) {
        logger.error('Error fetching project containers', { error: error.message });
        return [];
    }
}

// Start container
async function startContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.start();
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
    const { exec } = require('child_process');
    const hostPath = toHostPath(projectPath);
    const buildFlag = options.build ? ' --build' : '';
    return new Promise((resolve, reject) => {
        exec(`docker compose -f "${hostPath}/docker-compose.yml" --project-directory "${hostPath}" up -d${buildFlag}`, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
            } else {
                resolve(stdout);
            }
        });
    });
}

// Stop project with docker-compose
async function stopProject(projectPath) {
    const { exec } = require('child_process');
    const hostPath = toHostPath(projectPath);
    return new Promise((resolve, reject) => {
        exec(`docker compose -f "${hostPath}/docker-compose.yml" --project-directory "${hostPath}" down`, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
            } else {
                resolve(stdout);
            }
        });
    });
}

// Restart project with docker-compose
async function restartProject(projectPath) {
    const { exec } = require('child_process');
    const hostPath = toHostPath(projectPath);
    return new Promise((resolve, reject) => {
        exec(`docker compose -f "${hostPath}/docker-compose.yml" --project-directory "${hostPath}" restart`, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
            } else {
                resolve(stdout);
            }
        });
    });
}

// Get detailed service information for multi-container projects
async function getProjectServices(projectPath) {
    const { exec } = require('child_process');
    const hostPath = toHostPath(projectPath);
    return new Promise((resolve, reject) => {
        exec(
            `docker compose -f "${hostPath}/docker-compose.yml" --project-directory "${hostPath}" ps --format json`,
            (error, stdout, stderr) => {
                if (error) {
                    // If compose file doesn't exist or project not started, return empty
                    resolve([]);
                } else {
                    try {
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
                        resolve(services);
                    } catch (e) {
                        resolve([]);
                    }
                }
            }
        );
    });
}

// Get logs for a specific service in a multi-container project
async function getServiceLogs(projectPath, serviceName, lines = 100) {
    const { exec } = require('child_process');
    const hostPath = toHostPath(projectPath);
    return new Promise((resolve, reject) => {
        exec(
            `docker compose -f "${hostPath}/docker-compose.yml" --project-directory "${hostPath}" logs --tail ${lines} ${serviceName}`,
            { maxBuffer: 1024 * 1024 * 5 }, // 5MB buffer
            (error, stdout, stderr) => {
                if (error) {
                    resolve(`Error loading logs for ${serviceName}: ${error.message}`);
                } else {
                    resolve(stdout || stderr || 'No logs available');
                }
            }
        );
    });
}

// Restart a specific service in a multi-container project
async function restartService(projectPath, serviceName) {
    const { exec } = require('child_process');
    const hostPath = toHostPath(projectPath);
    return new Promise((resolve, reject) => {
        exec(
            `docker compose -f "${hostPath}/docker-compose.yml" --project-directory "${hostPath}" restart ${serviceName}`,
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout);
                }
            }
        );
    });
}

// Rebuild and restart project (for projects with build context)
async function rebuildProject(projectPath) {
    const { exec } = require('child_process');
    const hostPath = toHostPath(projectPath);
    return new Promise((resolve, reject) => {
        exec(
            `docker compose -f "${hostPath}/docker-compose.yml" --project-directory "${hostPath}" up -d --build`,
            { timeout: 300000 }, // 5 minute timeout for builds
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout);
                }
            }
        );
    });
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
    rebuildProject
};
