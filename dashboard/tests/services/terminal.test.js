// Mock dockerode before requiring the service
const mockStream = {
    end: jest.fn()
};

const mockExec = {
    start: jest.fn().mockResolvedValue(mockStream),
    resize: jest.fn().mockResolvedValue()
};

const mockContainer = {
    inspect: jest.fn(),
    exec: jest.fn().mockResolvedValue(mockExec)
};

const mockDocker = {
    getContainer: jest.fn(() => mockContainer)
};

jest.mock('dockerode', () => {
    return jest.fn().mockImplementation(() => mockDocker);
});

// Mock logger
jest.mock('../../src/config/logger', () => ({
    logger: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

const terminalService = require('../../src/services/terminal');
const { logger } = require('../../src/config/logger');

describe('Terminal Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mocks to default successful state
        mockContainer.inspect.mockResolvedValue({ State: { Running: true } });
        mockContainer.exec.mockResolvedValue(mockExec);
        mockExec.start.mockResolvedValue(mockStream);
        mockExec.resize.mockResolvedValue();
    });

    describe('createTerminalSession', () => {
        it('should create a terminal session successfully', async () => {
            const result = await terminalService.createTerminalSession('container-123');

            expect(mockDocker.getContainer).toHaveBeenCalledWith('container-123');
            expect(mockContainer.inspect).toHaveBeenCalled();
            expect(mockContainer.exec).toHaveBeenCalledWith({
                Cmd: ['/bin/bash'],
                AttachStdin: true,
                AttachStdout: true,
                AttachStderr: true,
                Tty: true,
                User: 'coder',
                WorkingDir: '/workspace',
                Env: [
                    'TERM=xterm-256color',
                    'COLUMNS=80',
                    'LINES=24'
                ]
            });
            expect(mockExec.start).toHaveBeenCalledWith({
                hijack: true,
                stdin: true,
                Tty: true
            });
            expect(result.sessionId).toMatch(/^term_\d+_[a-z0-9]+$/);
            expect(result.stream).toBe(mockStream);
            expect(result.exec).toBe(mockExec);
            expect(logger.info).toHaveBeenCalledWith('Terminal session created', expect.any(Object));
        });

        it('should use custom cols and rows options', async () => {
            await terminalService.createTerminalSession('container-123', { cols: 120, rows: 40 });

            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Env: expect.arrayContaining([
                    'COLUMNS=120',
                    'LINES=40'
                ])
            }));
        });

        it('should throw error if container is not running', async () => {
            mockContainer.inspect.mockResolvedValue({ State: { Running: false } });

            await expect(terminalService.createTerminalSession('container-123'))
                .rejects.toThrow('Container is not running');
        });

        it('should throw error if container inspect fails', async () => {
            mockContainer.inspect.mockRejectedValue(new Error('Container not found'));

            await expect(terminalService.createTerminalSession('container-123'))
                .rejects.toThrow('Container not found');
        });

        it('should throw error if exec creation fails', async () => {
            mockContainer.exec.mockRejectedValue(new Error('Exec failed'));

            await expect(terminalService.createTerminalSession('container-123'))
                .rejects.toThrow('Exec failed');
        });

        it('should throw error if stream start fails', async () => {
            mockExec.start.mockRejectedValue(new Error('Stream start failed'));

            await expect(terminalService.createTerminalSession('container-123'))
                .rejects.toThrow('Stream start failed');
        });
    });

    describe('resizeTerminal', () => {
        it('should resize terminal successfully', async () => {
            // First create a session
            const { sessionId } = await terminalService.createTerminalSession('container-123');

            await terminalService.resizeTerminal(sessionId, 100, 30);

            expect(mockExec.resize).toHaveBeenCalledWith({ w: 100, h: 30 });
            expect(logger.debug).toHaveBeenCalledWith('Terminal resized', { sessionId, cols: 100, rows: 30 });
        });

        it('should throw error if session not found', async () => {
            await expect(terminalService.resizeTerminal('nonexistent-session', 100, 30))
                .rejects.toThrow('Session not found');
        });

        it('should handle resize failure gracefully', async () => {
            const { sessionId } = await terminalService.createTerminalSession('container-123');
            mockExec.resize.mockRejectedValue(new Error('Resize failed'));

            // Should not throw, just log warning
            await terminalService.resizeTerminal(sessionId, 100, 30);

            expect(logger.warn).toHaveBeenCalledWith('Failed to resize terminal', {
                sessionId,
                error: 'Resize failed'
            });
        });
    });

    describe('closeSession', () => {
        it('should close session and end stream', async () => {
            const { sessionId } = await terminalService.createTerminalSession('container-123');

            terminalService.closeSession(sessionId);

            expect(mockStream.end).toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledWith('Terminal session closed', { sessionId });
        });

        it('should do nothing if session not found', () => {
            // Should not throw
            terminalService.closeSession('nonexistent-session');

            expect(mockStream.end).not.toHaveBeenCalled();
        });

        it('should handle stream end error gracefully', async () => {
            mockStream.end.mockImplementation(() => {
                throw new Error('End failed');
            });

            const { sessionId } = await terminalService.createTerminalSession('container-123');

            // Should not throw
            terminalService.closeSession(sessionId);

            expect(logger.debug).toHaveBeenCalledWith('Error closing terminal stream', {
                error: 'End failed'
            });
        });
    });

    describe('getSession', () => {
        it('should return session if found', async () => {
            const { sessionId } = await terminalService.createTerminalSession('container-123');

            const session = terminalService.getSession(sessionId);

            expect(session).not.toBeNull();
            expect(session.containerId).toBe('container-123');
            expect(session.cols).toBe(80);
            expect(session.rows).toBe(24);
            expect(session.createdAt).toBeInstanceOf(Date);
        });

        it('should return null if session not found', () => {
            const session = terminalService.getSession('nonexistent-session');

            expect(session).toBeNull();
        });
    });

    describe('session lifecycle', () => {
        it('should remove session from map after close', async () => {
            const { sessionId } = await terminalService.createTerminalSession('container-123');

            // Session should exist
            expect(terminalService.getSession(sessionId)).not.toBeNull();

            // Close session
            terminalService.closeSession(sessionId);

            // Session should not exist
            expect(terminalService.getSession(sessionId)).toBeNull();
        });

        it('should create multiple independent sessions', async () => {
            const session1 = await terminalService.createTerminalSession('container-1');
            const session2 = await terminalService.createTerminalSession('container-2');

            expect(session1.sessionId).not.toBe(session2.sessionId);
            expect(terminalService.getSession(session1.sessionId)).not.toBeNull();
            expect(terminalService.getSession(session2.sessionId)).not.toBeNull();

            // Close one session
            terminalService.closeSession(session1.sessionId);

            // Only session1 should be gone
            expect(terminalService.getSession(session1.sessionId)).toBeNull();
            expect(terminalService.getSession(session2.sessionId)).not.toBeNull();

            // Cleanup
            terminalService.closeSession(session2.sessionId);
        });
    });
});
