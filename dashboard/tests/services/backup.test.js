const fs = require('fs');
const path = require('path');

const testDir = '/tmp/dployr-test-backup';

// Set env BEFORE requiring modules
process.env.USERS_PATH = testDir;

// Mock database pool
const mockExecute = jest.fn();
jest.mock('../../src/config/database', () => ({
    pool: {
        execute: mockExecute
    }
}));

// Mock logger
jest.mock('../../src/config/logger', () => ({
    logger: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

// Mock child_process spawn
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
    spawn: mockSpawn
}));

// Mock database service
const mockGetUserDatabases = jest.fn();
const mockGetProvider = jest.fn();
jest.mock('../../src/services/database', () => ({
    getUserDatabases: mockGetUserDatabases,
    getProvider: mockGetProvider
}));

const backupService = require('../../src/services/backup');

describe('Backup Service', () => {
    const testUser = 'testuser';
    const testProject = 'testproject';
    const projectPath = path.join(testDir, testUser, testProject);
    const backupDir = path.join(testDir, testUser, '.backups');

    beforeAll(() => {
        // Create test directory structure
        fs.mkdirSync(path.join(projectPath, 'html'), { recursive: true });
        fs.writeFileSync(path.join(projectPath, 'docker-compose.yml'), 'version: "3"');
        fs.writeFileSync(path.join(projectPath, '.env'), 'TEST=value');
        fs.writeFileSync(path.join(projectPath, 'html', 'index.html'), '<html></html>');
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

    describe('formatFileSize', () => {
        it('should format bytes correctly', () => {
            expect(backupService.formatFileSize(0)).toBe('0 B');
            expect(backupService.formatFileSize(100)).toBe('100 B');
            expect(backupService.formatFileSize(1024)).toBe('1.0 KB');
            expect(backupService.formatFileSize(1024 * 1024)).toBe('1.0 MB');
            expect(backupService.formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB');
            expect(backupService.formatFileSize(1536)).toBe('1.5 KB');
        });

        it('should handle null/undefined', () => {
            expect(backupService.formatFileSize(null)).toBe('0 B');
            expect(backupService.formatFileSize(undefined)).toBe('0 B');
        });
    });

    describe('listBackups', () => {
        it('should list all backups for a user', async () => {
            const mockBackups = [
                { id: 1, backup_type: 'project', target_name: 'test', filename: 'backup.tar.gz' }
            ];
            mockExecute.mockResolvedValueOnce([mockBackups]);

            const result = await backupService.listBackups(1);

            expect(mockExecute).toHaveBeenCalled();
            expect(result).toEqual(mockBackups);
        });

        it('should filter by type', async () => {
            mockExecute.mockResolvedValueOnce([[]]);

            await backupService.listBackups(1, 'project');

            const [query, params] = mockExecute.mock.calls[0];
            expect(query).toContain('backup_type = ?');
            expect(params).toContain('project');
        });

        it('should filter by target name', async () => {
            mockExecute.mockResolvedValueOnce([[]]);

            await backupService.listBackups(1, null, 'myproject');

            const [query, params] = mockExecute.mock.calls[0];
            expect(query).toContain('target_name = ?');
            expect(params).toContain('myproject');
        });
    });

    describe('getBackupInfo', () => {
        it('should return backup info', async () => {
            const mockBackup = { id: 1, filename: 'test.tar.gz', system_username: 'user' };
            mockExecute.mockResolvedValueOnce([[mockBackup]]);

            const result = await backupService.getBackupInfo(1);

            expect(result).toEqual(mockBackup);
        });

        it('should return null for non-existent backup', async () => {
            mockExecute.mockResolvedValueOnce([[]]);

            const result = await backupService.getBackupInfo(999);

            expect(result).toBeNull();
        });
    });

    describe('getBackupStats', () => {
        it('should return backup statistics', async () => {
            const mockStats = {
                total_backups: 5,
                project_backups: 3,
                database_backups: 2,
                total_size: 1024000,
                last_backup: new Date()
            };
            mockExecute.mockResolvedValueOnce([[mockStats]]);

            const result = await backupService.getBackupStats(1);

            expect(result).toEqual(mockStats);
        });
    });

    describe('getProjectBackups', () => {
        it('should return recent backups for a project', async () => {
            const mockBackups = [
                { id: 1, filename: 'backup1.tar.gz' },
                { id: 2, filename: 'backup2.tar.gz' }
            ];
            mockExecute.mockResolvedValueOnce([mockBackups]);

            const result = await backupService.getProjectBackups(1, 'myproject', 5);

            expect(result).toEqual(mockBackups);
            const [query, params] = mockExecute.mock.calls[0];
            expect(params).toContain(5);
        });
    });

    describe('deleteBackup', () => {
        it('should delete backup file and database record', async () => {
            const mockBackup = {
                id: 1,
                filename: 'test.tar.gz',
                system_username: testUser,
                user_id: 1
            };
            mockExecute
                .mockResolvedValueOnce([[mockBackup]]) // getBackupInfo
                .mockResolvedValueOnce([{ affectedRows: 1 }]); // delete

            // Create a mock backup file
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(path.join(backupDir, 'test.tar.gz'), 'mock backup');

            const result = await backupService.deleteBackup(1, testUser);

            expect(result).toBe(true);
            expect(mockExecute).toHaveBeenCalledTimes(2);
        });

        it('should throw error if backup not found', async () => {
            mockExecute.mockResolvedValueOnce([[]]);

            await expect(backupService.deleteBackup(999, testUser))
                .rejects.toThrow('Backup not found');
        });
    });

    describe('backupFileExists', () => {
        it('should return true if file exists', async () => {
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(path.join(backupDir, 'exists.tar.gz'), 'data');

            const result = await backupService.backupFileExists(testUser, 'exists.tar.gz');

            expect(result).toBe(true);
        });

        it('should return false if file does not exist', async () => {
            const result = await backupService.backupFileExists(testUser, 'nonexistent.tar.gz');

            expect(result).toBe(false);
        });
    });

    describe('getBackupFilePath', () => {
        it('should return correct path', () => {
            const result = backupService.getBackupFilePath(testUser, 'backup.tar.gz');

            expect(result).toBe(path.join(testDir, testUser, '.backups', 'backup.tar.gz'));
        });
    });

    describe('DEFAULT_EXCLUDE_PATTERNS', () => {
        it('should include common directories to exclude', () => {
            expect(backupService.DEFAULT_EXCLUDE_PATTERNS).toContain('node_modules');
            expect(backupService.DEFAULT_EXCLUDE_PATTERNS).toContain('vendor');
            expect(backupService.DEFAULT_EXCLUDE_PATTERNS).toContain('.git');
        });
    });

    describe('createDatabaseBackup', () => {
        const mockDumpDatabase = jest.fn();

        beforeEach(() => {
            mockGetUserDatabases.mockReset();
            mockGetProvider.mockReset();
            mockDumpDatabase.mockReset();
            mockGetProvider.mockReturnValue({ dumpDatabase: mockDumpDatabase });
        });

        it('should throw error if database not found', async () => {
            mockGetUserDatabases.mockResolvedValue([]);

            await expect(backupService.createDatabaseBackup(1, testUser, 'nonexistent'))
                .rejects.toThrow('Database not found');
        });

        it('should call provider dumpDatabase with correct parameters', async () => {
            const dbInfo = {
                database: 'testuser_mydb',
                username: 'testuser_mydb',
                password: 'secret123',
                type: 'mariadb'
            };
            mockGetUserDatabases.mockResolvedValue([dbInfo]);
            mockDumpDatabase.mockResolvedValue({ success: true });

            // Mock database insert for backup log
            mockExecute
                .mockResolvedValueOnce([{ insertId: 1 }])  // INSERT
                .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE

            // Create backup dir
            fs.mkdirSync(backupDir, { recursive: true });

            // Create a mock backup file that would be created by dumpDatabase
            mockDumpDatabase.mockImplementation(async (dbName, user, pass, outputPath) => {
                fs.writeFileSync(outputPath, 'SQL DUMP DATA');
                return { success: true };
            });

            const result = await backupService.createDatabaseBackup(1, testUser, 'testuser_mydb');

            expect(mockGetUserDatabases).toHaveBeenCalledWith(testUser);
            expect(mockGetProvider).toHaveBeenCalledWith('mariadb');
            expect(mockDumpDatabase).toHaveBeenCalledWith(
                'testuser_mydb',
                'testuser_mydb',
                'secret123',
                expect.stringContaining('.sql')
            );
            expect(result).toHaveProperty('filename');
            expect(result.filename).toContain('database_testuser_mydb');
            expect(result.filename).toContain('.sql');
        });

        it('should use correct provider for PostgreSQL', async () => {
            const dbInfo = {
                database: 'testuser_pgdb',
                username: 'testuser_pgdb',
                password: 'secret456',
                type: 'postgresql'
            };
            mockGetUserDatabases.mockResolvedValue([dbInfo]);

            mockDumpDatabase.mockImplementation(async (dbName, user, pass, outputPath) => {
                fs.writeFileSync(outputPath, 'PG SQL DUMP');
                return { success: true };
            });

            mockExecute
                .mockResolvedValueOnce([{ insertId: 2 }])
                .mockResolvedValueOnce([{ affectedRows: 1 }]);

            fs.mkdirSync(backupDir, { recursive: true });

            await backupService.createDatabaseBackup(1, testUser, 'testuser_pgdb');

            expect(mockGetProvider).toHaveBeenCalledWith('postgresql');
        });

        it('should log error on dump failure', async () => {
            const dbInfo = {
                database: 'testuser_faildb',
                username: 'testuser_faildb',
                password: 'secret789',
                type: 'mariadb'
            };
            mockGetUserDatabases.mockResolvedValue([dbInfo]);
            mockDumpDatabase.mockRejectedValue(new Error('mysqldump failed'));

            mockExecute
                .mockResolvedValueOnce([{ insertId: 3 }])
                .mockResolvedValueOnce([{ affectedRows: 1 }]);

            fs.mkdirSync(backupDir, { recursive: true });

            await expect(backupService.createDatabaseBackup(1, testUser, 'testuser_faildb'))
                .rejects.toThrow('mysqldump failed');

            // Verify status was updated to failed
            const updateCall = mockExecute.mock.calls[1];
            expect(updateCall[0]).toContain('status = \'failed\'');
        });
    });
});
