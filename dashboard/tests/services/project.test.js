// Mock fs
const mockFs = {
    readdir: jest.fn(),
    access: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    rm: jest.fn(),
    copyFile: jest.fn()
};

jest.mock('fs', () => ({
    promises: mockFs
}));

// Mock docker service
const mockDockerService = {
    getProjectContainers: jest.fn(),
    stopProject: jest.fn(),
    startProject: jest.fn()
};

jest.mock('../../src/services/docker', () => mockDockerService);

// Mock git service
const mockGitService = {
    generateDockerCompose: jest.fn(),
    generateNginxConfig: jest.fn(),
    getGitPath: jest.fn(),
    isGitRepository: jest.fn()
};

jest.mock('../../src/services/git', () => mockGitService);

// Mock logger
jest.mock('../../src/config/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    }
}));

const projectService = require('../../src/services/project');

describe('Project Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('parseEnvFile', () => {
        it('should parse simple env file', () => {
            const content = 'KEY=value\nANOTHER=test';
            const result = projectService.parseEnvFile(content);

            expect(result).toEqual({
                KEY: 'value',
                ANOTHER: 'test'
            });
        });

        it('should skip comments', () => {
            const content = '# Comment\nKEY=value\n# Another comment';
            const result = projectService.parseEnvFile(content);

            expect(result).toEqual({ KEY: 'value' });
        });

        it('should skip empty lines', () => {
            const content = 'KEY=value\n\nANOTHER=test\n';
            const result = projectService.parseEnvFile(content);

            expect(result).toEqual({
                KEY: 'value',
                ANOTHER: 'test'
            });
        });

        it('should handle values with equals signs', () => {
            const content = 'URL=http://example.com?key=value';
            const result = projectService.parseEnvFile(content);

            expect(result).toEqual({
                URL: 'http://example.com?key=value'
            });
        });

        it('should handle empty values', () => {
            const content = 'EMPTY=\nKEY=value';
            const result = projectService.parseEnvFile(content);

            expect(result).toEqual({
                EMPTY: '',
                KEY: 'value'
            });
        });
    });

    describe('getUserProjects', () => {
        it('should return projects for user', async () => {
            mockFs.readdir.mockResolvedValueOnce([
                { name: 'project1', isDirectory: () => true },
                { name: 'project2', isDirectory: () => true },
                { name: '.hidden', isDirectory: () => true }
            ]);

            // Mock for each project's getProjectInfo
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readFile.mockResolvedValue('PROJECT_NAME=user-project1\nEXPOSED_PORT=8001');
            mockDockerService.getProjectContainers.mockResolvedValue([
                { State: 'running' }
            ]);

            const result = await projectService.getUserProjects('testuser');

            expect(result).toHaveLength(2); // Hidden folder excluded
            expect(result[0].name).toBe('project1');
        });

        it('should return empty array when user directory does not exist', async () => {
            const error = new Error('ENOENT');
            error.code = 'ENOENT';
            mockFs.readdir.mockRejectedValue(error);

            const result = await projectService.getUserProjects('nonexistent');

            expect(result).toEqual([]);
        });

        it('should throw error for other fs errors', async () => {
            mockFs.readdir.mockRejectedValue(new Error('Permission denied'));

            await expect(projectService.getUserProjects('testuser'))
                .rejects.toThrow('Permission denied');
        });
    });

    describe('getProjectInfo', () => {
        it('should return project info', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readFile
                .mockResolvedValueOnce('PROJECT_NAME=user-myproject\nEXPOSED_PORT=8001')
                .mockResolvedValueOnce('image: nginx:alpine'); // docker-compose.yml
            mockDockerService.getProjectContainers.mockResolvedValue([
                { State: 'running' },
                { State: 'exited' }
            ]);

            const result = await projectService.getProjectInfo('testuser', 'myproject');

            expect(result).toEqual({
                name: 'myproject',
                path: expect.stringContaining('testuser/myproject'),
                port: '8001',
                templateType: 'static-website',
                containerName: 'user-myproject',
                status: 'running',
                runningContainers: 1,
                totalContainers: 2,
                containers: expect.any(Array),
                hasDatabase: false,
                database: null
            });
        });

        it('should return null when project does not exist', async () => {
            mockFs.access.mockRejectedValue(new Error('ENOENT'));

            const result = await projectService.getProjectInfo('testuser', 'nonexistent');

            expect(result).toBeNull();
        });

        it('should detect database from env', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readFile
                .mockResolvedValueOnce('PROJECT_NAME=user-myproject\nDB_DATABASE=mydb')
                .mockResolvedValueOnce('image: nginx:alpine');
            mockDockerService.getProjectContainers.mockResolvedValue([]);

            const result = await projectService.getProjectInfo('testuser', 'myproject');

            expect(result.hasDatabase).toBe(true);
            expect(result.database).toBe('mydb');
        });
    });

    describe('getAvailableTemplates', () => {
        it('should return templates from directory', async () => {
            mockFs.readdir.mockResolvedValue([
                { name: 'static-website', isDirectory: () => true },
                { name: 'nodejs-app', isDirectory: () => true },
                { name: 'file.txt', isDirectory: () => false }
            ]);

            const result = await projectService.getAvailableTemplates();

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                name: 'static-website',
                displayName: 'Static Website (HTML/CSS/JS)'
            });
        });

        it('should return fallback templates on error', async () => {
            mockFs.readdir.mockRejectedValue(new Error('Permission denied'));

            const result = await projectService.getAvailableTemplates();

            expect(result).toHaveLength(3);
            expect(result[0].name).toBe('static-website');
        });
    });

    describe('getNextAvailablePort', () => {
        it('should return 8001 when no projects exist', async () => {
            mockFs.readdir.mockResolvedValue([]);

            const result = await projectService.getNextAvailablePort();

            expect(result).toBe(8001);
        });

        it('should find next available port', async () => {
            mockFs.readdir
                .mockResolvedValueOnce([{ name: 'user1', isDirectory: () => true }])
                .mockResolvedValueOnce([
                    { name: 'project1', isDirectory: () => true },
                    { name: 'project2', isDirectory: () => true }
                ]);
            mockFs.readFile
                .mockResolvedValueOnce('EXPOSED_PORT=8001')
                .mockResolvedValueOnce('EXPOSED_PORT=8002');

            const result = await projectService.getNextAvailablePort();

            expect(result).toBe(8003);
        });

        it('should handle gaps in port numbers', async () => {
            mockFs.readdir
                .mockResolvedValueOnce([{ name: 'user1', isDirectory: () => true }])
                .mockResolvedValueOnce([
                    { name: 'project1', isDirectory: () => true },
                    { name: 'project2', isDirectory: () => true }
                ]);
            mockFs.readFile
                .mockResolvedValueOnce('EXPOSED_PORT=8001')
                .mockResolvedValueOnce('EXPOSED_PORT=8003'); // Gap at 8002

            const result = await projectService.getNextAvailablePort();

            expect(result).toBe(8002); // Should fill the gap
        });
    });

    describe('createProject', () => {
        it('should create a new project', async () => {
            // Project doesn't exist
            const error = new Error('ENOENT');
            error.code = 'ENOENT';
            mockFs.access.mockRejectedValueOnce(error);

            // Template and env.example
            mockFs.readdir
                .mockResolvedValueOnce([]) // getNextAvailablePort - no users
                .mockResolvedValueOnce([ // copyDirectory - template files
                    { name: 'docker-compose.yml', isDirectory: () => false },
                    { name: '.env.example', isDirectory: () => false }
                ]);
            mockFs.readFile.mockResolvedValue('PROJECT_NAME=\nEXPOSED_PORT=');
            mockFs.mkdir.mockResolvedValue(undefined);
            mockFs.copyFile.mockResolvedValue(undefined);
            mockFs.writeFile.mockResolvedValue(undefined);

            const result = await projectService.createProject('testuser', 'my-project', 'static-website');

            expect(result).toEqual({
                name: 'my-project',
                path: expect.stringContaining('testuser/my-project'),
                port: 8001,
                templateType: 'static-website'
            });
            expect(mockFs.mkdir).toHaveBeenCalled();
            expect(mockFs.writeFile).toHaveBeenCalled();
        });

        it('should throw error for invalid project name', async () => {
            await expect(projectService.createProject('testuser', 'Invalid Name!', 'static'))
                .rejects.toThrow('Project name may only contain lowercase letters, numbers and hyphens');
        });

        it('should throw error if project already exists', async () => {
            mockFs.access.mockResolvedValue(undefined); // Project exists

            await expect(projectService.createProject('testuser', 'existing', 'static'))
                .rejects.toThrow('A project with this name already exists');
        });

        it('should use custom port when provided', async () => {
            const error = new Error('ENOENT');
            error.code = 'ENOENT';
            mockFs.access.mockRejectedValueOnce(error);
            mockFs.readdir.mockResolvedValue([]);
            mockFs.readFile.mockResolvedValue('PROJECT_NAME=\nEXPOSED_PORT=');
            mockFs.mkdir.mockResolvedValue(undefined);
            mockFs.copyFile.mockResolvedValue(undefined);
            mockFs.writeFile.mockResolvedValue(undefined);

            const result = await projectService.createProject('testuser', 'my-project', 'static', { port: 9000 });

            expect(result.port).toBe(9000);
        });
    });

    describe('deleteProject', () => {
        it('should delete project', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockDockerService.stopProject.mockResolvedValue(undefined);
            mockFs.rm.mockResolvedValue(undefined);

            const result = await projectService.deleteProject('testuser', 'myproject');

            expect(result).toEqual({ success: true });
            expect(mockDockerService.stopProject).toHaveBeenCalled();
            expect(mockFs.rm).toHaveBeenCalledWith(
                expect.stringContaining('testuser/myproject'),
                { recursive: true, force: true }
            );
        });

        it('should throw error when project not found', async () => {
            mockFs.access.mockRejectedValue(new Error('ENOENT'));

            await expect(projectService.deleteProject('testuser', 'nonexistent'))
                .rejects.toThrow('Project not found');
        });

        it('should continue even if stopping containers fails', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockDockerService.stopProject.mockRejectedValue(new Error('Docker error'));
            mockFs.rm.mockResolvedValue(undefined);

            const result = await projectService.deleteProject('testuser', 'myproject');

            expect(result).toEqual({ success: true });
            expect(mockFs.rm).toHaveBeenCalled();
        });
    });

    describe('changeProjectType', () => {
        it('should change project type', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readFile
                .mockResolvedValueOnce('image: nginx') // detectTemplateType
                .mockResolvedValueOnce('PROJECT_NAME=user-project\nEXPOSED_PORT=8001'); // env file
            mockDockerService.stopProject.mockResolvedValue(undefined);
            mockGitService.generateDockerCompose.mockReturnValue('version: "3"');
            mockGitService.isGitRepository.mockReturnValue(false);
            mockFs.writeFile.mockResolvedValue(undefined);
            mockDockerService.startProject.mockResolvedValue(undefined);

            const result = await projectService.changeProjectType('testuser', 'project', 'nodejs');

            expect(result).toEqual({
                success: true,
                oldType: 'static-website',
                newType: 'nodejs'
            });
            expect(mockDockerService.stopProject).toHaveBeenCalled();
            expect(mockGitService.generateDockerCompose).toHaveBeenCalledWith('nodejs', 'user-project', 8001);
            expect(mockDockerService.startProject).toHaveBeenCalled();
        });

        it('should throw error for invalid type', async () => {
            await expect(projectService.changeProjectType('testuser', 'project', 'invalid'))
                .rejects.toThrow('Invalid project type');
        });

        it('should throw error when project not found', async () => {
            mockFs.access.mockRejectedValue(new Error('ENOENT'));

            await expect(projectService.changeProjectType('testuser', 'nonexistent', 'nodejs'))
                .rejects.toThrow('Project not found');
        });

        it('should create nginx config for static type', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readFile
                .mockResolvedValueOnce('image: node')
                .mockResolvedValueOnce('PROJECT_NAME=user-project\nEXPOSED_PORT=8001');
            mockDockerService.stopProject.mockResolvedValue(undefined);
            mockGitService.generateDockerCompose.mockReturnValue('version: "3"');
            mockGitService.generateNginxConfig.mockReturnValue('server {}');
            mockGitService.isGitRepository.mockReturnValue(false);
            mockFs.mkdir.mockResolvedValue(undefined);
            mockFs.writeFile.mockResolvedValue(undefined);
            mockDockerService.startProject.mockResolvedValue(undefined);

            await projectService.changeProjectType('testuser', 'project', 'static');

            expect(mockFs.mkdir).toHaveBeenCalledWith(
                expect.stringContaining('nginx'),
                { recursive: true }
            );
            expect(mockGitService.generateNginxConfig).toHaveBeenCalled();
        });

        it('should adjust paths for old Git projects', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readFile
                .mockResolvedValueOnce('image: nginx')
                .mockResolvedValueOnce('PROJECT_NAME=user-project\nEXPOSED_PORT=8001');
            mockDockerService.stopProject.mockResolvedValue(undefined);
            mockGitService.generateDockerCompose.mockReturnValue('volumes:\n  - ./html:/app');
            mockGitService.isGitRepository.mockReturnValue(true);
            mockGitService.getGitPath.mockReturnValue('/app/users/testuser/project'); // Git in root
            mockFs.writeFile.mockResolvedValue(undefined);
            mockDockerService.startProject.mockResolvedValue(undefined);

            await projectService.changeProjectType('testuser', 'project', 'nodejs');

            // Should have adjusted paths from ./html to .
            expect(mockFs.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('docker-compose.yml'),
                expect.stringContaining('./:')
            );
        });
    });

    describe('readEnvFile', () => {
        it('should read env file without system variables', async () => {
            mockGitService.isGitRepository.mockReturnValue(false);
            mockFs.access.mockRejectedValue(new Error('ENOENT')); // No html folder
            mockFs.readFile.mockResolvedValue(
                'PROJECT_NAME=test\nEXPOSED_PORT=8001\nAPP_KEY=secret\nDB_HOST=localhost'
            );

            const result = await projectService.readEnvFile('testuser', 'project');

            // System vars should be filtered out
            expect(result).toContain('APP_KEY=secret');
            expect(result).toContain('DB_HOST=localhost');
            expect(result).not.toContain('PROJECT_NAME');
            expect(result).not.toContain('EXPOSED_PORT');
        });

        it('should return empty string when file does not exist', async () => {
            mockGitService.isGitRepository.mockReturnValue(false);
            mockFs.access.mockRejectedValue(new Error('ENOENT'));
            const error = new Error('ENOENT');
            error.code = 'ENOENT';
            mockFs.readFile.mockRejectedValue(error);

            const result = await projectService.readEnvFile('testuser', 'project');

            expect(result).toBe('');
        });
    });

    describe('writeEnvFile', () => {
        it('should write env file preserving system variables', async () => {
            mockFs.access.mockResolvedValue(undefined);
            mockGitService.isGitRepository.mockReturnValue(false);
            mockFs.readFile.mockResolvedValue('PROJECT_NAME=user-project\nEXPOSED_PORT=8001');
            mockFs.writeFile.mockResolvedValue(undefined);

            const result = await projectService.writeEnvFile('testuser', 'project', 'APP_KEY=newsecret');

            expect(result).toEqual({ success: true });
            expect(mockFs.writeFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('PROJECT_NAME=user-project'),
                'utf8'
            );
            expect(mockFs.writeFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('APP_KEY=newsecret'),
                'utf8'
            );
        });

        it('should throw error when project not found', async () => {
            mockFs.access.mockRejectedValue(new Error('ENOENT'));

            await expect(projectService.writeEnvFile('testuser', 'nonexistent', 'KEY=value'))
                .rejects.toThrow('Project not found');
        });
    });

    describe('checkEnvExample', () => {
        it('should find .env.example in Git project', async () => {
            mockGitService.isGitRepository.mockReturnValue(true);
            mockGitService.getGitPath.mockReturnValue('/app/users/testuser/project/html');
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readFile.mockResolvedValue('DB_HOST=localhost');

            const result = await projectService.checkEnvExample('testuser', 'project');

            expect(result).toEqual({
                exists: true,
                filename: '.env.example',
                content: 'DB_HOST=localhost',
                inGit: true
            });
        });

        it('should return not found when no example exists', async () => {
            mockGitService.isGitRepository.mockReturnValue(false);
            mockFs.access.mockRejectedValue(new Error('ENOENT'));

            const result = await projectService.checkEnvExample('testuser', 'project');

            expect(result).toEqual({
                exists: false,
                filename: null,
                content: null,
                inHtml: false
            });
        });

        it('should find .env.sample as alternative', async () => {
            mockGitService.isGitRepository.mockReturnValue(true);
            mockGitService.getGitPath.mockReturnValue('/app/users/testuser/project');
            mockFs.access
                .mockRejectedValueOnce(new Error('ENOENT')) // .env.example
                .mockResolvedValueOnce(undefined); // .env.sample
            mockFs.readFile.mockResolvedValue('DB_HOST=localhost');

            const result = await projectService.checkEnvExample('testuser', 'project');

            expect(result.exists).toBe(true);
            expect(result.filename).toBe('.env.sample');
        });
    });

    describe('copyEnvExample', () => {
        it('should copy env example to .env', async () => {
            mockGitService.isGitRepository.mockReturnValue(true);
            mockGitService.getGitPath.mockReturnValue('/app/users/testuser/project');
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readFile
                .mockResolvedValueOnce('DB_HOST=localhost\nAPP_KEY=') // .env.example
                .mockRejectedValueOnce(new Error('ENOENT')); // .env doesn't exist
            mockFs.writeFile.mockResolvedValue(undefined);

            const result = await projectService.copyEnvExample('testuser', 'project');

            expect(result).toEqual({
                success: true,
                filename: '.env.example'
            });
            expect(mockFs.writeFile).toHaveBeenCalled();
        });

        it('should throw error when no example exists', async () => {
            mockGitService.isGitRepository.mockReturnValue(false);
            mockFs.access.mockRejectedValue(new Error('ENOENT'));

            await expect(projectService.copyEnvExample('testuser', 'project'))
                .rejects.toThrow('No .env.example file found');
        });

        it('should preserve existing values when copying', async () => {
            mockGitService.isGitRepository.mockReturnValue(true);
            mockGitService.getGitPath.mockReturnValue('/app/users/testuser/project');
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readFile
                .mockResolvedValueOnce('DB_HOST=localhost\nAPP_KEY=') // .env.example
                .mockResolvedValueOnce('APP_KEY=existingvalue'); // existing .env
            mockFs.writeFile.mockResolvedValue(undefined);

            await projectService.copyEnvExample('testuser', 'project');

            expect(mockFs.writeFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('APP_KEY=existingvalue'),
                'utf8'
            );
        });
    });

    describe('mergeDbCredentials', () => {
        const dbCredentials = {
            type: 'mariadb',
            host: 'dployr-mariadb',
            port: 3306,
            database: 'user_mydb',
            username: 'user_mydb',
            password: 'secretpass'
        };

        it('should merge credentials using .env.example as base', async () => {
            mockGitService.isGitRepository.mockReturnValue(true);
            mockGitService.getGitPath.mockReturnValue('/app/users/testuser/project');
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readFile
                .mockResolvedValueOnce('DB_HOST=localhost\nDB_DATABASE=test') // .env.example
                .mockRejectedValueOnce(new Error('ENOENT')); // no .env
            mockFs.writeFile.mockResolvedValue(undefined);

            const result = await projectService.mergeDbCredentials('testuser', 'project', dbCredentials);

            expect(result.success).toBe(true);
            expect(result.usedExample).toBe(true);
            expect(result.replacedCount).toBe(2); // DB_HOST and DB_DATABASE
            expect(mockFs.writeFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('DB_HOST=dployr-mariadb'),
                'utf8'
            );
        });

        it('should add missing credentials at the end', async () => {
            mockGitService.isGitRepository.mockReturnValue(false);
            mockFs.access.mockRejectedValue(new Error('ENOENT')); // no html
            mockFs.readFile.mockResolvedValue('APP_KEY=secret'); // existing .env without DB vars
            mockFs.writeFile.mockResolvedValue(undefined);

            const result = await projectService.mergeDbCredentials('testuser', 'project', dbCredentials);

            expect(result.addedCount).toBe(5); // All 5 DB vars added
            expect(mockFs.writeFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('# Dployr: user_mydb'),
                'utf8'
            );
        });

        it('should preserve non-DB variables from existing .env', async () => {
            mockGitService.isGitRepository.mockReturnValue(true);
            mockGitService.getGitPath.mockReturnValue('/app/users/testuser/project');
            mockFs.access.mockResolvedValue(undefined);
            mockFs.readFile
                .mockResolvedValueOnce('DB_HOST=localhost\nAPP_DEBUG=false') // .env.example
                .mockResolvedValueOnce('APP_DEBUG=true'); // existing .env
            mockFs.writeFile.mockResolvedValue(undefined);

            await projectService.mergeDbCredentials('testuser', 'project', dbCredentials);

            expect(mockFs.writeFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('APP_DEBUG=true'), // preserved from existing
                'utf8'
            );
        });
    });

    describe('cloneProject', () => {
        it('should clone a project', async () => {
            // Source exists, dest doesn't
            mockFs.access
                .mockResolvedValueOnce(undefined) // source exists
                .mockRejectedValueOnce({ code: 'ENOENT' }); // dest doesn't exist

            // getNextAvailablePort
            mockFs.readdir
                .mockResolvedValueOnce([]) // no users for port scan
                .mockResolvedValueOnce([ // source directory files
                    { name: 'docker-compose.yml', isDirectory: () => false },
                    { name: '.env', isDirectory: () => false }
                ]);

            mockFs.mkdir.mockResolvedValue(undefined);
            mockFs.copyFile.mockResolvedValue(undefined);
            mockFs.rm.mockResolvedValue(undefined);
            mockFs.readFile
                .mockResolvedValueOnce('container_name: user-source') // docker-compose update
                .mockResolvedValueOnce('PROJECT_NAME=user-source\nEXPOSED_PORT=8001') // .env update
                .mockResolvedValueOnce('image: node:20'); // detectTemplateType - must contain 'node:'
            mockFs.writeFile.mockResolvedValue(undefined);

            const result = await projectService.cloneProject('testuser', 'source', 'clone');

            expect(result).toEqual({
                name: 'clone',
                path: expect.stringContaining('testuser/clone'),
                port: 8001,
                templateType: 'nodejs-app',
                clonedFrom: 'source'
            });
        });

        it('should throw error for invalid clone name', async () => {
            await expect(projectService.cloneProject('testuser', 'source', 'Invalid!'))
                .rejects.toThrow('Project name may only contain lowercase letters, numbers and hyphens');
        });

        it('should throw error when source not found', async () => {
            mockFs.access.mockRejectedValue(new Error('ENOENT'));

            await expect(projectService.cloneProject('testuser', 'nonexistent', 'clone'))
                .rejects.toThrow('Source project not found');
        });

        it('should throw error when clone name already exists', async () => {
            mockFs.access
                .mockResolvedValueOnce(undefined) // source exists
                .mockResolvedValueOnce(undefined); // dest also exists

            await expect(projectService.cloneProject('testuser', 'source', 'existing'))
                .rejects.toThrow('A project with this name already exists');
        });
    });

    describe('getUserDbCredentials', () => {
        it('should parse database credentials', async () => {
            const credentialsContent = `# Database: user_mydb (created: 2024-01-15, type: mariadb)
DB_TYPE=mariadb
DB_HOST=dployr-mariadb
DB_PORT=3306
DB_DATABASE=user_mydb
DB_USERNAME=user_mydb
DB_PASSWORD=secret123

# Database: user_pgdb (created: 2024-01-16, type: postgresql)
DB_TYPE=postgresql
DB_HOST=dployr-postgresql
DB_PORT=5432
DB_DATABASE=user_pgdb
DB_USERNAME=user_pgdb
DB_PASSWORD=secret456`;

            mockFs.readFile.mockResolvedValue(credentialsContent);

            const result = await projectService.getUserDbCredentials('testuser');

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                name: 'user_mydb',
                type: 'mariadb',
                host: 'dployr-mariadb',
                port: '3306',
                database: 'user_mydb',
                username: 'user_mydb',
                password: 'secret123'
            });
            expect(result[1].type).toBe('postgresql');
        });

        it('should return empty array when no credentials file', async () => {
            mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

            const result = await projectService.getUserDbCredentials('testuser');

            expect(result).toEqual([]);
        });

        it('should support legacy German header format', async () => {
            const credentialsContent = `# Datenbank: user_mydb (erstellt: 2024-01-15, type: mariadb)
DB_TYPE=mariadb
DB_HOST=dployr-mariadb
DB_PORT=3306
DB_DATABASE=user_mydb
DB_USERNAME=user_mydb
DB_PASSWORD=secret`;

            mockFs.readFile.mockResolvedValue(credentialsContent);

            const result = await projectService.getUserDbCredentials('testuser');

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('user_mydb');
        });
    });

    describe('Module exports', () => {
        it('should export all required functions', () => {
            expect(projectService.getUserProjects).toBeDefined();
            expect(projectService.getProjectInfo).toBeDefined();
            expect(projectService.getAvailableTemplates).toBeDefined();
            expect(projectService.getNextAvailablePort).toBeDefined();
            expect(projectService.createProject).toBeDefined();
            expect(projectService.cloneProject).toBeDefined();
            expect(projectService.deleteProject).toBeDefined();
            expect(projectService.changeProjectType).toBeDefined();
            expect(projectService.parseEnvFile).toBeDefined();
            expect(projectService.readEnvFile).toBeDefined();
            expect(projectService.writeEnvFile).toBeDefined();
            expect(projectService.checkEnvExample).toBeDefined();
            expect(projectService.copyEnvExample).toBeDefined();
            expect(projectService.appendDbCredentials).toBeDefined();
            expect(projectService.mergeDbCredentials).toBeDefined();
            expect(projectService.getUserDbCredentials).toBeDefined();
        });
    });
});
