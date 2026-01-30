/**
 * Update Service
 * Handles checking for updates and performing Dployr updates
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../config/logger');

const execAsync = promisify(exec);

// GitHub repository info
const GITHUB_OWNER = 'Flexomatic81';
const GITHUB_REPO = 'dployr';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

// Paths
const DPLOYR_PATH = process.env.HOST_DPLOYR_PATH || '/opt/dployr';
const DEPLOY_SCRIPT = path.join(DPLOYR_PATH, 'deploy.sh');

// Update channels
const UPDATE_CHANNELS = {
    stable: 'main',
    beta: 'dev'
};

// Cache for update check results
let updateCache = {
    lastCheck: null,
    currentVersion: null,
    latestVersion: null,
    updateAvailable: false,
    changelog: null,
    channel: null
};

/**
 * Get the current update channel
 * @returns {Promise<string>} 'stable' or 'beta'
 */
async function getUpdateChannel() {
    try {
        const envPath = path.join(DPLOYR_PATH, '.env');
        const content = await fs.readFile(envPath, 'utf8');
        const match = content.match(/^UPDATE_CHANNEL=(.+)$/m);
        const channel = match ? match[1].trim() : 'stable';
        return UPDATE_CHANNELS[channel] ? channel : 'stable';
    } catch {
        return 'stable';
    }
}

/**
 * Set the update channel
 * @param {string} channel - 'stable' or 'beta'
 * @returns {Promise<boolean>}
 */
async function setUpdateChannel(channel) {
    if (!UPDATE_CHANNELS[channel]) {
        throw new Error(`Invalid update channel: ${channel}`);
    }

    try {
        const envPath = path.join(DPLOYR_PATH, '.env');
        let content = '';

        try {
            content = await fs.readFile(envPath, 'utf8');
        } catch {
            // .env doesn't exist, create with just this setting
            content = '';
        }

        // Update or add UPDATE_CHANNEL
        if (content.match(/^UPDATE_CHANNEL=/m)) {
            content = content.replace(/^UPDATE_CHANNEL=.*/m, `UPDATE_CHANNEL=${channel}`);
        } else {
            content = content.trim() + `\nUPDATE_CHANNEL=${channel}\n`;
        }

        await fs.writeFile(envPath, content);

        // Clear cache to force re-check with new channel
        updateCache.lastCheck = null;
        updateCache.channel = channel;
        logger.info('Update channel changed', { channel });
        return true;
    } catch (error) {
        logger.error('Failed to set update channel', { error: error.message, channel });
        throw error;
    }
}

/**
 * Get the branch name for the current channel
 * @returns {Promise<string>}
 */
async function getUpdateBranch() {
    const channel = await getUpdateChannel();
    return UPDATE_CHANNELS[channel];
}

/**
 * Get the current installed version from git
 * @returns {Promise<{hash: string, date: string, tag: string|null}>}
 */
async function getCurrentVersion() {
    try {
        // Get current git hash
        const { stdout: hash } = await execAsync('git rev-parse --short HEAD', { cwd: DPLOYR_PATH });

        // Get commit date
        const { stdout: date } = await execAsync('git log -1 --format=%cd --date=format:\'%Y-%m-%d\'', { cwd: DPLOYR_PATH });

        // Try to get current tag (if on a release)
        // First fetch tags to ensure we have the latest from remote
        let tag = null;
        try {
            await execAsync('git fetch --tags 2>/dev/null || true', { cwd: DPLOYR_PATH });
            const { stdout: tagOutput } = await execAsync('git describe --tags --exact-match 2>/dev/null || echo ""', { cwd: DPLOYR_PATH });
            tag = tagOutput.trim() || null;
        } catch {
            // Not on a tag, that's fine
        }

        return {
            hash: hash.trim(),
            date: date.trim(),
            tag
        };
    } catch (error) {
        logger.error('Failed to get current version from git', { error: error.message });

        // Fallback: Try to read from version.json (set during docker build)
        try {
            const versionFile = path.join('/app', 'version.json');
            const versionData = JSON.parse(await fs.readFile(versionFile, 'utf8'));
            return {
                hash: versionData.hash || 'unknown',
                date: versionData.date || 'unknown',
                tag: versionData.tag || null
            };
        } catch {
            return {
                hash: process.env.GIT_HASH || 'unknown',
                date: process.env.GIT_DATE || 'unknown',
                tag: null
            };
        }
    }
}

