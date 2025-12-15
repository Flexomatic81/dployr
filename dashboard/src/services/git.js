const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const USERS_PATH = process.env.USERS_PATH || '/app/users';

/**
 * Prüft ob ein Projekt ein Git-Repository ist
 */
function isGitRepository(projectPath) {
    const gitDir = path.join(projectPath, '.git');
    return fs.existsSync(gitDir);
}

/**
 * Holt Git-Status-Informationen für ein Projekt
 */
function getGitStatus(projectPath) {
    if (!isGitRepository(projectPath)) {
        return null;
    }

    try {
        const remoteUrl = execSync('git config --get remote.origin.url', {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: 5000
        }).trim();

        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: 5000
        }).trim();

        const lastCommit = execSync('git log -1 --format="%h - %s (%ar)"', {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: 5000
        }).trim();

        // Prüfen ob lokale Änderungen existieren
        let hasLocalChanges = false;
        try {
            execSync('git diff --quiet && git diff --cached --quiet', {
                cwd: projectPath,
                timeout: 5000
            });
        } catch {
            hasLocalChanges = true;
        }

        // URL für Anzeige bereinigen (Token entfernen)
        const displayUrl = sanitizeUrlForDisplay(remoteUrl);

        return {
            connected: true,
            remoteUrl: displayUrl,
            branch,
            lastCommit,
            hasLocalChanges
        };
    } catch (error) {
        console.error('Git status error:', error.message);
        return {
            connected: true,
            error: 'Fehler beim Abrufen des Git-Status'
        };
    }
}

/**
 * Entfernt Credentials aus der URL für die Anzeige
 */
function sanitizeUrlForDisplay(url) {
    // https://token@github.com/user/repo -> https://github.com/user/repo
    return url.replace(/https:\/\/[^@]+@/, 'https://');
}

/**
 * Erstellt eine authentifizierte URL für private Repos
 */
function createAuthenticatedUrl(repoUrl, token) {
    if (!token) return repoUrl;

    // https://github.com/user/repo -> https://TOKEN@github.com/user/repo
    if (repoUrl.startsWith('https://')) {
        return repoUrl.replace('https://', `https://${token}@`);
    }
    return repoUrl;
}

/**
 * Klont ein Git-Repository in ein Projekt-Verzeichnis
 */
async function cloneRepository(projectPath, repoUrl, token = null) {
    // Prüfen ob Verzeichnis existiert und nicht leer ist
    if (fs.existsSync(projectPath)) {
        const files = fs.readdirSync(projectPath);
        // Erlaubt: leeres Verzeichnis oder nur docker-compose.yml und nginx
        const allowedFiles = ['docker-compose.yml', 'nginx', '.git'];
        const hasOtherFiles = files.some(f => !allowedFiles.includes(f));

        if (hasOtherFiles) {
            throw new Error('Projekt-Verzeichnis enthält bereits Dateien. Bitte erst bereinigen.');
        }
    }

    const authenticatedUrl = createAuthenticatedUrl(repoUrl, token);

    return new Promise((resolve, reject) => {
        // Clone in temporäres Verzeichnis, dann verschieben
        const tempDir = `${projectPath}_temp_${Date.now()}`;

        exec(`git clone "${authenticatedUrl}" "${tempDir}"`, {
            timeout: 120000 // 2 Minuten Timeout
        }, async (error, stdout, stderr) => {
            if (error) {
                // Temporäres Verzeichnis aufräumen bei Fehler
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch {}

                // Token aus Fehlermeldung entfernen
                const cleanError = stderr.replace(/https:\/\/[^@]+@/g, 'https://***@');
                reject(new Error(`Git clone fehlgeschlagen: ${cleanError}`));
                return;
            }

            try {
                // Existierende Dateien sichern (docker-compose.yml, nginx)
                const backups = {};
                const filesToPreserve = ['docker-compose.yml', 'nginx'];

                for (const file of filesToPreserve) {
                    const filePath = path.join(projectPath, file);
                    if (fs.existsSync(filePath)) {
                        if (fs.statSync(filePath).isDirectory()) {
                            backups[file] = { isDir: true, path: filePath };
                        } else {
                            backups[file] = { isDir: false, content: fs.readFileSync(filePath) };
                        }
                    }
                }

                // Altes Verzeichnis leeren (außer .git falls vorhanden)
                const oldFiles = fs.readdirSync(projectPath);
                for (const file of oldFiles) {
                    const filePath = path.join(projectPath, file);
                    fs.rmSync(filePath, { recursive: true, force: true });
                }

                // Dateien aus temp verschieben
                const newFiles = fs.readdirSync(tempDir);
                for (const file of newFiles) {
                    const src = path.join(tempDir, file);
                    const dest = path.join(projectPath, file);
                    fs.renameSync(src, dest);
                }

                // Gesicherte Dateien wiederherstellen (überschreiben falls nötig)
                for (const [file, backup] of Object.entries(backups)) {
                    const filePath = path.join(projectPath, file);
                    if (backup.isDir) {
                        // Verzeichnisse werden nicht überschrieben,
                        // das geklonte Repo könnte ein eigenes nginx haben
                    } else {
                        fs.writeFileSync(filePath, backup.content);
                    }
                }

                // Temp-Verzeichnis löschen
                fs.rmSync(tempDir, { recursive: true, force: true });

                // Token in .git-credentials speichern für spätere Pulls
                if (token) {
                    saveCredentials(projectPath, repoUrl, token);
                }

                resolve({
                    success: true,
                    message: 'Repository erfolgreich geklont'
                });
            } catch (err) {
                // Aufräumen bei Fehler
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch {}
                reject(new Error(`Fehler beim Verschieben der Dateien: ${err.message}`));
            }
        });
    });
}

