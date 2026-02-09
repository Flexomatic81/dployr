/**
 * Tests for operationLogs service
 */

const operationLogs = require('../../src/services/operationLogs');

describe('operationLogs', () => {
    afterEach(() => {
        operationLogs.clear('test-project');
        operationLogs.clear('project-a');
        operationLogs.clear('project-b');
    });

    describe('startCapture', () => {
        it('should return a writer function', () => {
            const onOutput = operationLogs.startCapture('test-project');
            expect(typeof onOutput).toBe('function');
        });

        it('should create an active buffer', () => {
            operationLogs.startCapture('test-project');
            const state = operationLogs.getState('test-project');
            expect(state).not.toBeNull();
            expect(state.active).toBe(true);
            expect(state.lines).toEqual([]);
            expect(state.error).toBeNull();
        });
    });

    describe('onOutput writer', () => {
        it('should capture output lines', () => {
            const onOutput = operationLogs.startCapture('test-project');
            onOutput('Building image...\n');
            onOutput('Step 1/5\nStep 2/5\n');

            const state = operationLogs.getState('test-project');
            expect(state.lines).toEqual(['Building image...', 'Step 1/5', 'Step 2/5']);
        });

        it('should ignore empty lines from split', () => {
            const onOutput = operationLogs.startCapture('test-project');
            onOutput('line1\n\nline2\n');

            const state = operationLogs.getState('test-project');
            expect(state.lines).toEqual(['line1', 'line2']);
        });

        it('should handle chunks without newlines', () => {
            const onOutput = operationLogs.startCapture('test-project');
            onOutput('partial output');

            const state = operationLogs.getState('test-project');
            expect(state.lines).toEqual(['partial output']);
        });
    });

    describe('getLines', () => {
        it('should return null when no buffer exists', () => {
            const result = operationLogs.getLines('nonexistent');
            expect(result).toBeNull();
        });

        it('should return all lines from index 0', () => {
            const onOutput = operationLogs.startCapture('test-project');
            onOutput('line1\nline2\nline3\n');

            const result = operationLogs.getLines('test-project', 0);
            expect(result.lines).toEqual(['line1', 'line2', 'line3']);
            expect(result.nextIndex).toBe(3);
        });

        it('should return new lines from a given index', () => {
            const onOutput = operationLogs.startCapture('test-project');
            onOutput('line1\nline2\n');

            // First read
            const first = operationLogs.getLines('test-project', 0);
            expect(first.nextIndex).toBe(2);

            // More output
            onOutput('line3\n');

            // Second read from previous nextIndex
            const second = operationLogs.getLines('test-project', first.nextIndex);
            expect(second.lines).toEqual(['line3']);
            expect(second.nextIndex).toBe(3);
        });

        it('should return empty array when no new lines', () => {
            const onOutput = operationLogs.startCapture('test-project');
            onOutput('line1\n');

            const first = operationLogs.getLines('test-project', 0);
            const second = operationLogs.getLines('test-project', first.nextIndex);
            expect(second.lines).toEqual([]);
        });
    });

    describe('finish', () => {
        it('should mark buffer as inactive', () => {
            operationLogs.startCapture('test-project');
            operationLogs.finish('test-project');

            const state = operationLogs.getState('test-project');
            expect(state.active).toBe(false);
            expect(state.error).toBeNull();
        });

        it('should store error message when provided', () => {
            operationLogs.startCapture('test-project');
            operationLogs.finish('test-project', 'Build failed');

            const state = operationLogs.getState('test-project');
            expect(state.active).toBe(false);
            expect(state.error).toBe('Build failed');
        });

        it('should not throw for nonexistent project', () => {
            expect(() => {
                operationLogs.finish('nonexistent');
            }).not.toThrow();
        });
    });

    describe('auto-cleanup', () => {
        it('should remove buffer after cleanup delay', () => {
            jest.useFakeTimers();

            operationLogs.startCapture('test-project');
            operationLogs.finish('test-project');

            // Buffer still exists immediately after finish
            expect(operationLogs.getState('test-project')).not.toBeNull();

            // Advance past 5-minute cleanup delay
            jest.advanceTimersByTime(5 * 60 * 1000 + 1);

            expect(operationLogs.getState('test-project')).toBeNull();

            jest.useRealTimers();
        });

        it('should not remove buffer before cleanup delay', () => {
            jest.useFakeTimers();

            operationLogs.startCapture('test-project');
            operationLogs.finish('test-project');

            jest.advanceTimersByTime(4 * 60 * 1000);

            expect(operationLogs.getState('test-project')).not.toBeNull();

            jest.useRealTimers();
        });
    });

    describe('overwrite', () => {
        it('should overwrite previous buffer on new startCapture', () => {
            const onOutput1 = operationLogs.startCapture('test-project');
            onOutput1('old line\n');

            const onOutput2 = operationLogs.startCapture('test-project');
            onOutput2('new line\n');

            const state = operationLogs.getState('test-project');
            expect(state.lines).toEqual(['new line']);
            expect(state.active).toBe(true);
        });

        it('should cancel cleanup timer from previous finish on overwrite', () => {
            jest.useFakeTimers();

            operationLogs.startCapture('test-project');
            operationLogs.finish('test-project');

            // Start new capture before cleanup fires
            operationLogs.startCapture('test-project');

            // Advance past cleanup delay
            jest.advanceTimersByTime(5 * 60 * 1000 + 1);

            // Buffer should still exist (new capture is active)
            expect(operationLogs.getState('test-project')).not.toBeNull();
            expect(operationLogs.getState('test-project').active).toBe(true);

            jest.useRealTimers();
        });
    });

    describe('getState', () => {
        it('should return null for nonexistent project', () => {
            expect(operationLogs.getState('nonexistent')).toBeNull();
        });

        it('should return correct state during active capture', () => {
            const onOutput = operationLogs.startCapture('test-project');
            onOutput('line1\n');

            const state = operationLogs.getState('test-project');
            expect(state.active).toBe(true);
            expect(state.lines).toEqual(['line1']);
            expect(state.error).toBeNull();
        });

        it('should return correct state after finish with error', () => {
            const onOutput = operationLogs.startCapture('test-project');
            onOutput('Building...\n');
            operationLogs.finish('test-project', 'Container exited with code 1');

            const state = operationLogs.getState('test-project');
            expect(state.active).toBe(false);
            expect(state.lines).toEqual(['Building...']);
            expect(state.error).toBe('Container exited with code 1');
        });
    });

    describe('isolation', () => {
        it('should keep buffers separate per project', () => {
            const onA = operationLogs.startCapture('project-a');
            const onB = operationLogs.startCapture('project-b');

            onA('output-a\n');
            onB('output-b\n');

            expect(operationLogs.getState('project-a').lines).toEqual(['output-a']);
            expect(operationLogs.getState('project-b').lines).toEqual(['output-b']);
        });
    });
});