/**
 * Get the latest release from GitHub
 * @returns {Promise<{tag: string, name: string, body: string, publishedAt: string, htmlUrl: string}|null>}
 */
async function getLatestRelease() {
    try {
        const response = await fetch(`${GITHUB_API_URL}/releases/latest`, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Dployr-Update-Checker'
            }
        });

        if (response.status === 404) {
            // No releases yet
            logger.info('No releases found on GitHub');
            return null;
        }

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const release = await response.json();

        return {
            tag: release.tag_name,
            name: release.name,
            body: release.body,
            publishedAt: release.published_at,
            htmlUrl: release.html_url
        };
    } catch (error) {
        logger.error('Failed to fetch latest release from GitHub', { error: error.message });
        return null;
    }
}

/**
 * Get commits since current version (for changelog when no releases)
 * @param {string} sinceHash - Git hash to get commits since
 * @param {string} branch - Branch to compare against
 * @returns {Promise<Array<{hash: string, message: string, date: string}>>}
 */
async function getCommitsSince(sinceHash, branch = 'main') {
    try {
        // Fetch latest from origin first
        await execAsync(`git fetch origin ${branch} --quiet`, { cwd: DPLOYR_PATH });

        // Get commits between current and origin/branch
        const { stdout } = await execAsync(
            `git log ${sinceHash}..origin/${branch} --oneline --format="%h|%s|%cd" --date=format:'%Y-%m-%d' 2>/dev/null || echo ""`,
            { cwd: DPLOYR_PATH }
        );

        if (!stdout.trim()) {
            return [];
        }

        return stdout.trim().split('\n').map(line => {
            const [hash, message, date] = line.split('|');
            return { hash, message, date };
        });
    } catch (error) {
        logger.error('Failed to get commits since', { error: error.message, sinceHash, branch });
        return [];
    }
}

/**
 * Check if an update is available
 * @param {boolean} force - Force check even if recently checked
 * @returns {Promise<{updateAvailable: boolean, currentVersion: object, latestVersion: object|null, changelog: string|null, channel: string}>}
 */
async function checkForUpdates(force = false) {
    const channel = await getUpdateChannel();
    const branch = UPDATE_CHANNELS[channel];

    // Return cached result if checked within last hour (unless forced) and channel hasn't changed
    const oneHour = 60 * 60 * 1000;
    if (!force && updateCache.lastCheck && updateCache.channel === channel && (Date.now() - updateCache.lastCheck) < oneHour) {
        return {
            updateAvailable: updateCache.updateAvailable,
            currentVersion: updateCache.currentVersion,
            latestVersion: updateCache.latestVersion,
            changelog: updateCache.changelog,
            channel,
            cached: true
        };
    }

    logger.info('Checking for updates...', { channel, branch });

    const currentVersion = await getCurrentVersion();

    let updateAvailable = false;
    let latestVersion = null;
    let changelog = null;

    // For stable channel, check releases first
    if (channel === 'stable') {
        const latestRelease = await getLatestRelease();
        if (latestRelease) {
            latestVersion = {
                tag: latestRelease.tag,
                name: latestRelease.name,
                publishedAt: latestRelease.publishedAt,
                htmlUrl: latestRelease.htmlUrl
            };

            // Check if update is needed:
            // 1. If tags match, no update needed
            // 2. If current tag is missing but hash matches release commit, no update needed
            if (currentVersion.tag !== latestRelease.tag) {
                // Tag mismatch - check if commit hash matches the release tag
                let releaseCommitHash = null;
                try {
                    // Get the commit SHA for the release tag using git ls-remote
                    // Use ^{} suffix to dereference annotated tags to their commit
                    const { stdout } = await execAsync(`git ls-remote origin "refs/tags/${latestRelease.tag}^{}"`, { cwd: DPLOYR_PATH });
                    let match = stdout.match(/^([a-f0-9]+)/);

                    // If ^{} returns nothing, it's a lightweight tag - try without ^{}
                    if (!match) {
                        const { stdout: lightweightOutput } = await execAsync(`git ls-remote origin refs/tags/${latestRelease.tag}`, { cwd: DPLOYR_PATH });
                        match = lightweightOutput.match(/^([a-f0-9]+)/);
                    }

                    if (match) {
                        releaseCommitHash = match[1].substring(0, 7);
                    }
                } catch {
                    // If we can't get the release commit, assume update is needed
                }

                // Only mark update available if hash also doesn't match
                if (!releaseCommitHash || currentVersion.hash !== releaseCommitHash) {
                    updateAvailable = true;
                    changelog = latestRelease.body;
                } else {
                    logger.info('Current commit matches release tag, no update needed', {
                        currentHash: currentVersion.hash,
                        releaseTag: latestRelease.tag
                    });
                }
            }
        }
    }

    // If no release found (or beta channel), check for new commits
    if (!latestVersion) {
        const commits = await getCommitsSince(currentVersion.hash, branch);
        if (commits.length > 0) {
            updateAvailable = true;
            latestVersion = {
                commits: commits.length,
                latestHash: commits[0]?.hash,
                branch
            };
            changelog = commits.map(c => `- ${c.message} (${c.hash})`).join('\n');
        }
    }

    // Update cache
    updateCache = {
        lastCheck: Date.now(),
        currentVersion,
        latestVersion,
        updateAvailable,
        changelog,
        channel
    };

    logger.info('Update check complete', {
        updateAvailable,
        channel,
        currentVersion: currentVersion.tag || currentVersion.hash,
        latestVersion: latestVersion?.tag || latestVersion?.latestHash || 'none'
    });

    return {
        updateAvailable,
        currentVersion,
        latestVersion,
        changelog,
        channel,
        cached: false
    };
}

