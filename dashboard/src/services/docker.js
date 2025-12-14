const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const USERS_PATH = process.env.USERS_PATH || '/app/users';
const HOST_USERS_PATH = process.env.HOST_USERS_PATH || '/opt/deployr/users';

// Konvertiert Container-Pfad zu Host-Pfad für Docker-Befehle
function toHostPath(containerPath) {
    if (containerPath.startsWith(USERS_PATH)) {
        return containerPath.replace(USERS_PATH, HOST_USERS_PATH);
    }
    return containerPath;
}

// Container-Liste für einen User abrufen
async function getUserContainers(systemUsername) {
    try {
        const containers = await docker.listContainers({ all: true });

        // Filter Container die zum User gehören (basierend auf Container-Namen)
        return containers.filter(container => {
            const name = container.Names[0].replace('/', '');
            return name.startsWith(systemUsername + '-') ||
                   container.Labels['com.webserver.user'] === systemUsername;
        });
    } catch (error) {
        console.error('Fehler beim Abrufen der Container:', error);
        return [];
    }
}

// Container-Status für ein Projekt abrufen
async function getProjectContainers(projectName) {
    try {
        const containers = await docker.listContainers({ all: true });

        return containers.filter(container => {
            const name = container.Names[0].replace('/', '');
            return name === projectName || name.startsWith(projectName + '-');
        });
    } catch (error) {
        console.error('Fehler beim Abrufen der Projekt-Container:', error);
        return [];
    }
}

// Container starten
async function startContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.start();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Container stoppen
async function stopContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.stop();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Container neustarten
async function restartContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.restart();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Container-Logs abrufen
async function getContainerLogs(containerId, lines = 100) {
    try {
        const container = docker.getContainer(containerId);
        const logs = await container.logs({
            stdout: true,
            stderr: true,
            tail: lines,
            timestamps: true
        });

        // Buffer zu String konvertieren und bereinigen
        return logs.toString('utf8')
            .split('\n')
            .map(line => line.substring(8)) // Docker log prefix entfernen
            .filter(line => line.trim())
            .join('\n');
    } catch (error) {
        console.error('Fehler beim Abrufen der Logs:', error);
        return 'Fehler beim Laden der Logs: ' + error.message;
    }
}

// Projekt mit docker-compose starten
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

// Projekt mit docker-compose stoppen
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

// Projekt mit docker-compose neustarten
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
