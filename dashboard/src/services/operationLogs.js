/**
 * In-memory log buffer for async project operations.
 * Captures docker compose stdout/stderr and streams it via SSE.
 */

const CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes after finish
const MAX_LINES = 5000;

// Map<projectName, { lines: string[], active: boolean, error: string|null, cleanupTimer: NodeJS.Timeout|null }>
const buffers = new Map();

/**
 * Start capturing output for a project operation.
 * Returns an onOutput(chunk) writer function.
 * If a previous capture exists, it is overwritten.
 */
function startCapture(projectName) {
    // Clear any existing cleanup timer
    const existing = buffers.get(projectName);
    if (existing && existing.cleanupTimer) {
        clearTimeout(existing.cleanupTimer);
    }

    const entry = {
        lines: [],
        active: true,
        error: null,
        cleanupTimer: null
    };
    buffers.set(projectName, entry);

    // Return writer function
    return function onOutput(chunk) {
        if (!entry.active && entry !== buffers.get(projectName)) return;
        const newLines = chunk.split('\n').filter(l => l.length > 0);
        for (const line of newLines) {
            if (entry.lines.length < MAX_LINES) {
                entry.lines.push(line);
            }
        }
    };
}

/**
 * Get lines from the buffer starting at fromIndex.
 * Returns { lines: string[], nextIndex: number } or null if no buffer.
 */
function getLines(projectName, fromIndex = 0) {
    const entry = buffers.get(projectName);
    if (!entry) return null;

    const lines = entry.lines.slice(fromIndex);
    return { lines, nextIndex: entry.lines.length };
}

/**
 * Mark operation as finished. Optionally store an error message.
 * Auto-cleanup after CLEANUP_DELAY_MS.
 */
function finish(projectName, error = null) {
    const entry = buffers.get(projectName);
    if (!entry) return;

    entry.active = false;
    entry.error = error || null;

    entry.cleanupTimer = setTimeout(() => {
        buffers.delete(projectName);
    }, CLEANUP_DELAY_MS);
}

/**
 * Get the current state of the log buffer.
 * Returns { active, lines, error } or null.
 */
function getState(projectName) {
    const entry = buffers.get(projectName);
    if (!entry) return null;

    return {
        active: entry.active,
        lines: entry.lines,
        error: entry.error
    };
}

/**
 * Clear a buffer entry (for testing).
 */
function clear(projectName) {
    const entry = buffers.get(projectName);
    if (entry && entry.cleanupTimer) {
        clearTimeout(entry.cleanupTimer);
    }
    buffers.delete(projectName);
}

module.exports = { startCapture, getLines, finish, getState, clear };
