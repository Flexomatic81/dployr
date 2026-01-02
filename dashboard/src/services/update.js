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

// Cache for update check results
let updateCache = {
    lastCheck: null,
    currentVersion: null,
    latestVersion: null,
    updateAvailable: false,
    changelog: null
};

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
        let tag = null;
        try {
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
        logger.error('Failed to get current version', { error: error.message });

        // Fallback: Try to read from build args (set during docker build)
        return {
            hash: process.env.GIT_HASH || 'unknown',
            date: process.env.GIT_DATE || 'unknown',
            tag: null
        };
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
 * @returns {Promise<Array<{hash: string, message: string, date: string}>>}
 */
async function getCommitsSince(sinceHash) {
    try {
        // Fetch latest from origin first
        await execAsync('git fetch origin main --quiet', { cwd: DPLOYR_PATH });

        // Get commits between current and origin/main
        const { stdout } = await execAsync(
            `git log ${sinceHash}..origin/main --oneline --format="%h|%s|%cd" --date=format:'%Y-%m-%d' 2>/dev/null || echo ""`,
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
        logger.error('Failed to get commits since', { error: error.message, sinceHash });
        return [];
    }
}

/**
 * Check if an update is available
 * @param {boolean} force - Force check even if recently checked
 * @returns {Promise<{updateAvailable: boolean, currentVersion: object, latestVersion: object|null, changelog: string|null}>}
 */
async function checkForUpdates(force = false) {
    // Return cached result if checked within last hour (unless forced)
    const oneHour = 60 * 60 * 1000;
    if (!force && updateCache.lastCheck && (Date.now() - updateCache.lastCheck) < oneHour) {
        return {
            updateAvailable: updateCache.updateAvailable,
            currentVersion: updateCache.currentVersion,
            latestVersion: updateCache.latestVersion,
            changelog: updateCache.changelog,
            cached: true
        };
    }

    logger.info('Checking for updates...');

    const currentVersion = await getCurrentVersion();
    const latestRelease = await getLatestRelease();

    let updateAvailable = false;
    let latestVersion = null;
    let changelog = null;

    if (latestRelease) {
        // Compare with release tag
        latestVersion = {
            tag: latestRelease.tag,
            name: latestRelease.name,
            publishedAt: latestRelease.publishedAt,
            htmlUrl: latestRelease.htmlUrl
        };

        // Update available if current tag doesn't match latest release
        // or if we're not on a tag at all
        if (currentVersion.tag !== latestRelease.tag) {
            updateAvailable = true;
            changelog = latestRelease.body;
        }
    } else {
        // No releases - check for new commits on main
        const commits = await getCommitsSince(currentVersion.hash);
        if (commits.length > 0) {
            updateAvailable = true;
            latestVersion = {
                commits: commits.length,
                latestHash: commits[0]?.hash
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
        changelog
    };

    logger.info('Update check complete', {
        updateAvailable,
        currentVersion: currentVersion.tag || currentVersion.hash,
        latestVersion: latestVersion?.tag || latestVersion?.latestHash || 'none'
    });

    return {
        updateAvailable,
        currentVersion,
        latestVersion,
        changelog,
        cached: false
    };
}

/**
 * Perform the update
 * @returns {Promise<{success: boolean, message: string, output: string}>}
 */
async function performUpdate() {
    logger.info('Starting Dployr update...');

    try {
        // Check if deploy script exists
        try {
            await fs.access(DEPLOY_SCRIPT);
        } catch {
            throw new Error(`Deploy script not found at ${DEPLOY_SCRIPT}`);
        }

        // Execute the deploy script
        const { stdout, stderr } = await execAsync(`bash ${DEPLOY_SCRIPT}`, {
            cwd: DPLOYR_PATH,
            timeout: 300000, // 5 minute timeout
            env: {
                ...process.env,
                PATH: process.env.PATH
            }
        });

        const output = stdout + (stderr ? `\n${stderr}` : '');
        logger.info('Update completed successfully', { output: output.substring(0, 500) });

        // Clear cache to force re-check
        updateCache.lastCheck = null;

        return {
            success: true,
            message: 'Update completed successfully. The dashboard will restart shortly.',
            output
        };
    } catch (error) {
        logger.error('Update failed', { error: error.message });
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

    // Schedule daily check (every 24 hours)
    setInterval(async () => {
        try {
            await checkForUpdates(true);
            logger.info('Scheduled update check completed');
        } catch (error) {
            logger.error('Scheduled update check failed', { error: error.message });
        }
    }, 24 * 60 * 60 * 1000);

    logger.info('Update checker initialized');
}

module.exports = {
    getCurrentVersion,
    getLatestRelease,
    checkForUpdates,
    performUpdate,
    getCachedUpdateStatus,
    initUpdateChecker
};
