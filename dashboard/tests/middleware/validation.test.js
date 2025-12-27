const { validate, schemas } = require('../../src/middleware/validation');

describe('Validation Middleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        mockReq = {
            body: {},
            xhr: false,
            headers: {},
            flash: jest.fn()
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn()
        };
        mockNext = jest.fn();
    });

    describe('validate function', () => {
        it('should call next with valid data', () => {
            mockReq.body = {
                username: 'testuser',
                password: 'password123'
            };

            const middleware = validate('login');
            middleware(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.validatedBody).toEqual({
                username: 'testuser',
                password: 'password123'
            });
        });

        it('should redirect with flash message on validation error', () => {
            mockReq.body = {
                username: '',
                password: ''
            };

            const middleware = validate('login');
            middleware(mockReq, mockRes, mockNext);

            expect(mockNext).not.toHaveBeenCalled();
            expect(mockReq.flash).toHaveBeenCalledWith('error', expect.any(String));
            expect(mockRes.redirect).toHaveBeenCalledWith('back');
        });

        it('should return JSON for AJAX requests', () => {
            mockReq.xhr = true;
            mockReq.body = {
                username: '',
                password: ''
            };

            const middleware = validate('login');
            middleware(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: false,
                errors: expect.any(Array)
            });
        });

        it('should handle non-existent schema gracefully', () => {
            const middleware = validate('nonexistent');
            middleware(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });
    });

    describe('Register Schema', () => {
        it('should validate correct registration data', () => {
            const data = {
                username: 'newuser',
                password: 'password123',
                password_confirm: 'password123'
            };

            const { error } = schemas.register.validate(data);
            expect(error).toBeUndefined();
        });

        it('should reject username with invalid characters', () => {
            const data = {
                username: 'User@Name!',
                password: 'password123',
                password_confirm: 'password123'
            };

            const { error } = schemas.register.validate(data);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('lowercase');
        });

        it('should reject username that is too short', () => {
            const data = {
                username: 'ab',
                password: 'password123',
                password_confirm: 'password123'
            };

            const { error } = schemas.register.validate(data);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('3 characters');
        });

        it('should reject password that is too short', () => {
            const data = {
                username: 'validuser',
                password: 'short',
                password_confirm: 'short'
            };

            const { error } = schemas.register.validate(data);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('8 characters');
        });

        it('should reject mismatched passwords', () => {
            const data = {
                username: 'validuser',
                password: 'password123',
                password_confirm: 'different123'
            };

            const { error } = schemas.register.validate(data);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('do not match');
        });
    });

    describe('Create Project Schema', () => {
        it('should validate correct project data', () => {
            const data = {
                name: 'my-project',
                type: 'nodejs-app'
            };

            const { error } = schemas.createProject.validate(data);
            expect(error).toBeUndefined();
        });

        it('should reject project name with uppercase', () => {
            const data = {
                name: 'MyProject',
                type: 'nodejs-app'
            };

            const { error } = schemas.createProject.validate(data);
            expect(error).toBeDefined();
        });

        it('should reject invalid project type', () => {
            const data = {
                name: 'my-project',
                type: 'invalid-type'
            };

            const { error } = schemas.createProject.validate(data);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('Invalid project type');
        });
    });

    describe('Create Project from Git Schema', () => {
        it('should validate correct git project data', () => {
            const data = {
                name: 'my-git-project',
                repo_url: 'https://github.com/user/repo',
                access_token: ''
            };

            const { error } = schemas.createProjectFromGit.validate(data);
            expect(error).toBeUndefined();
        });

        it('should reject non-https URLs', () => {
            const data = {
                name: 'my-project',
                repo_url: 'http://github.com/user/repo'
            };

            const { error } = schemas.createProjectFromGit.validate(data);
            expect(error).toBeDefined();
        });

        it('should reject unsupported git providers', () => {
            const data = {
                name: 'my-project',
                repo_url: 'https://mygitserver.com/user/repo'
            };

            const { error } = schemas.createProjectFromGit.validate(data);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('GitHub, GitLab and Bitbucket');
        });
    });

    describe('Create Database Schema', () => {
        it('should validate correct database data', () => {
            const data = {
                name: 'my_database',
                type: 'mariadb'
            };

            const { error } = schemas.createDatabase.validate(data);
            expect(error).toBeUndefined();
        });

        it('should reject database name with hyphens', () => {
            const data = {
                name: 'my-database',
                type: 'mariadb'
            };

            const { error } = schemas.createDatabase.validate(data);
            expect(error).toBeDefined();
        });

        it('should reject invalid database type', () => {
            const data = {
                name: 'mydb',
                type: 'mongodb'
            };

            const { error } = schemas.createDatabase.validate(data);
            expect(error).toBeDefined();
        });
    });

    describe('Create Share Schema', () => {
        it('should validate correct share data', () => {
            const data = {
                username: 'otheruser',
                permission: 'read'
            };

            const { error } = schemas.createShare.validate(data);
            expect(error).toBeUndefined();
        });

        it('should accept all valid permission levels', () => {
            for (const permission of ['read', 'manage', 'full']) {
                const data = { username: 'user', permission };
                const { error } = schemas.createShare.validate(data);
                expect(error).toBeUndefined();
            }
        });

        it('should reject invalid permission level', () => {
            const data = {
                username: 'user',
                permission: 'admin'
            };

            const { error } = schemas.createShare.validate(data);
            expect(error).toBeDefined();
        });
    });
});
