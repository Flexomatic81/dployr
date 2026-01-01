// Mock fs
const mockFs = {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readdirSync: jest.fn(),
    statSync: jest.fn(),
    renameSync: jest.fn(),
    rmdirSync: jest.fn(),
    rmSync: jest.fn(),
    unlinkSync: jest.fn()
};

// Mock adm-zip
const mockExtractAllTo = jest.fn();
jest.mock('adm-zip', () => {
    return jest.fn().mockImplementation(() => ({
        extractAllTo: mockExtractAllTo
    }));
});

// Mock git service
const mockGitService = {
    detectProjectType: jest.fn(),
    generateDockerCompose: jest.fn()
};

// Mock nginx utils
const mockGenerateNginxConfig = jest.fn();

// Mock security utils
const mockRemoveBlockedFiles = jest.fn();

jest.mock('fs', () => mockFs);
jest.mock('../../src/services/git', () => mockGitService);
jest.mock('../../src/services/utils/nginx', () => ({
    generateNginxConfig: mockGenerateNginxConfig
}));
jest.mock('../../src/services/utils/security', () => ({
    removeBlockedFiles: mockRemoveBlockedFiles
}));

const zipService = require('../../src/services/zip');

describe('Zip Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('extractZip', () => {
        it('should extract ZIP to destination', () => {
            zipService.extractZip('/tmp/file.zip', '/dest/path');

            expect(mockExtractAllTo).toHaveBeenCalledWith('/dest/path', true);
        });
    });

    describe('flattenIfNeeded', () => {
        it('should flatten when single directory exists', () => {
            mockFs.readdirSync
                .mockReturnValueOnce(['project-main']) // First call: destPath
                .mockReturnValueOnce(['index.html', 'style.css']); // Second call: singleEntryPath
            mockFs.statSync.mockReturnValue({ isDirectory: () => true });

            const result = zipService.flattenIfNeeded('/dest/path');

            expect(result).toBe(true);
            expect(mockFs.renameSync).toHaveBeenCalledTimes(2);
            expect(mockFs.rmdirSync).toHaveBeenCalledWith('/dest/path/project-main');
        });

        it('should not flatten when multiple entries exist', () => {
            mockFs.readdirSync.mockReturnValue(['file1.txt', 'file2.txt']);

            const result = zipService.flattenIfNeeded('/dest/path');

            expect(result).toBe(false);
            expect(mockFs.renameSync).not.toHaveBeenCalled();
        });

        it('should ignore hidden files when checking', () => {
            mockFs.readdirSync
                .mockReturnValueOnce(['.DS_Store', 'project-main'])
                .mockReturnValueOnce(['index.html']);
            mockFs.statSync.mockReturnValue({ isDirectory: () => true });

            const result = zipService.flattenIfNeeded('/dest/path');

            expect(result).toBe(true);
        });

        it('should not flatten when single entry is a file', () => {
            mockFs.readdirSync.mockReturnValue(['single-file.txt']);
            mockFs.statSync.mockReturnValue({ isDirectory: () => false });

            const result = zipService.flattenIfNeeded('/dest/path');

            expect(result).toBe(false);
        });
    });

    describe('createProjectFromZip', () => {
        it('should create project successfully', async () => {
            mockFs.existsSync
                .mockReturnValueOnce(false)  // Project doesn't exist
                .mockReturnValueOnce(false)  // html path doesn't exist
                .mockReturnValueOnce(true);  // ZIP exists for cleanup
            mockFs.readdirSync.mockReturnValue(['index.html', 'style.css']); // Multiple files (no flatten)
            mockGitService.detectProjectType.mockReturnValue('static');
            mockGitService.generateDockerCompose.mockReturnValue('version: "3"\n');
            mockGenerateNginxConfig.mockReturnValue('server {}');

            const result = await zipService.createProjectFromZip('testuser', 'my-project', '/tmp/upload.zip', 3000);

            expect(result).toEqual({
                success: true,
                projectType: 'static',
                path: expect.stringContaining('testuser/my-project'),
                port: 3000
            });
            expect(mockFs.mkdirSync).toHaveBeenCalled();
            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('docker-compose.yml'),
                'version: "3"\n'
            );
            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('.env'),
                expect.stringContaining('PROJECT_NAME=testuser-my-project')
            );
        });

        it('should throw error if project already exists', async () => {
            mockFs.existsSync
                .mockReturnValueOnce(true)  // Project exists
                .mockReturnValueOnce(true); // ZIP exists for cleanup

            await expect(
                zipService.createProjectFromZip('testuser', 'existing', '/tmp/upload.zip', 3000)
            ).rejects.toThrow('A project with this name already exists');

            expect(mockFs.unlinkSync).toHaveBeenCalledWith('/tmp/upload.zip'); // ZIP should be cleaned up
        });

        it('should create nginx config for static projects', async () => {
            mockFs.existsSync
                .mockReturnValueOnce(false) // Project doesn't exist
                .mockReturnValueOnce(false) // html path
                .mockReturnValueOnce(true); // ZIP cleanup
            mockFs.readdirSync.mockReturnValue(['index.html']);
            mockGitService.detectProjectType.mockReturnValue('static');
            mockGitService.generateDockerCompose.mockReturnValue('version: "3"\n');
            mockGenerateNginxConfig.mockReturnValue('server { location / {} }');

            await zipService.createProjectFromZip('testuser', 'static-site', '/tmp/upload.zip', 8080);

            expect(mockFs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('nginx'),
                { recursive: true }
            );
            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('nginx/default.conf'),
                'server { location / {} }'
            );
        });

        it('should not create nginx config for non-static projects', async () => {
            mockFs.existsSync
                .mockReturnValueOnce(false)
                .mockReturnValueOnce(false)
                .mockReturnValueOnce(true);
            mockFs.readdirSync.mockReturnValue(['package.json']);
            mockGitService.detectProjectType.mockReturnValue('nodejs');
            mockGitService.generateDockerCompose.mockReturnValue('version: "3"\n');

            await zipService.createProjectFromZip('testuser', 'node-app', '/tmp/upload.zip', 3000);

            expect(mockGenerateNginxConfig).not.toHaveBeenCalled();
        });

        it('should remove blocked files from html subfolder', async () => {
            mockFs.existsSync
                .mockReturnValueOnce(false) // Project doesn't exist
                .mockReturnValueOnce(true)  // html path exists
                .mockReturnValueOnce(true); // ZIP cleanup
            mockFs.readdirSync.mockReturnValue(['index.html']);
            mockGitService.detectProjectType.mockReturnValue('static');
            mockGitService.generateDockerCompose.mockReturnValue('version: "3"\n');
            mockRemoveBlockedFiles.mockReturnValue(['Dockerfile']);

            await zipService.createProjectFromZip('testuser', 'project', '/tmp/upload.zip', 3000);

            expect(mockRemoveBlockedFiles).toHaveBeenCalledWith(
                expect.stringContaining('html')
            );
        });

        it('should cleanup on error', async () => {
            mockFs.existsSync
                .mockReturnValueOnce(false)  // Project doesn't exist
                .mockReturnValueOnce(true);  // ZIP exists for cleanup
            mockFs.readdirSync.mockImplementation(() => {
                throw new Error('Read error');
            });

            await expect(
                zipService.createProjectFromZip('testuser', 'project', '/tmp/upload.zip', 3000)
            ).rejects.toThrow('Read error');

            expect(mockFs.rmSync).toHaveBeenCalledWith(
                expect.stringContaining('testuser/project'),
                { recursive: true, force: true }
            );
            expect(mockFs.unlinkSync).toHaveBeenCalledWith('/tmp/upload.zip'); // ZIP cleanup
        });
    });

    describe('Module exports', () => {
        it('should export required functions', () => {
            expect(zipService.createProjectFromZip).toBeDefined();
            expect(zipService.extractZip).toBeDefined();
            expect(zipService.flattenIfNeeded).toBeDefined();
        });
    });
});
