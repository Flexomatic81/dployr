/**
 * Tests for operationErrors service
 */

const operationErrors = require('../../src/services/operationErrors');

describe('operationErrors', () => {
    beforeEach(() => {
        // Clean up between tests
        operationErrors.clearError('test-project');
        operationErrors.clearError('project-a');
        operationErrors.clearError('project-b');
    });

    describe('setError / getError', () => {
        it('should store and retrieve an error', () => {
            operationErrors.setError('test-project', 'started', 'Container failed to start');

            const result = operationErrors.getError('test-project');
            expect(result).toEqual({
                operation: 'started',
                error: 'Container failed to start'
            });
        });

        it('should return null when no error exists', () => {
            const result = operationErrors.getError('nonexistent-project');
            expect(result).toBeNull();
        });
    });

    describe('consume-once behavior', () => {
        it('should delete error after first read', () => {
            operationErrors.setError('test-project', 'started', 'Build failed');

            const first = operationErrors.getError('test-project');
            expect(first).not.toBeNull();
            expect(first.error).toBe('Build failed');

            const second = operationErrors.getError('test-project');
            expect(second).toBeNull();
        });
    });

    describe('TTL expiration', () => {
        it('should return null for expired errors', () => {
            operationErrors.setError('test-project', 'started', 'Old error');

            // Manually tamper with the timestamp to simulate expiration
            // Access internal state via a fresh setError + getError cycle
            // Instead, we test by using jest fake timers
            jest.useFakeTimers();

            operationErrors.setError('test-project', 'started', 'Expired error');

            // Advance time past TTL (5 minutes + 1ms)
            jest.advanceTimersByTime(5 * 60 * 1000 + 1);

            const result = operationErrors.getError('test-project');
            expect(result).toBeNull();

            jest.useRealTimers();
        });

        it('should return error within TTL', () => {
            jest.useFakeTimers();

            operationErrors.setError('test-project', 'started', 'Recent error');

            // Advance time but stay within TTL
            jest.advanceTimersByTime(4 * 60 * 1000);

            const result = operationErrors.getError('test-project');
            expect(result).not.toBeNull();
            expect(result.error).toBe('Recent error');

            jest.useRealTimers();
        });
    });

    describe('truncation', () => {
        it('should truncate long error messages to last 500 characters', () => {
            const longMessage = 'x'.repeat(1000);
            operationErrors.setError('test-project', 'started', longMessage);

            const result = operationErrors.getError('test-project');
            expect(result.error).toHaveLength(500);
            expect(result.error).toBe('x'.repeat(500));
        });

        it('should not truncate messages at or below 500 characters', () => {
            const exactMessage = 'y'.repeat(500);
            operationErrors.setError('test-project', 'started', exactMessage);

            const result = operationErrors.getError('test-project');
            expect(result.error).toHaveLength(500);
        });
    });

    describe('clearError', () => {
        it('should remove a stored error', () => {
            operationErrors.setError('test-project', 'started', 'Some error');
            operationErrors.clearError('test-project');

            const result = operationErrors.getError('test-project');
            expect(result).toBeNull();
        });

        it('should not throw when clearing nonexistent project', () => {
            expect(() => {
                operationErrors.clearError('nonexistent');
            }).not.toThrow();
        });
    });

    describe('overwrite', () => {
        it('should overwrite previous error for same project', () => {
            operationErrors.setError('test-project', 'started', 'First error');
            operationErrors.setError('test-project', 'rebuilt', 'Second error');

            const result = operationErrors.getError('test-project');
            expect(result).toEqual({
                operation: 'rebuilt',
                error: 'Second error'
            });
        });
    });

    describe('isolation', () => {
        it('should keep errors separate per project', () => {
            operationErrors.setError('project-a', 'started', 'Error A');
            operationErrors.setError('project-b', 'rebuilt', 'Error B');

            const resultA = operationErrors.getError('project-a');
            expect(resultA.error).toBe('Error A');

            const resultB = operationErrors.getError('project-b');
            expect(resultB.error).toBe('Error B');
        });
    });
});
