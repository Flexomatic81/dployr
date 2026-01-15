/**
 * Tests for crypto.js utilities
 * Tests password generation, SQL escaping, and shell argument escaping
 */
const {
    generatePassword,
    escapeSqlString,
    escapeShellArg
} = require('../../src/services/utils/crypto');

describe('Crypto Utilities', () => {
    describe('generatePassword', () => {
        it('should generate password with default length of 16', () => {
            const password = generatePassword();

            expect(password).toHaveLength(16);
        });

        it('should generate password with custom length', () => {
            const password = generatePassword(32);

            expect(password).toHaveLength(32);
        });

        it('should generate password with short length', () => {
            const password = generatePassword(8);

            expect(password).toHaveLength(8);
        });

        it('should only contain alphanumeric characters', () => {
            const password = generatePassword(100);

            // Should only contain A-Z, a-z, 0-9
            expect(password).toMatch(/^[A-Za-z0-9]+$/);
        });

        it('should not contain special characters that need escaping', () => {
            // Generate many passwords to ensure no problematic characters
            for (let i = 0; i < 100; i++) {
                const password = generatePassword(16);

                // Should not contain SQL-problematic characters
                expect(password).not.toContain("'");
                expect(password).not.toContain('"');
                expect(password).not.toContain('\\');
                expect(password).not.toContain(';');

                // Should not contain shell-problematic characters
                expect(password).not.toContain('$');
                expect(password).not.toContain('`');
                expect(password).not.toContain('!');
            }
        });

        it('should generate unique passwords', () => {
            const passwords = new Set();

            for (let i = 0; i < 100; i++) {
                passwords.add(generatePassword());
            }

            // All passwords should be unique
            expect(passwords.size).toBe(100);
        });

        it('should be cryptographically random (entropy test)', () => {
            const password = generatePassword(64);

            // Count character occurrences
            const charCounts = {};
            for (const char of password) {
                charCounts[char] = (charCounts[char] || 0) + 1;
            }

            // No single character should appear more than 10 times in 64 chars
            // (statistically extremely unlikely with good randomness)
            for (const [char, count] of Object.entries(charCounts)) {
                expect(count).toBeLessThanOrEqual(10);
            }
        });
    });

    describe('escapeSqlString', () => {
        it('should escape single quotes by doubling them', () => {
            expect(escapeSqlString("test'value")).toBe("test''value");
        });

        it('should escape multiple single quotes', () => {
            expect(escapeSqlString("it's a test's value")).toBe("it''s a test''s value");
        });

        it('should escape backslashes', () => {
            expect(escapeSqlString("test\\value")).toBe("test\\\\value");
        });

        it('should escape both single quotes and backslashes', () => {
            expect(escapeSqlString("test\\'value")).toBe("test\\\\''value");
        });

        it('should return unchanged string without special characters', () => {
            expect(escapeSqlString("normal string")).toBe("normal string");
        });

        it('should handle empty string', () => {
            expect(escapeSqlString("")).toBe("");
        });

        it('should throw error for non-string input', () => {
            expect(() => escapeSqlString(null)).toThrow('escapeSqlString requires a string argument');
            expect(() => escapeSqlString(undefined)).toThrow('escapeSqlString requires a string argument');
            expect(() => escapeSqlString(123)).toThrow('escapeSqlString requires a string argument');
            expect(() => escapeSqlString({})).toThrow('escapeSqlString requires a string argument');
        });

        it('should handle SQL injection attempt', () => {
            const malicious = "'; DROP TABLE users; --";
            const escaped = escapeSqlString(malicious);

            expect(escaped).toBe("''; DROP TABLE users; --");
            // The escaped string when used in 'value' will be: ''''; DROP TABLE users; --'
            // which is safe because the quotes are escaped
        });
    });

    describe('escapeShellArg', () => {
        it('should escape dollar signs', () => {
            expect(escapeShellArg("$HOME")).toBe("\\$HOME");
        });

        it('should escape backticks', () => {
            expect(escapeShellArg("`whoami`")).toBe("\\`whoami\\`");
        });

        it('should escape backslashes', () => {
            expect(escapeShellArg("test\\value")).toBe("test\\\\value");
        });

        it('should escape double quotes', () => {
            expect(escapeShellArg('test"value')).toBe('test\\"value');
        });

        it('should escape exclamation marks (history expansion)', () => {
            expect(escapeShellArg("test!value")).toBe("test\\!value");
        });

        it('should escape multiple special characters', () => {
            expect(escapeShellArg('$`"!\\')).toBe('\\$\\`\\"\\!\\\\');
        });

        it('should return unchanged string without special characters', () => {
            expect(escapeShellArg("normalstring123")).toBe("normalstring123");
        });

        it('should handle empty string', () => {
            expect(escapeShellArg("")).toBe("");
        });

        it('should throw error for non-string input', () => {
            expect(() => escapeShellArg(null)).toThrow('escapeShellArg requires a string argument');
            expect(() => escapeShellArg(undefined)).toThrow('escapeShellArg requires a string argument');
            expect(() => escapeShellArg(123)).toThrow('escapeShellArg requires a string argument');
        });

        it('should handle command injection attempt', () => {
            const malicious = '$(rm -rf /)';
            const escaped = escapeShellArg(malicious);

            expect(escaped).toBe('\\$(rm -rf /)');
            // The escaped string when used in "value" will be: "\$(rm -rf /)"
            // which is safe because $() command substitution is escaped
        });

        it('should handle backtick command injection', () => {
            const malicious = '`cat /etc/passwd`';
            const escaped = escapeShellArg(malicious);

            expect(escaped).toBe('\\`cat /etc/passwd\\`');
        });
    });

    describe('Integration: Password safe for SQL and shell', () => {
        it('should generate passwords that need no escaping', () => {
            for (let i = 0; i < 50; i++) {
                const password = generatePassword();

                // Password should be identical after escaping
                expect(escapeSqlString(password)).toBe(password);
                expect(escapeShellArg(password)).toBe(password);
            }
        });
    });
});
