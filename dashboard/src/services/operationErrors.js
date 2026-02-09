/**
 * In-memory store for async project operation errors.
 * Allows the status polling endpoint to return errors immediately
 * instead of waiting for a timeout.
 */

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_LENGTH = 500;

// Map<projectName, { operation, error, timestamp }>
const errors = new Map();

/**
 * Store an error for a project operation.
 * Truncates the message to the last MAX_LENGTH characters.
 */
function setError(projectName, operation, errorMessage) {
    const truncated = errorMessage.length > MAX_LENGTH
        ? errorMessage.slice(-MAX_LENGTH)
        : errorMessage;

    errors.set(projectName, {
        operation,
        error: truncated,
        timestamp: Date.now()
    });
}

/**
 * Get and consume an error for a project (consume-once).
 * Returns null if no error exists or if expired.
 */
function getError(projectName) {
    const entry = errors.get(projectName);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > TTL_MS) {
        errors.delete(projectName);
        return null;
    }

    // Consume-once: delete after reading
    errors.delete(projectName);
    return { operation: entry.operation, error: entry.error };
}

/**
 * Clear any stored error for a project (call before starting a new operation).
 */
function clearError(projectName) {
    errors.delete(projectName);
}

module.exports = { setError, getError, clearError };
