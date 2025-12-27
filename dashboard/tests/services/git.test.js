const fs = require('fs');
const path = require('path');

const testDir = '/tmp/dployr-test-git';

// Set env BEFORE requiring modules
process.env.USERS_PATH = testDir;

// Mock simple-git
const mockGit = {
    getRemotes: jest.fn(),
    branch: jest.fn(),
    log: jest.fn(),
    status: jest.fn(),
    clone: jest.fn(),
    pull: jest.fn(),
    fetch: jest.fn(),
    revparse: jest.fn()
};

jest.mock('simple-git', () => {
    return jest.fn().mockImplementation(() => mockGit);
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

const gitService = require('../../src/services/git');

describe('Git Service', () => {
    const testUser = 'testuser';
    const testProject = 'testproject';
    const projectPath = path.join(testDir, testUser, testProject);

    beforeAll(() => {
        // Create test directory structure
        fs.mkdirSync(path.join(projectPath, 'html'), { recursive: true });
    });

    afterAll(() => {
        // Cleanup
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
        } catch {}
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('isGitRepository', () => {
        it('should return false for non-git directory', () => {
            expect(gitService.isGitRepository(projectPath)).toBe(false);
        });

        it('should return true when .git exists in html/', () => {
            const gitDir = path.join(projectPath, 'html', '.git');
            fs.mkdirSync(gitDir, { recursive: true });

            expect(gitService.isGitRepository(projectPath)).toBe(true);

            fs.rmSync(gitDir, { recursive: true });
        });

        it('should return true when .git exists in project root (legacy)', () => {
            const gitDir = path.join(projectPath, '.git');
            fs.mkdirSync(gitDir, { recursive: true });

            expect(gitService.isGitRepository(projectPath)).toBe(true);

            fs.rmSync(gitDir, { recursive: true });
        });
    });

    describe('getGitPath', () => {
        it('should return html/ path when .git exists there', () => {
            const gitDir = path.join(projectPath, 'html', '.git');
            fs.mkdirSync(gitDir, { recursive: true });

            expect(gitService.getGitPath(projectPath)).toBe(path.join(projectPath, 'html'));

            fs.rmSync(gitDir, { recursive: true });
        });

        it('should return project root when .git exists there (legacy)', () => {
            const gitDir = path.join(projectPath, '.git');
            fs.mkdirSync(gitDir, { recursive: true });

            expect(gitService.getGitPath(projectPath)).toBe(projectPath);

            fs.rmSync(gitDir, { recursive: true });
        });

        it('should return html/ path as default for new projects', () => {
            expect(gitService.getGitPath(projectPath)).toBe(path.join(projectPath, 'html'));
        });
    });

    // Note: sanitizeUrlForDisplay, createAuthenticatedUrl, and formatRelativeTime
    // are internal functions not exported by the module.
    // They are tested indirectly through getGitStatus.

    describe('detectProjectType', () => {
        const detectPath = path.join(testDir, 'detect-test');

        beforeEach(() => {
            fs.mkdirSync(detectPath, { recursive: true });
        });

        afterEach(() => {
            fs.rmSync(detectPath, { recursive: true, force: true });
        });

        it('should detect Next.js project', () => {
            fs.writeFileSync(path.join(detectPath, 'package.json'), JSON.stringify({
                dependencies: { next: '14.0.0' }
            }));

            expect(gitService.detectProjectType(detectPath)).toBe('nextjs');
        });

        it('should detect React/Vite project (nodejs-static)', () => {
            fs.writeFileSync(path.join(detectPath, 'package.json'), JSON.stringify({
                dependencies: { react: '18.0.0' }
            }));
            fs.writeFileSync(path.join(detectPath, 'vite.config.js'), '');

            expect(gitService.detectProjectType(detectPath)).toBe('nodejs-static');
        });

        it('should detect Laravel project', () => {
            fs.writeFileSync(path.join(detectPath, 'artisan'), '');
            fs.writeFileSync(path.join(detectPath, 'composer.json'), JSON.stringify({
                require: { 'laravel/framework': '^10.0' }
            }));

            expect(gitService.detectProjectType(detectPath)).toBe('laravel');
        });

        it('should detect PHP project', () => {
            fs.writeFileSync(path.join(detectPath, 'index.php'), '<?php echo "Hello";');

            expect(gitService.detectProjectType(detectPath)).toBe('php');
        });

        it('should detect Node.js project', () => {
            fs.writeFileSync(path.join(detectPath, 'package.json'), JSON.stringify({
                dependencies: { express: '4.18.0' }
            }));

            expect(gitService.detectProjectType(detectPath)).toBe('nodejs');
        });

        it('should detect static project', () => {
            fs.writeFileSync(path.join(detectPath, 'index.html'), '<html></html>');

            expect(gitService.detectProjectType(detectPath)).toBe('static');
        });

        it('should default to static for empty directory', () => {
            expect(gitService.detectProjectType(detectPath)).toBe('static');
        });
    });

    describe('generateDockerCompose', () => {
        it('should generate docker-compose for static project', () => {
            const compose = gitService.generateDockerCompose('static', 'test-project', 8080);

            expect(compose).toContain('nginx:alpine');
            expect(compose).toContain('EXPOSED_PORT');
            expect(compose).toContain('test-project');
        });

        it('should generate docker-compose for PHP project', () => {
            const compose = gitService.generateDockerCompose('php', 'php-project', 8081);

            expect(compose).toContain('php');
            expect(compose).toContain('8081');
        });

        it('should generate docker-compose for Node.js project', () => {
            const compose = gitService.generateDockerCompose('nodejs', 'node-project', 8082);

            expect(compose).toContain('node');
            expect(compose).toContain('8082');
        });

        it('should generate docker-compose for Laravel project', () => {
            const compose = gitService.generateDockerCompose('laravel', 'laravel-project', 8083);

            expect(compose).toContain('apache');
            expect(compose).toContain('composer');
            expect(compose).toContain('8083');
        });

        it('should generate docker-compose for Next.js project', () => {
            const compose = gitService.generateDockerCompose('nextjs', 'nextjs-project', 8084);

            expect(compose).toContain('node');
            expect(compose).toContain('npm');
            expect(compose).toContain('8084');
        });
    });

    describe('getGitStatus', () => {
        it('should return null for non-git repository', async () => {
            const result = await gitService.getGitStatus('/non/existent/path');
            expect(result).toBeNull();
        });

        it('should return git status for valid repository', async () => {
            // Create .git directory
            const gitDir = path.join(projectPath, 'html', '.git');
            fs.mkdirSync(gitDir, { recursive: true });

            // Mock simple-git responses
            mockGit.getRemotes.mockResolvedValue([
                { name: 'origin', refs: { fetch: 'https://github.com/user/repo' } }
            ]);
            mockGit.branch.mockResolvedValue({ current: 'main' });
            mockGit.log.mockResolvedValue({
                latest: { hash: 'abc1234567890', message: 'Test commit', date: new Date().toISOString() }
            });
            mockGit.status.mockResolvedValue({ isClean: () => true });

            const result = await gitService.getGitStatus(projectPath);

            expect(result.connected).toBe(true);
            expect(result.branch).toBe('main');
            expect(result.remoteUrl).toBe('https://github.com/user/repo');
            expect(result.hasLocalChanges).toBe(false);

            fs.rmSync(gitDir, { recursive: true });
        });

        it('should handle git errors gracefully', async () => {
            // Create .git directory
            const gitDir = path.join(projectPath, 'html', '.git');
            fs.mkdirSync(gitDir, { recursive: true });

            mockGit.getRemotes.mockRejectedValue(new Error('Git error'));

            const result = await gitService.getGitStatus(projectPath);

            expect(result.connected).toBe(true);
            expect(result.error).toContain('Error');

            fs.rmSync(gitDir, { recursive: true });
        });
    });
});
