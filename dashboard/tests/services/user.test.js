const bcrypt = require('bcrypt');

// Mock database pool
const mockPool = {
    query: jest.fn(),
    execute: jest.fn()
};

// Mock the database module
jest.mock('../../src/config/database', () => ({
    pool: mockPool
}));

const userService = require('../../src/services/user');

describe('UserService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('verifyPassword', () => {
        it('should return true for correct password', async () => {
            const password = 'testpassword123';
            const hash = await bcrypt.hash(password, 10);
            const user = { password_hash: hash };

            const result = await userService.verifyPassword(user, password);

            expect(result).toBe(true);
        });

        it('should return false for incorrect password', async () => {
            const hash = await bcrypt.hash('correctpassword', 10);
            const user = { password_hash: hash };

            const result = await userService.verifyPassword(user, 'wrongpassword');

            expect(result).toBe(false);
        });
    });

    describe('createUser', () => {
        it('should create a user with hashed password', async () => {
            mockPool.query.mockResolvedValue([{ insertId: 1 }]);

            const result = await userService.createUser(
                'testuser',
                'testpassword',
                'testuser',
                false,
                false
            );

            expect(result).toEqual({
                id: 1,
                username: 'testuser',
                system_username: 'testuser',
                is_admin: false,
                approved: false
            });

            // Verify password was hashed
            const call = mockPool.query.mock.calls[0];
            expect(call[0]).toContain('INSERT INTO dashboard_users');
            expect(call[1][0]).toBe('testuser'); // username
            expect(call[1][1]).not.toBe('testpassword'); // password should be hashed
            expect(call[1][1]).toMatch(/^\$2[ab]\$\d+\$/); // bcrypt hash format
        });

        it('should create an admin user when isAdmin is true', async () => {
            mockPool.query.mockResolvedValue([{ insertId: 2 }]);

            const result = await userService.createUser(
                'admin',
                'adminpass',
                'admin',
                true,
                true
            );

            expect(result.is_admin).toBe(true);
            expect(result.approved).toBe(true);
        });
    });

    describe('getUserByUsername', () => {
        it('should return user when found', async () => {
            const mockUser = {
                id: 1,
                username: 'testuser',
                password_hash: 'hash',
                system_username: 'testuser',
                is_admin: false,
                approved: true
            };
            mockPool.query.mockResolvedValue([[mockUser]]);

            const result = await userService.getUserByUsername('testuser');

            expect(result).toEqual(mockUser);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE username = ?'),
                ['testuser']
            );
        });

        it('should return null when user not found', async () => {
            mockPool.query.mockResolvedValue([[]]);

            const result = await userService.getUserByUsername('nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('existsUsernameOrSystemUsername', () => {
        it('should return true when username exists', async () => {
            mockPool.query.mockResolvedValue([[{ id: 1 }]]);

            const result = await userService.existsUsernameOrSystemUsername('existing', 'system');

            expect(result).toBe(true);
        });

        it('should return false when neither exists', async () => {
            mockPool.query.mockResolvedValue([[]]);

            const result = await userService.existsUsernameOrSystemUsername('new', 'newsystem');

            expect(result).toBe(false);
        });

        it('should exclude given id when checking', async () => {
            mockPool.query.mockResolvedValue([[]]);

            await userService.existsUsernameOrSystemUsername('user', 'system', 5);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('AND id != ?'),
                ['user', 'system', 5]
            );
        });
    });

    describe('getUserCount', () => {
        it('should return the total user count', async () => {
            mockPool.query.mockResolvedValue([[{ count: 42 }]]);

            const result = await userService.getUserCount();

            expect(result).toBe(42);
        });
    });

    describe('getAdminCount', () => {
        it('should return the admin count', async () => {
            mockPool.query.mockResolvedValue([[{ count: 3 }]]);

            const result = await userService.getAdminCount();

            expect(result).toBe(3);
        });
    });

    describe('isLastAdmin', () => {
        it('should return true if user is the only admin', async () => {
            mockPool.query
                .mockResolvedValueOnce([[{ id: 1, is_admin: true }]]) // getUserById
                .mockResolvedValueOnce([[{ count: 1 }]]); // getAdminCount

            const result = await userService.isLastAdmin(1);

            expect(result).toBe(true);
        });

        it('should return false if there are other admins', async () => {
            mockPool.query
                .mockResolvedValueOnce([[{ id: 1, is_admin: true }]])
                .mockResolvedValueOnce([[{ count: 3 }]]);

            const result = await userService.isLastAdmin(1);

            expect(result).toBe(false);
        });

        it('should return false if user is not an admin', async () => {
            mockPool.query.mockResolvedValueOnce([[{ id: 1, is_admin: false }]]);

            const result = await userService.isLastAdmin(1);

            expect(result).toBe(false);
        });
    });

    describe('approveUser', () => {
        it('should approve user and return updated user', async () => {
            const approvedUser = { id: 1, approved: true };
            mockPool.query
                .mockResolvedValueOnce([{}]) // UPDATE
                .mockResolvedValueOnce([[approvedUser]]); // getUserById

            const result = await userService.approveUser(1);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('approved = TRUE'),
                [1]
            );
            expect(result).toEqual(approvedUser);
        });
    });

    describe('rejectUser', () => {
        it('should delete unapproved user', async () => {
            mockPool.query
                .mockResolvedValueOnce([[{ id: 1, approved: false }]]) // getUserById
                .mockResolvedValueOnce([{}]); // DELETE

            await userService.rejectUser(1);

            expect(mockPool.query).toHaveBeenLastCalledWith(
                expect.stringContaining('DELETE FROM dashboard_users'),
                [1]
            );
        });

        it('should throw error if user is already approved', async () => {
            mockPool.query.mockResolvedValueOnce([[{ id: 1, approved: true }]]);

            await expect(userService.rejectUser(1)).rejects.toThrow(
                'Already approved users cannot be rejected'
            );
        });

        it('should throw error if user not found', async () => {
            mockPool.query.mockResolvedValueOnce([[]]);

            await expect(userService.rejectUser(999)).rejects.toThrow('User not found');
        });
    });
});
