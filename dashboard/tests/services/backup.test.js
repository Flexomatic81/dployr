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

    describe('getDatabaseBackups', () => {
        it('should return empty array if no database names provided', async () => {
            const result = await backupService.getDatabaseBackups(1, []);
            expect(result).toEqual([]);
            expect(mockExecute).not.toHaveBeenCalled();
        });

        it('should return empty array if database names is null', async () => {
            const result = await backupService.getDatabaseBackups(1, null);
            expect(result).toEqual([]);
            expect(mockExecute).not.toHaveBeenCalled();
        });

        it('should return backups for given databases', async () => {
            const mockBackups = [
                { id: 1, target_name: 'testdb1', filename: 'db1.sql' },
                { id: 2, target_name: 'testdb2', filename: 'db2.sql' }
            ];
            mockExecute.mockResolvedValueOnce([mockBackups]);

            const result = await backupService.getDatabaseBackups(1, ['testdb1', 'testdb2'], 3);

            expect(result).toEqual(mockBackups);
            const [query, params] = mockExecute.mock.calls[0];
            expect(query).toContain('IN (?,?)');
            expect(params).toContain('testdb1');
            expect(params).toContain('testdb2');
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

    describe('getBackupPreview', () => {
        beforeEach(() => {
            // Ensure backup directory and test files exist
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(path.join(backupDir, 'test.tar.gz'), 'mock tar data');
            fs.writeFileSync(path.join(backupDir, 'invalid.tar.gz'), 'corrupt data');
        });

        it('should list archive contents', async () => {
            const mockStdout = {
                on: jest.fn((event, callback) => {
                    if (event === 'data') {
                        callback('file1.txt\nfile2.txt\nfolder/file3.txt\n');
                    }
                })
            };
            const mockStderr = { on: jest.fn() };
            const mockProcess = {
                stdout: mockStdout,
                stderr: mockStderr,
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        callback(0);
                    }
                })
            };
            mockSpawn.mockReturnValue(mockProcess);

            const result = await backupService.getBackupPreview(testUser, 'test.tar.gz');

            expect(mockSpawn).toHaveBeenCalledWith('tar', ['-tzf', expect.stringContaining('test.tar.gz')]);
            expect(result.files).toHaveLength(3);
            expect(result.files).toContain('file1.txt');
            expect(result.totalFiles).toBe(3);
            expect(result.truncated).toBe(false);
        });

        it('should truncate if more than limit files', async () => {
            const manyFiles = Array.from({ length: 150 }, (_, i) => `file${i}.txt`).join('\n');
            const mockStdout = {
                on: jest.fn((event, callback) => {
                    if (event === 'data') {
                        callback(manyFiles);
                    }
                })
            };
            const mockStderr = { on: jest.fn() };
            const mockProcess = {
                stdout: mockStdout,
                stderr: mockStderr,
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        callback(0);
                    }
                })
            };
            mockSpawn.mockReturnValue(mockProcess);

            const result = await backupService.getBackupPreview(testUser, 'test.tar.gz', 100);

            expect(result.files).toHaveLength(100);
            expect(result.totalFiles).toBe(150);
            expect(result.truncated).toBe(true);
        });

        it('should reject on tar error', async () => {
            const mockStdout = { on: jest.fn() };
            const mockStderr = {
                on: jest.fn((event, callback) => {
                    if (event === 'data') {
                        callback('tar: Error opening archive');
                    }
                })
            };
            const mockProcess = {
                stdout: mockStdout,
                stderr: mockStderr,
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        callback(1);
                    }
                })
            };
            mockSpawn.mockReturnValue(mockProcess);

            await expect(backupService.getBackupPreview(testUser, 'invalid.tar.gz'))
                .rejects.toThrow('Failed to read archive');
        });
    });

    describe('restoreProjectBackup', () => {
        it('should throw error if backup not found', async () => {
            mockExecute.mockResolvedValueOnce([[]]);

            await expect(backupService.restoreProjectBackup(testUser, 999))
                .rejects.toThrow('Backup not found');
        });

        it('should throw error if backup is not a project backup', async () => {
            mockExecute.mockResolvedValueOnce([[{
                id: 1,
                backup_type: 'database',
                target_name: 'testdb',
                filename: 'database_testdb.sql',
                system_username: testUser
            }]]);

            await expect(backupService.restoreProjectBackup(testUser, 1))
                .rejects.toThrow('Not a project backup');
        });

        it('should throw error if backup file not found', async () => {
            mockExecute.mockResolvedValueOnce([[{
                id: 1,
                backup_type: 'project',
                target_name: testProject,
                filename: 'nonexistent.tar.gz',
                system_username: testUser
            }]]);

            await expect(backupService.restoreProjectBackup(testUser, 1))
                .rejects.toThrow('Backup file not found');
        });

        it('should restore project backup successfully', async () => {
            // Create backup file
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(path.join(backupDir, 'project_test.tar.gz'), 'mock tar data');

            mockExecute.mockResolvedValueOnce([[{
                id: 1,
                backup_type: 'project',
                target_name: testProject,
                filename: 'project_test.tar.gz',
                system_username: testUser
            }]]);

            const mockProcess = {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        callback(0);
                    }
                })
            };
            mockSpawn.mockReturnValue(mockProcess);

            const result = await backupService.restoreProjectBackup(testUser, 1);

            expect(result.success).toBe(true);
            expect(result.projectName).toBe(testProject);
            expect(mockSpawn).toHaveBeenCalledWith('tar', expect.arrayContaining(['-xzf', '--overwrite']));
        });

        it('should reject on tar extraction error', async () => {
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(path.join(backupDir, 'corrupt.tar.gz'), 'corrupt data');

            mockExecute.mockResolvedValueOnce([[{
                id: 1,
                backup_type: 'project',
                target_name: testProject,
                filename: 'corrupt.tar.gz',
                system_username: testUser
            }]]);

            const mockProcess = {
                stdout: { on: jest.fn() },
                stderr: {
                    on: jest.fn((event, callback) => {
                        if (event === 'data') {
                            callback('tar: This does not look like a tar archive');
                        }
                    })
                },
                on: jest.fn((event, callback) => {
                    if (event === 'close') {
                        callback(1);
                    }
                })
            };
            mockSpawn.mockReturnValue(mockProcess);

            await expect(backupService.restoreProjectBackup(testUser, 1))
                .rejects.toThrow('tar: This does not look like a tar archive');
        });
    });

    describe('restoreDatabaseBackup', () => {
        const mockRestoreDatabase = jest.fn();

        beforeEach(() => {
            mockGetUserDatabases.mockReset();
            mockGetProvider.mockReset();
            mockRestoreDatabase.mockReset();
            mockGetProvider.mockReturnValue({ restoreDatabase: mockRestoreDatabase });
        });

        it('should throw error if backup not found', async () => {
            mockExecute.mockResolvedValueOnce([[]]);

            await expect(backupService.restoreDatabaseBackup(testUser, 999))
                .rejects.toThrow('Backup not found');
        });

        it('should throw error if backup is not a database backup', async () => {
            mockExecute.mockResolvedValueOnce([[{
                id: 1,
                backup_type: 'project',
                target_name: testProject,
                filename: 'project_test.tar.gz',
                system_username: testUser
            }]]);

            await expect(backupService.restoreDatabaseBackup(testUser, 1))
                .rejects.toThrow('Not a database backup');
        });

        it('should throw error if database not found', async () => {
            // Create backup file first
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(path.join(backupDir, 'database_testdb.sql'), 'SQL DUMP');

            mockExecute.mockResolvedValueOnce([[{
                id: 1,
                backup_type: 'database',
                target_name: 'testdb',
                filename: 'database_testdb.sql',
                system_username: testUser
            }]]);
            mockGetUserDatabases.mockResolvedValue([]);

            await expect(backupService.restoreDatabaseBackup(testUser, 1))
                .rejects.toThrow('Database not found');
        });

        it('should restore MariaDB backup successfully', async () => {
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(path.join(backupDir, 'database_testdb.sql'), 'SQL DUMP');

            mockExecute.mockResolvedValueOnce([[{
                id: 1,
                backup_type: 'database',
                target_name: 'testuser_testdb',
                filename: 'database_testdb.sql',
                system_username: testUser
            }]]);

            mockGetUserDatabases.mockResolvedValue([{
                database: 'testuser_testdb',
                username: 'testuser_testdb',
                password: 'secret123',
                type: 'mariadb'
            }]);

            mockRestoreDatabase.mockResolvedValue({ success: true });

            const result = await backupService.restoreDatabaseBackup(testUser, 1);

            expect(result.success).toBe(true);
            expect(result.databaseName).toBe('testuser_testdb');
            expect(mockGetProvider).toHaveBeenCalledWith('mariadb');
            expect(mockRestoreDatabase).toHaveBeenCalledWith(
                'testuser_testdb',
                'testuser_testdb',
                'secret123',
                expect.stringContaining('.sql')
            );
        });

        it('should restore PostgreSQL backup successfully', async () => {
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(path.join(backupDir, 'database_pgdb.sql'), 'PG SQL DUMP');

            mockExecute.mockResolvedValueOnce([[{
                id: 1,
                backup_type: 'database',
                target_name: 'testuser_pgdb',
                filename: 'database_pgdb.sql',
                system_username: testUser
            }]]);

            mockGetUserDatabases.mockResolvedValue([{
                database: 'testuser_pgdb',
                username: 'testuser_pgdb',
                password: 'secret456',
                type: 'postgresql'
            }]);

            mockRestoreDatabase.mockResolvedValue({ success: true });

            const result = await backupService.restoreDatabaseBackup(testUser, 1);

            expect(result.success).toBe(true);
            expect(mockGetProvider).toHaveBeenCalledWith('postgresql');
        });

        it('should throw error on restore failure', async () => {
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(path.join(backupDir, 'database_faildb.sql'), 'SQL DUMP');

            mockExecute.mockResolvedValueOnce([[{
                id: 1,
                backup_type: 'database',
                target_name: 'testuser_faildb',
                filename: 'database_faildb.sql',
                system_username: testUser
            }]]);

            mockGetUserDatabases.mockResolvedValue([{
                database: 'testuser_faildb',
                username: 'testuser_faildb',
                password: 'secret789',
                type: 'mariadb'
            }]);

            mockRestoreDatabase.mockRejectedValue(new Error('mysql restore failed'));

            await expect(backupService.restoreDatabaseBackup(testUser, 1))
                .rejects.toThrow('mysql restore failed');
        });
    });
});