/**
 * Perform the update
 * @returns {Promise<{success: boolean, message: string, output: string}>}
 */
async function performUpdate() {
    const channel = await getUpdateChannel();
    const branch = UPDATE_CHANNELS[channel];

    logger.info('Starting Dployr update...', { channel, branch });

    try {
        // Check if deploy script exists
        try {
            await fs.access(DEPLOY_SCRIPT);
        } catch {
            throw new Error(`Deploy script not found at ${DEPLOY_SCRIPT}`);
        }

        // Execute the deploy script with branch parameter
        // Timeout increased to 15 minutes to allow workspace image rebuild
        const { stdout, stderr } = await execAsync(`bash ${DEPLOY_SCRIPT} --branch ${branch}`, {
            cwd: DPLOYR_PATH,
            timeout: 900000, // 15 minute timeout (workspace image build can take 5-10 min)
            env: {
                ...process.env,
                PATH: process.env.PATH
            }
        });

        const output = stdout + (stderr ? `\n${stderr}` : '');
        logger.info('Update completed successfully', { output: output.substring(0, 500), branch });

        // Clear cache to force re-check
        updateCache.lastCheck = null;

        return {
            success: true,
            message: 'Update completed successfully. The dashboard will restart shortly.',
            output
        };
    } catch (error) {
        logger.error('Update failed', { error: error.message, branch });
        return {
            success: false,
            message: `Update failed: ${error.message}`,
            output: error.stdout || error.stderr || ''
        };
    }
}

/**
 * Get cached update status (for displaying badge)
 * @returns {{updateAvailable: boolean, lastCheck: Date|null}}
 */
function getCachedUpdateStatus() {
    return {
        updateAvailable: updateCache.updateAvailable,
        lastCheck: updateCache.lastCheck ? new Date(updateCache.lastCheck) : null
    };
}

/**
 * Initialize update checker - runs on app start
 * Performs initial check and schedules daily checks
 */
function initUpdateChecker() {
    // Check on startup (delayed by 30 seconds to let app fully start)
    setTimeout(async () => {
        try {
            await checkForUpdates();
            logger.info('Initial update check completed');
        } catch (error) {
            logger.error('Initial update check failed', { error: error.message });
        }
    }, 30000);

    // Schedule check every 12 hours
    setInterval(async () => {
        try {
            await checkForUpdates(true);
            logger.info('Scheduled update check completed');
        } catch (error) {
            logger.error('Scheduled update check failed', { error: error.message });
        }
    }, 12 * 60 * 60 * 1000);

    logger.info('Update checker initialized');
}

module.exports = {
    getCurrentVersion,
    getLatestRelease,
    checkForUpdates,
    performUpdate,
    getCachedUpdateStatus,
    initUpdateChecker,
    getUpdateChannel,
    setUpdateChannel,
    UPDATE_CHANNELS
};
