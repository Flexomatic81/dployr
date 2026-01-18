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

const claudeTerminalService = require('../../src/services/claude-terminal');
const { logger } = require('../../src/config/logger');

describe('Claude Terminal Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mocks to default successful state
        mockContainer.inspect.mockResolvedValue({ State: { Running: true } });
        mockContainer.exec.mockResolvedValue(mockExec);
        mockExec.start.mockResolvedValue(mockStream);
        mockExec.resize.mockResolvedValue();
    });

    describe('createClaudeSession', () => {
        it('should create a Claude terminal session successfully', async () => {
            const result = await claudeTerminalService.createClaudeSession('container-123');

            expect(mockDocker.getContainer).toHaveBeenCalledWith('container-123');
            expect(mockContainer.inspect).toHaveBeenCalled();
            expect(mockContainer.exec).toHaveBeenCalledWith({
                Cmd: ['/bin/bash', '-c', 'claude'],
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
            expect(result.sessionId).toMatch(/^claude_\d+_[a-z0-9]+$/);
            expect(result.stream).toBe(mockStream);
            expect(result.exec).toBe(mockExec);
            expect(logger.info).toHaveBeenCalledWith('Claude terminal session created', expect.any(Object));
        });

        it('should use custom cols and rows options', async () => {
            await claudeTerminalService.createClaudeSession('container-123', { cols: 120, rows: 40 });

            expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
                Env: expect.arrayContaining([
                    'COLUMNS=120',
                    'LINES=40'
                ])
            }));
        });

        it('should store auth callbacks', async () => {
            const onAuthUrl = jest.fn();
            const onAuthSuccess = jest.fn();

            const { sessionId } = await claudeTerminalService.createClaudeSession(
                'container-123', {}, onAuthUrl, onAuthSuccess
            );

            const session = claudeTerminalService.getClaudeSession(sessionId);
            expect(session.onAuthUrl).toBe(onAuthUrl);
            expect(session.onAuthSuccess).toBe(onAuthSuccess);
        });

        it('should throw error if container is not running', async () => {
            mockContainer.inspect.mockResolvedValue({ State: { Running: false } });

            await expect(claudeTerminalService.createClaudeSession('container-123'))
                .rejects.toThrow('Container is not running');
        });

        it('should throw error if container inspect fails', async () => {
            mockContainer.inspect.mockRejectedValue(new Error('Container not found'));

            await expect(claudeTerminalService.createClaudeSession('container-123'))
                .rejects.toThrow('Container not found');
        });
    });

    describe('parseOutput', () => {
        let sessionId;

        beforeEach(async () => {
            const result = await claudeTerminalService.createClaudeSession('container-123');
            sessionId = result.sessionId;
        });

        afterEach(() => {
            claudeTerminalService.closeClaudeSession(sessionId);
        });

        it('should detect Claude AI OAuth URL', () => {
            const output = 'Please visit: https://claude.ai/oauth/callback?code=abc123 to authenticate';
            const result = claudeTerminalService.parseOutput(sessionId, output);

            expect(result.authUrl).toBe('https://claude.ai/oauth/callback?code=abc123');
            expect(logger.info).toHaveBeenCalledWith('Claude auth URL detected', expect.any(Object));
        });

        it('should detect Anthropic console OAuth URL', () => {
            const output = 'Open https://console.anthropic.com/oauth/authorize?client_id=xyz';
            const result = claudeTerminalService.parseOutput(sessionId, output);

            expect(result.authUrl).toContain('console.anthropic.com/oauth');
        });

        it('should detect generic OAuth URL', () => {
            const output = 'Visit https://auth.example.com/oauth/authorize?scope=read';
            const result = claudeTerminalService.parseOutput(sessionId, output);

            expect(result.authUrl).toContain('/oauth/authorize');
        });

        it('should clean ANSI codes from URL', () => {
            const output = 'Visit \x1b[36mhttps://claude.ai/oauth/test\x1b[0m to continue';
            const result = claudeTerminalService.parseOutput(sessionId, output);

            expect(result.authUrl).toBe('https://claude.ai/oauth/test');
            expect(result.authUrl).not.toContain('\x1b');
        });

        it('should call onAuthUrl callback when URL detected', async () => {
            const onAuthUrl = jest.fn();
            const { sessionId: newSessionId } = await claudeTerminalService.createClaudeSession(
                'container-456', {}, onAuthUrl, null
            );

            claudeTerminalService.parseOutput(newSessionId, 'https://claude.ai/oauth/test');

            expect(onAuthUrl).toHaveBeenCalledWith('https://claude.ai/oauth/test');

            claudeTerminalService.closeClaudeSession(newSessionId);
        });

        it('should detect auth success messages', async () => {
            // First detect an auth URL to set authDetected flag
            claudeTerminalService.parseOutput(sessionId, 'https://claude.ai/oauth/test');

            // Then check for success message
            const result = claudeTerminalService.parseOutput(sessionId, 'Successfully authenticated with Claude');

            expect(result.authSuccess).toBe(true);
            expect(logger.info).toHaveBeenCalledWith('Claude authentication successful', expect.any(Object));
        });

        it('should detect various auth success patterns', async () => {
            const successMessages = [
                'Welcome to Claude!',
                'Authentication successful',
                'Logged in as user@example.com',
                'You are now logged in'
            ];

            for (const message of successMessages) {
                // Create fresh session for each test
                const { sessionId: testSessionId } = await claudeTerminalService.createClaudeSession('container-test');

                // Set auth detected
                claudeTerminalService.parseOutput(testSessionId, 'https://claude.ai/oauth/test');

                const result = claudeTerminalService.parseOutput(testSessionId, message);
                expect(result.authSuccess).toBe(true);

                claudeTerminalService.closeClaudeSession(testSessionId);
            }
        });

        it('should call onAuthSuccess callback', async () => {
            const onAuthSuccess = jest.fn();
            const { sessionId: newSessionId } = await claudeTerminalService.createClaudeSession(
                'container-789', {}, null, onAuthSuccess
            );

            // Set auth detected first
            claudeTerminalService.parseOutput(newSessionId, 'https://claude.ai/oauth/test');

            // Then success
            claudeTerminalService.parseOutput(newSessionId, 'Successfully authenticated');

            expect(onAuthSuccess).toHaveBeenCalled();

            claudeTerminalService.closeClaudeSession(newSessionId);
        });

        it('should not detect auth success without prior auth URL', () => {
            const result = claudeTerminalService.parseOutput(sessionId, 'Successfully authenticated');

            expect(result.authSuccess).toBe(false);
        });

        it('should not re-detect auth success after first detection', async () => {
            // First detect URL
            claudeTerminalService.parseOutput(sessionId, 'https://claude.ai/oauth/test');

            // First success
            claudeTerminalService.parseOutput(sessionId, 'Successfully authenticated');

            // Clear mock
            logger.info.mockClear();

            // Second success message should not trigger
            const result = claudeTerminalService.parseOutput(sessionId, 'Welcome to Claude');

            expect(result.authSuccess).toBe(false);
            expect(logger.info).not.toHaveBeenCalledWith('Claude authentication successful', expect.any(Object));
        });

        it('should return null values for unknown session', () => {
            const result = claudeTerminalService.parseOutput('nonexistent', 'https://claude.ai/oauth/test');

            expect(result.authUrl).toBeNull();
            expect(result.authSuccess).toBe(false);
        });
    });

    describe('resizeClaudeTerminal', () => {
        it('should resize terminal successfully', async () => {
            const { sessionId } = await claudeTerminalService.createClaudeSession('container-123');

            await claudeTerminalService.resizeClaudeTerminal(sessionId, 100, 30);

            expect(mockExec.resize).toHaveBeenCalledWith({ w: 100, h: 30 });
            expect(logger.debug).toHaveBeenCalledWith('Claude terminal resized', { sessionId, cols: 100, rows: 30 });

            claudeTerminalService.closeClaudeSession(sessionId);
        });

        it('should throw error if session not found', async () => {
            await expect(claudeTerminalService.resizeClaudeTerminal('nonexistent-session', 100, 30))
                .rejects.toThrow('Session not found');
        });

        it('should handle resize failure gracefully', async () => {
            const { sessionId } = await claudeTerminalService.createClaudeSession('container-123');
            mockExec.resize.mockRejectedValue(new Error('Resize failed'));

            // Should not throw, just log warning
            await claudeTerminalService.resizeClaudeTerminal(sessionId, 100, 30);

            expect(logger.warn).toHaveBeenCalledWith('Failed to resize Claude terminal', {
                sessionId,
                error: 'Resize failed'
            });

            claudeTerminalService.closeClaudeSession(sessionId);
        });
    });

    describe('closeClaudeSession', () => {
        it('should close session and end stream', async () => {
            const { sessionId } = await claudeTerminalService.createClaudeSession('container-123');

            claudeTerminalService.closeClaudeSession(sessionId);

            expect(mockStream.end).toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledWith('Claude terminal session closed', { sessionId });
        });

        it('should do nothing if session not found', () => {
            // Should not throw
            claudeTerminalService.closeClaudeSession('nonexistent-session');

            expect(mockStream.end).not.toHaveBeenCalled();
        });

        it('should handle stream end error gracefully', async () => {
            mockStream.end.mockImplementation(() => {
                throw new Error('End failed');
            });

            const { sessionId } = await claudeTerminalService.createClaudeSession('container-123');

            // Should not throw
            claudeTerminalService.closeClaudeSession(sessionId);

            expect(logger.debug).toHaveBeenCalledWith('Error closing Claude terminal stream', {
                error: 'End failed'
            });
        });
    });

    describe('getClaudeSession', () => {
        it('should return session if found', async () => {
            const { sessionId } = await claudeTerminalService.createClaudeSession('container-123');

            const session = claudeTerminalService.getClaudeSession(sessionId);

            expect(session).not.toBeNull();
            expect(session.containerId).toBe('container-123');
            expect(session.cols).toBe(80);
            expect(session.rows).toBe(24);
            expect(session.createdAt).toBeInstanceOf(Date);
            expect(session.authDetected).toBe(false);
            expect(session.authSuccessDetected).toBe(false);

            claudeTerminalService.closeClaudeSession(sessionId);
        });

        it('should return null if session not found', () => {
            const session = claudeTerminalService.getClaudeSession('nonexistent-session');

            expect(session).toBeNull();
        });
    });

    describe('session lifecycle', () => {
        it('should remove session from map after close', async () => {
            const { sessionId } = await claudeTerminalService.createClaudeSession('container-123');

            // Session should exist
            expect(claudeTerminalService.getClaudeSession(sessionId)).not.toBeNull();

            // Close session
            claudeTerminalService.closeClaudeSession(sessionId);

            // Session should not exist
            expect(claudeTerminalService.getClaudeSession(sessionId)).toBeNull();
        });

        it('should create multiple independent sessions', async () => {
            const session1 = await claudeTerminalService.createClaudeSession('container-1');
            const session2 = await claudeTerminalService.createClaudeSession('container-2');

            expect(session1.sessionId).not.toBe(session2.sessionId);
            expect(claudeTerminalService.getClaudeSession(session1.sessionId)).not.toBeNull();
            expect(claudeTerminalService.getClaudeSession(session2.sessionId)).not.toBeNull();

            // Close one session
            claudeTerminalService.closeClaudeSession(session1.sessionId);

            // Only session1 should be gone
            expect(claudeTerminalService.getClaudeSession(session1.sessionId)).toBeNull();
            expect(claudeTerminalService.getClaudeSession(session2.sessionId)).not.toBeNull();

            // Cleanup
            claudeTerminalService.closeClaudeSession(session2.sessionId);
        });

        it('should track auth state per session', async () => {
            const session1 = await claudeTerminalService.createClaudeSession('container-1');
            const session2 = await claudeTerminalService.createClaudeSession('container-2');

            // Trigger auth URL on session1 only
            claudeTerminalService.parseOutput(session1.sessionId, 'https://claude.ai/oauth/test');

            const s1 = claudeTerminalService.getClaudeSession(session1.sessionId);
            const s2 = claudeTerminalService.getClaudeSession(session2.sessionId);

            expect(s1.authDetected).toBe(true);
            expect(s2.authDetected).toBe(false);

            // Cleanup
            claudeTerminalService.closeClaudeSession(session1.sessionId);
            claudeTerminalService.closeClaudeSession(session2.sessionId);
        });
    });
});
