const fs = require('fs').promises;
const path = require('path');

const testDir = '/tmp/dployr-test-db';

// Set env BEFORE requiring modules
process.env.USERS_PATH = testDir;

// Mock providers
jest.mock('../../src/services/providers/mariadb-provider', () => ({
    createDatabase: jest.fn(),
    deleteDatabase: jest.fn(),
    testConnection: jest.fn()
}));

jest.mock('../../src/services/providers/postgresql-provider', () => ({
    createDatabase: jest.fn(),
    deleteDatabase: jest.fn(),
    testConnection: jest.fn()
}));

// Mock config/database
jest.mock('../../src/config/database', () => ({
    pool: {
        execute: jest.fn(),
        query: jest.fn()
    }
}));

const mariadbProvider = require('../../src/services/providers/mariadb-provider');
const postgresqlProvider = require('../../src/services/providers/postgresql-provider');
const databaseService = require('../../src/services/database');

describe('Database Service', () => {
    const testUser = 'testuser';

    beforeAll(async () => {
        // Create test directory
        await fs.mkdir(path.join(testDir, testUser), { recursive: true });
    });

    afterAll(async () => {
        // Cleanup
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch {}
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getProvider', () => {
        it('should return mariadb provider by default', () => {
            const provider = databaseService.getProvider();
            expect(provider).toBe(mariadbProvider);
        });

        it('should return mariadb provider for "mariadb" type', () => {
            const provider = databaseService.getProvider('mariadb');
            expect(provider).toBe(mariadbProvider);
        });

        it('should return mariadb provider for "mysql" type', () => {
            const provider = databaseService.getProvider('mysql');
            expect(provider).toBe(mariadbProvider);
        });

        it('should return postgresql provider for "postgresql" type', () => {
            const provider = databaseService.getProvider('postgresql');
            expect(provider).toBe(postgresqlProvider);
        });

        it('should return postgresql provider for "postgres" type', () => {
            const provider = databaseService.getProvider('postgres');
            expect(provider).toBe(postgresqlProvider);
        });
    });

    describe('getUserDatabases', () => {
        it('should return empty array if credentials file does not exist', async () => {
            const databases = await databaseService.getUserDatabases('nonexistent');
            expect(databases).toEqual([]);
        });

        it('should parse credentials file correctly', async () => {
            const credentialsPath = path.join(testDir, testUser, '.db-credentials');
            const content = `
# Datenbank: testuser_mydb (erstellt: 2024-01-15T12:00:00.000Z, typ: mariadb)
DB_TYPE=mariadb
DB_HOST=dployr-mariadb
DB_PORT=3306
DB_DATABASE=testuser_mydb
DB_USERNAME=testuser_mydb
DB_PASSWORD=secret123
`;
            await fs.writeFile(credentialsPath, content);

            const databases = await databaseService.getUserDatabases(testUser);

            expect(databases).toHaveLength(1);
            expect(databases[0]).toEqual({
                name: 'testuser_mydb',
                type: 'mariadb',
                host: 'dployr-mariadb',
                port: 3306,
                database: 'testuser_mydb',
                username: 'testuser_mydb',
                password: 'secret123'
            });

            await fs.unlink(credentialsPath);
        });

        it('should parse multiple databases', async () => {
            const credentialsPath = path.join(testDir, testUser, '.db-credentials');
            const content = `
# Datenbank: testuser_db1 (erstellt: 2024-01-15T12:00:00.000Z, typ: mariadb)
DB_TYPE=mariadb
DB_HOST=dployr-mariadb
DB_PORT=3306
DB_DATABASE=testuser_db1
DB_USERNAME=testuser_db1
DB_PASSWORD=pass1

# Datenbank: testuser_db2 (erstellt: 2024-01-15T13:00:00.000Z, typ: postgresql)
DB_TYPE=postgresql
DB_HOST=dployr-postgresql
DB_PORT=5432
DB_DATABASE=testuser_db2
DB_USERNAME=testuser_db2
DB_PASSWORD=pass2
`;
            await fs.writeFile(credentialsPath, content);

            const databases = await databaseService.getUserDatabases(testUser);

            expect(databases).toHaveLength(2);
            expect(databases[0].type).toBe('mariadb');
            expect(databases[1].type).toBe('postgresql');

            await fs.unlink(credentialsPath);
        });
    });

    describe('createDatabase', () => {
        it('should reject invalid database names', async () => {
            await expect(databaseService.createDatabase(testUser, 'Invalid-Name'))
                .rejects.toThrow('Database name may only contain lowercase letters, numbers and underscores');

            await expect(databaseService.createDatabase(testUser, 'has spaces'))
                .rejects.toThrow('Database name may only contain lowercase letters, numbers and underscores');

            await expect(databaseService.createDatabase(testUser, 'UPPERCASE'))
                .rejects.toThrow('Database name may only contain lowercase letters, numbers and underscores');
        });

        it('should accept valid database names', async () => {
            const mockResult = {
                database: 'testuser_valid_db',
                username: 'testuser_valid_db',
                password: 'generated_password',
                host: 'dployr-mariadb',
                port: 3306,
                type: 'mariadb'
            };

            mariadbProvider.createDatabase.mockResolvedValue(mockResult);

            const result = await databaseService.createDatabase(testUser, 'valid_db', 'mariadb');

            expect(mariadbProvider.createDatabase).toHaveBeenCalledWith(testUser, 'valid_db');
            expect(result).toEqual(mockResult);

            // Cleanup credentials file
            const credentialsPath = path.join(testDir, testUser, '.db-credentials');
            try { await fs.unlink(credentialsPath); } catch {}
        });

        it('should use postgresql provider when type is postgresql', async () => {
            const mockResult = {
                database: 'testuser_pg_db',
                username: 'testuser_pg_db',
                password: 'generated_password',
                host: 'dployr-postgresql',
                port: 5432,
                type: 'postgresql'
            };

            postgresqlProvider.createDatabase.mockResolvedValue(mockResult);

            const result = await databaseService.createDatabase(testUser, 'pg_db', 'postgresql');

            expect(postgresqlProvider.createDatabase).toHaveBeenCalledWith(testUser, 'pg_db');
            expect(result).toEqual(mockResult);

            // Cleanup
            const credentialsPath = path.join(testDir, testUser, '.db-credentials');
            try { await fs.unlink(credentialsPath); } catch {}
        });
    });

    describe('getAvailableTypes', () => {
        it('should return mariadb and postgresql types', () => {
            const types = databaseService.getAvailableTypes();

            expect(types).toHaveLength(2);
            expect(types.map(t => t.id)).toContain('mariadb');
            expect(types.map(t => t.id)).toContain('postgresql');
        });

        it('should include required properties for each type', () => {
            const types = databaseService.getAvailableTypes();

            for (const type of types) {
                expect(type).toHaveProperty('id');
                expect(type).toHaveProperty('name');
                expect(type).toHaveProperty('description');
                expect(type).toHaveProperty('icon');
                expect(type).toHaveProperty('port');
                expect(type).toHaveProperty('managementTool');
            }
        });
    });

    describe('testConnection', () => {
        it('should call mariadb provider testConnection by default', async () => {
            mariadbProvider.testConnection.mockResolvedValue(true);

            await databaseService.testConnection();

            expect(mariadbProvider.testConnection).toHaveBeenCalled();
        });

        it('should call postgresql provider testConnection when specified', async () => {
            postgresqlProvider.testConnection.mockResolvedValue(true);

            await databaseService.testConnection('postgresql');

            expect(postgresqlProvider.testConnection).toHaveBeenCalled();
        });
    });
});
