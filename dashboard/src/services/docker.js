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
async function startProject(projectPath) {
    const { exec } = require('child_process');
    const hostPath = toHostPath(projectPath);
    return new Promise((resolve, reject) => {
        exec(`docker compose -f "${hostPath}/docker-compose.yml" --project-directory "${hostPath}" up -d`, (error, stdout, stderr) => {
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
    restartProject
};
