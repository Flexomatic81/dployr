/**
 * Security utilities tests
 */

const fs = require('fs');
const path = require('path');

// Mock logger
jest.mock('../../src/config/logger', () => ({
    logger: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

const {
    sanitizeReturnUrl,
    removeBlockedFiles,
    isValidSqlIdentifier,
    assertValidSqlIdentifier,
    MAX_SQL_IDENTIFIER_LENGTH
} = require('../../src/services/utils/security');

describe('Security Utils', () => {
    describe('sanitizeReturnUrl', () => {
        const fallback = '/default';

        describe('valid local paths', () => {
            it('should allow simple local paths', () => {
                expect(sanitizeReturnUrl('/projects', fallback)).toBe('/projects');
                expect(sanitizeReturnUrl('/backups', fallback)).toBe('/backups');
                expect(sanitizeReturnUrl('/dashboard', fallback)).toBe('/dashboard');
            });

            it('should allow paths with segments', () => {
                expect(sanitizeReturnUrl('/projects/my-project', fallback)).toBe('/projects/my-project');
                expect(sanitizeReturnUrl('/admin/settings/npm', fallback)).toBe('/admin/settings/npm');
            });

            it('should allow paths with underscores and hyphens', () => {
                expect(sanitizeReturnUrl('/projects/my_project', fallback)).toBe('/projects/my_project');
                expect(sanitizeReturnUrl('/test-project/backups', fallback)).toBe('/test-project/backups');
            });

            it('should allow root path', () => {
                expect(sanitizeReturnUrl('/', fallback)).toBe('/');
            });
        });

        describe('malicious URLs - Open Redirect attacks', () => {
            it('should block absolute URLs with protocol', () => {
                expect(sanitizeReturnUrl('http://evil.com', fallback)).toBe(fallback);
                expect(sanitizeReturnUrl('https://evil.com', fallback)).toBe(fallback);
                expect(sanitizeReturnUrl('ftp://evil.com', fallback)).toBe(fallback);
            });

            it('should block protocol-relative URLs (//)', () => {
                expect(sanitizeReturnUrl('//evil.com', fallback)).toBe(fallback);
                expect(sanitizeReturnUrl('//evil.com/path', fallback)).toBe(fallback);
            });

            it('should block javascript: URLs', () => {
                expect(sanitizeReturnUrl('javascript:alert(1)', fallback)).toBe(fallback);
                expect(sanitizeReturnUrl('JavaScript:alert(1)', fallback)).toBe(fallback);
            });

            it('should block data: URLs', () => {
                expect(sanitizeReturnUrl('data:text/html,<script>alert(1)</script>', fallback)).toBe(fallback);
            });

            it('should block URLs with special characters', () => {
                expect(sanitizeReturnUrl('/path?redirect=http://evil.com', fallback)).toBe(fallback);
                expect(sanitizeReturnUrl('/path#http://evil.com', fallback)).toBe(fallback);
                expect(sanitizeReturnUrl('/path/../../../etc/passwd', fallback)).toBe(fallback);
            });

            it('should block encoded attacks', () => {
                expect(sanitizeReturnUrl('/%2F/evil.com', fallback)).toBe(fallback);
                expect(sanitizeReturnUrl('/\\evil.com', fallback)).toBe(fallback);
            });
        });

        describe('edge cases', () => {
            it('should return fallback for null/undefined', () => {
                expect(sanitizeReturnUrl(null, fallback)).toBe(fallback);
                expect(sanitizeReturnUrl(undefined, fallback)).toBe(fallback);
            });

            it('should return fallback for empty string', () => {
                expect(sanitizeReturnUrl('', fallback)).toBe(fallback);
            });

            it('should return fallback for non-string values', () => {
                expect(sanitizeReturnUrl(123, fallback)).toBe(fallback);
                expect(sanitizeReturnUrl({}, fallback)).toBe(fallback);
                expect(sanitizeReturnUrl([], fallback)).toBe(fallback);
            });

            it('should return fallback for paths not starting with /', () => {
                expect(sanitizeReturnUrl('projects/test', fallback)).toBe(fallback);
                expect(sanitizeReturnUrl('relative/path', fallback)).toBe(fallback);
            });
        });
    });

    describe('removeBlockedFiles', () => {
        const testDir = '/tmp/dployr-security-test';

        beforeAll(() => {
            fs.mkdirSync(testDir, { recursive: true });
        });

        afterAll(() => {
            try {
                fs.rmSync(testDir, { recursive: true, force: true });
            } catch {}
        });

        beforeEach(() => {
            // Clean directory
            const files = fs.readdirSync(testDir);
            for (const file of files) {
                fs.unlinkSync(path.join(testDir, file));
            }
        });

        // NOTE: Docker files are now ALLOWED since custom docker-compose feature.
        // BLOCKED_PROJECT_FILES is now empty by default.
        // These tests verify the function still works correctly but doesn't block Docker files.

        it('should NOT remove Dockerfile (now allowed)', () => {
            const dockerFile = path.join(testDir, 'Dockerfile');
            fs.writeFileSync(dockerFile, 'FROM node:20');

            const removed = removeBlockedFiles(testDir);

            expect(removed).toEqual([]);
            expect(fs.existsSync(dockerFile)).toBe(true);
        });

        it('should NOT remove docker-compose.yml (now allowed)', () => {
            const composeFile = path.join(testDir, 'docker-compose.yml');
            fs.writeFileSync(composeFile, 'version: "3"');

            const removed = removeBlockedFiles(testDir);

            expect(removed).toEqual([]);
            expect(fs.existsSync(composeFile)).toBe(true);
        });

        it('should return empty array for empty directory', () => {
            const removed = removeBlockedFiles(testDir);
            expect(removed).toEqual([]);
        });

        it('should return empty array for non-existent path', () => {
            const removed = removeBlockedFiles('/non/existent/path');
            expect(removed).toEqual([]);
        });

        it('should return empty array for null path', () => {
            const removed = removeBlockedFiles(null);
            expect(removed).toEqual([]);
        });

        it('should not remove non-blocked files', () => {
            const safeFile = path.join(testDir, 'index.html');
            fs.writeFileSync(safeFile, '<html></html>');

            const removed = removeBlockedFiles(testDir);

            expect(removed).not.toContain(safeFile);
            expect(fs.existsSync(safeFile)).toBe(true);
        });
    });

    describe('isValidSqlIdentifier', () => {
        describe('valid identifiers', () => {
            it('should accept simple lowercase identifiers', () => {
                expect(isValidSqlIdentifier('users')).toBe(true);
                expect(isValidSqlIdentifier('projects')).toBe(true);
                expect(isValidSqlIdentifier('mydb')).toBe(true);
            });

            it('should accept identifiers with underscores', () => {
                expect(isValidSqlIdentifier('john_blog')).toBe(true);
                expect(isValidSqlIdentifier('user_database')).toBe(true);
                expect(isValidSqlIdentifier('my_app_db')).toBe(true);
            });

            it('should accept identifiers starting with underscore', () => {
                expect(isValidSqlIdentifier('_internal')).toBe(true);
                expect(isValidSqlIdentifier('_temp_db')).toBe(true);
            });

            it('should accept identifiers with numbers', () => {
                expect(isValidSqlIdentifier('db1')).toBe(true);
                expect(isValidSqlIdentifier('user123_db')).toBe(true);
                expect(isValidSqlIdentifier('app2024')).toBe(true);
            });

            it('should accept uppercase and mixed case', () => {
                expect(isValidSqlIdentifier('Users')).toBe(true);
                expect(isValidSqlIdentifier('MyDatabase')).toBe(true);
                expect(isValidSqlIdentifier('UPPERCASE')).toBe(true);
            });

            it('should accept single character identifiers', () => {
                expect(isValidSqlIdentifier('a')).toBe(true);
                expect(isValidSqlIdentifier('Z')).toBe(true);
                expect(isValidSqlIdentifier('_')).toBe(true);
            });
        });

        describe('invalid identifiers - SQL injection attempts', () => {
            it('should reject identifiers starting with numbers', () => {
                expect(isValidSqlIdentifier('123db')).toBe(false);
                expect(isValidSqlIdentifier('1_user')).toBe(false);
            });

            it('should reject identifiers with SQL special characters', () => {
                expect(isValidSqlIdentifier("user'; DROP TABLE users;--")).toBe(false);
                expect(isValidSqlIdentifier('db"name')).toBe(false);
                expect(isValidSqlIdentifier('db`name')).toBe(false);
            });

            it('should reject identifiers with semicolons', () => {
                expect(isValidSqlIdentifier('db;DROP')).toBe(false);
            });

            it('should reject identifiers with spaces', () => {
                expect(isValidSqlIdentifier('my db')).toBe(false);
                expect(isValidSqlIdentifier(' trimme')).toBe(false);
                expect(isValidSqlIdentifier('trimme ')).toBe(false);
            });

            it('should reject identifiers with hyphens', () => {
                expect(isValidSqlIdentifier('my-database')).toBe(false);
                expect(isValidSqlIdentifier('user-name')).toBe(false);
            });

            it('should reject identifiers with dots', () => {
                expect(isValidSqlIdentifier('db.table')).toBe(false);
                expect(isValidSqlIdentifier('schema.name')).toBe(false);
            });

            it('should reject identifiers with special characters', () => {
                expect(isValidSqlIdentifier('db@name')).toBe(false);
                expect(isValidSqlIdentifier('db#name')).toBe(false);
                expect(isValidSqlIdentifier('db$name')).toBe(false);
                expect(isValidSqlIdentifier('db%name')).toBe(false);
                expect(isValidSqlIdentifier('db&name')).toBe(false);
                expect(isValidSqlIdentifier('db*name')).toBe(false);
                expect(isValidSqlIdentifier('db(name)')).toBe(false);
            });

            it('should reject identifiers with slashes', () => {
                expect(isValidSqlIdentifier('db/name')).toBe(false);
                expect(isValidSqlIdentifier('db\\name')).toBe(false);
            });

            it('should reject identifiers with newlines', () => {
                expect(isValidSqlIdentifier('db\nname')).toBe(false);
                expect(isValidSqlIdentifier('db\rname')).toBe(false);
            });
        });

        describe('edge cases', () => {
            it('should reject null and undefined', () => {
                expect(isValidSqlIdentifier(null)).toBe(false);
                expect(isValidSqlIdentifier(undefined)).toBe(false);
            });

            it('should reject empty string', () => {
                expect(isValidSqlIdentifier('')).toBe(false);
            });

            it('should reject non-string values', () => {
                expect(isValidSqlIdentifier(123)).toBe(false);
                expect(isValidSqlIdentifier({})).toBe(false);
                expect(isValidSqlIdentifier([])).toBe(false);
                expect(isValidSqlIdentifier(true)).toBe(false);
            });

            it('should reject identifiers exceeding max length', () => {
                const longIdentifier = 'a'.repeat(MAX_SQL_IDENTIFIER_LENGTH + 1);
                expect(isValidSqlIdentifier(longIdentifier)).toBe(false);
            });

            it('should accept identifiers at max length', () => {
                const maxLengthIdentifier = 'a'.repeat(MAX_SQL_IDENTIFIER_LENGTH);
                expect(isValidSqlIdentifier(maxLengthIdentifier)).toBe(true);
            });
        });
    });

    describe('assertValidSqlIdentifier', () => {
        it('should not throw for valid identifiers', () => {
            expect(() => assertValidSqlIdentifier('valid_db')).not.toThrow();
            expect(() => assertValidSqlIdentifier('user123')).not.toThrow();
        });

        it('should throw for invalid identifiers', () => {
            expect(() => assertValidSqlIdentifier("user'; DROP TABLE--")).toThrow();
            expect(() => assertValidSqlIdentifier('123invalid')).toThrow();
            expect(() => assertValidSqlIdentifier('')).toThrow();
        });

        it('should include context in error message', () => {
            expect(() => assertValidSqlIdentifier('bad-name', 'database name'))
                .toThrow(/database name/);
        });

        it('should mention the invalid identifier in error message', () => {
            expect(() => assertValidSqlIdentifier('bad-name', 'test'))
                .toThrow(/bad-name/);
        });
    });

    describe('MAX_SQL_IDENTIFIER_LENGTH', () => {
        it('should be 63 (PostgreSQL limit)', () => {
            expect(MAX_SQL_IDENTIFIER_LENGTH).toBe(63);
        });
    });
});