/**
 * Speichert Credentials für ein Repository
 */
function saveCredentials(projectPath, repoUrl, token) {
    const credentialsPath = path.join(projectPath, '.git-credentials');
    const url = new URL(repoUrl);
    const credentialLine = `https://${token}@${url.host}${url.pathname}`;

    fs.writeFileSync(credentialsPath, credentialLine + '\n', { mode: 0o600 });

    // Git konfigurieren, diese Credentials zu nutzen
    execSync(`git config credential.helper "store --file=.git-credentials"`, {
        cwd: projectPath
    });
}

/**
 * Pullt die neuesten Änderungen vom Remote
 */
async function pullChanges(projectPath) {
    if (!isGitRepository(projectPath)) {
        throw new Error('Kein Git-Repository');
    }

    return new Promise((resolve, reject) => {
        exec('git pull', {
            cwd: projectPath,
            timeout: 60000 // 1 Minute Timeout
        }, (error, stdout, stderr) => {
            if (error) {
                const cleanError = stderr.replace(/https:\/\/[^@]+@/g, 'https://***@');
                reject(new Error(`Git pull fehlgeschlagen: ${cleanError}`));
                return;
            }

            // Prüfen ob Änderungen gepullt wurden
            const hasChanges = !stdout.includes('Already up to date') &&
                               !stdout.includes('Bereits aktuell');

            resolve({
                success: true,
                hasChanges,
                output: stdout.trim()
            });
        });
    });
}

/**
 * Entfernt die Git-Verbindung von einem Projekt
 */
function disconnectRepository(projectPath) {
    const gitDir = path.join(projectPath, '.git');
    const credentialsFile = path.join(projectPath, '.git-credentials');

    if (fs.existsSync(gitDir)) {
        fs.rmSync(gitDir, { recursive: true, force: true });
    }

    if (fs.existsSync(credentialsFile)) {
        fs.unlinkSync(credentialsFile);
    }

    return { success: true, message: 'Git-Verbindung entfernt' };
}

/**
 * Validiert eine Git-Repository-URL
 */
function isValidGitUrl(url) {
    // Unterstützt: https://github.com/user/repo.git oder https://github.com/user/repo
    const httpsPattern = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+(\.git)?$/;
    return httpsPattern.test(url);
}

/**
 * Holt den Projekt-Pfad für einen User
 */
function getProjectPath(systemUsername, projectName) {
    return path.join(USERS_PATH, systemUsername, projectName);
}

module.exports = {
    isGitRepository,
    getGitStatus,
    cloneRepository,
    pullChanges,
    disconnectRepository,
    isValidGitUrl,
    getProjectPath
};
