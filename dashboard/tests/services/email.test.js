// Store original env
const originalEnv = process.env;

// Mock nodemailer
const mockSendMail = jest.fn();
const mockVerify = jest.fn();
const mockCreateTransport = jest.fn(() => ({
    sendMail: mockSendMail,
    verify: mockVerify
}));

jest.mock('nodemailer', () => ({
    createTransport: mockCreateTransport
}));

// Mock fs.promises
const mockReadFile = jest.fn();
jest.mock('fs', () => ({
    promises: {
        readFile: mockReadFile
    }
}));

// Mock ejs
const mockEjsRender = jest.fn();
jest.mock('ejs', () => ({
    render: mockEjsRender
}));

const emailService = require('../../src/services/email');

describe('Email Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        emailService.resetTransporter();
        // Reset env
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('isEnabled', () => {
        it('should return true when EMAIL_ENABLED is "true"', () => {
            process.env.EMAIL_ENABLED = 'true';
            expect(emailService.isEnabled()).toBe(true);
        });

        it('should return false when EMAIL_ENABLED is not "true"', () => {
            process.env.EMAIL_ENABLED = 'false';
            expect(emailService.isEnabled()).toBe(false);
        });

        it('should return false when EMAIL_ENABLED is undefined', () => {
            delete process.env.EMAIL_ENABLED;
            expect(emailService.isEnabled()).toBe(false);
        });
    });

    describe('getBaseUrl', () => {
        it('should use dashboard domain with https when available', () => {
            process.env.NPM_DASHBOARD_DOMAIN = 'app.example.com';
            expect(emailService.getBaseUrl()).toBe('https://app.example.com');
        });

        it('should use SERVER_IP and port when no dashboard domain', () => {
            delete process.env.NPM_DASHBOARD_DOMAIN;
            process.env.SERVER_IP = '192.168.1.100';
            process.env.DASHBOARD_PORT = '3000';
            expect(emailService.getBaseUrl()).toBe('http://192.168.1.100:3000');
        });

        it('should default to localhost:3000', () => {
            delete process.env.NPM_DASHBOARD_DOMAIN;
            delete process.env.SERVER_IP;
            delete process.env.DASHBOARD_PORT;
            expect(emailService.getBaseUrl()).toBe('http://localhost:3000');
        });
    });

    describe('sendEmail', () => {
        it('should return disabled when email not enabled', async () => {
            process.env.EMAIL_ENABLED = 'false';

            const result = await emailService.sendEmail('test@example.com', 'Subject', '<p>Hello</p>');

            expect(result).toEqual({ success: false, reason: 'disabled' });
            expect(mockSendMail).not.toHaveBeenCalled();
        });

        it('should send email when enabled', async () => {
            process.env.EMAIL_ENABLED = 'true';
            process.env.EMAIL_HOST = 'smtp.example.com';
            process.env.EMAIL_FROM = 'Dployr <noreply@example.com>';
            mockSendMail.mockResolvedValue({ messageId: 'msg-123' });

            const result = await emailService.sendEmail('test@example.com', 'Test Subject', '<p>Hello</p>');

            expect(result).toEqual({ success: true, messageId: 'msg-123' });
            expect(mockSendMail).toHaveBeenCalledWith({
                from: 'Dployr <noreply@example.com>',
                to: 'test@example.com',
                subject: 'Test Subject',
                html: '<p>Hello</p>',
                text: expect.any(String)
            });
        });

        it('should auto-generate text from html', async () => {
            process.env.EMAIL_ENABLED = 'true';
            mockSendMail.mockResolvedValue({ messageId: 'msg-123' });

            await emailService.sendEmail('test@example.com', 'Test', '<p>Hello World</p>');

            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    text: 'Hello World'
                })
            );
        });

        it('should return error when send fails', async () => {
            process.env.EMAIL_ENABLED = 'true';
            mockSendMail.mockRejectedValue(new Error('SMTP connection failed'));

            const result = await emailService.sendEmail('test@example.com', 'Test', '<p>Hello</p>');

            expect(result).toEqual({ success: false, error: 'SMTP connection failed' });
        });
    });

    describe('testConnection', () => {
        it('should return disabled error when not enabled', async () => {
            process.env.EMAIL_ENABLED = 'false';

            const result = await emailService.testConnection();

            expect(result).toEqual({ success: false, error: 'Email is not enabled' });
        });

        it('should return success when verification passes', async () => {
            process.env.EMAIL_ENABLED = 'true';
            mockVerify.mockResolvedValue(true);

            const result = await emailService.testConnection();

            expect(result).toEqual({ success: true });
            expect(mockVerify).toHaveBeenCalled();
        });

        it('should return error when verification fails', async () => {
            process.env.EMAIL_ENABLED = 'true';
            mockVerify.mockRejectedValue(new Error('Invalid credentials'));

            const result = await emailService.testConnection();

            expect(result).toEqual({ success: false, error: 'Invalid credentials' });
        });
    });

    describe('sendVerificationEmail', () => {
        it('should send verification email with correct data', async () => {
            process.env.EMAIL_ENABLED = 'true';
            process.env.SERVER_IP = 'localhost';
            process.env.EMAIL_VERIFICATION_EXPIRES = '24';
            mockReadFile.mockResolvedValue('<p>Template</p>');
            mockEjsRender.mockReturnValue('<p>Rendered</p>');
            mockSendMail.mockResolvedValue({ messageId: 'msg-123' });

            await emailService.sendVerificationEmail('test@example.com', 'testuser', 'abc123', 'de');

            expect(mockEjsRender).toHaveBeenCalledWith('<p>Template</p>', {
                username: 'testuser',
                verificationUrl: expect.stringContaining('/verify-email?token=abc123'),
                expiresIn: 24
            });
            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Dployr - E-Mail-Adresse bestätigen'
                })
            );
        });

        it('should use English subject when language is en', async () => {
            process.env.EMAIL_ENABLED = 'true';
            mockReadFile.mockResolvedValue('<p>Template</p>');
            mockEjsRender.mockReturnValue('<p>Rendered</p>');
            mockSendMail.mockResolvedValue({ messageId: 'msg-123' });

            await emailService.sendVerificationEmail('test@example.com', 'testuser', 'abc123', 'en');

            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Dployr - Verify your email address'
                })
            );
        });
    });

    describe('sendPasswordResetEmail', () => {
        it('should send password reset email with correct data', async () => {
            process.env.EMAIL_ENABLED = 'true';
            process.env.EMAIL_RESET_EXPIRES = '1';
            mockReadFile.mockResolvedValue('<p>Template</p>');
            mockEjsRender.mockReturnValue('<p>Rendered</p>');
            mockSendMail.mockResolvedValue({ messageId: 'msg-123' });

            await emailService.sendPasswordResetEmail('test@example.com', 'testuser', 'reset123', 'de');

            expect(mockEjsRender).toHaveBeenCalledWith('<p>Template</p>', {
                username: 'testuser',
                resetUrl: expect.stringContaining('/reset-password?token=reset123'),
                expiresIn: 1
            });
        });
    });

    describe('sendApprovalEmail', () => {
        it('should send approval email with login URL', async () => {
            process.env.EMAIL_ENABLED = 'true';
            mockReadFile.mockResolvedValue('<p>Template</p>');
            mockEjsRender.mockReturnValue('<p>Rendered</p>');
            mockSendMail.mockResolvedValue({ messageId: 'msg-123' });

            await emailService.sendApprovalEmail('test@example.com', 'testuser', 'de');

            expect(mockEjsRender).toHaveBeenCalledWith('<p>Template</p>', {
                username: 'testuser',
                loginUrl: expect.stringContaining('/login')
            });
            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Dployr - Dein Konto wurde freigeschaltet'
                })
            );
        });
    });

    describe('sendDeploymentSuccessEmail', () => {
        it('should send deployment success email with all data', async () => {
            process.env.EMAIL_ENABLED = 'true';
            mockReadFile.mockResolvedValue('<p>Template</p>');
            mockEjsRender.mockReturnValue('<p>Rendered</p>');
            mockSendMail.mockResolvedValue({ messageId: 'msg-123' });

            await emailService.sendDeploymentSuccessEmail('test@example.com', {
                username: 'testuser',
                projectName: 'my-project',
                triggerType: 'auto',
                duration: '5s',
                newCommit: 'abc1234',
                commitMessage: 'Fix bug'
            }, 'de');

            expect(mockEjsRender).toHaveBeenCalledWith('<p>Template</p>', expect.objectContaining({
                username: 'testuser',
                projectName: 'my-project',
                triggerType: 'Automatisch',
                duration: '5s',
                newCommit: 'abc1234',
                commitMessage: 'Fix bug'
            }));
            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Dployr - Deployment erfolgreich: my-project'
                })
            );
        });
    });

    describe('sendDeploymentFailureEmail', () => {
        it('should send deployment failure email with error message', async () => {
            process.env.EMAIL_ENABLED = 'true';
            mockReadFile.mockResolvedValue('<p>Template</p>');
            mockEjsRender.mockReturnValue('<p>Rendered</p>');
            mockSendMail.mockResolvedValue({ messageId: 'msg-123' });

            await emailService.sendDeploymentFailureEmail('test@example.com', {
                username: 'testuser',
                projectName: 'my-project',
                triggerType: 'webhook',
                errorMessage: 'Git pull failed'
            }, 'en');

            expect(mockEjsRender).toHaveBeenCalledWith('<p>Template</p>', expect.objectContaining({
                username: 'testuser',
                projectName: 'my-project',
                triggerType: 'Webhook',
                errorMessage: 'Git pull failed'
            }));
            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Dployr - Deployment failed: my-project'
                })
            );
        });
    });

    describe('sendTestEmail', () => {
        it('should send test email in German', async () => {
            process.env.EMAIL_ENABLED = 'true';
            mockSendMail.mockResolvedValue({ messageId: 'msg-123' });

            await emailService.sendTestEmail('test@example.com', 'de');

            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Dployr - Test-E-Mail',
                    html: expect.stringContaining('Test-E-Mail')
                })
            );
        });

        it('should send test email in English', async () => {
            process.env.EMAIL_ENABLED = 'true';
            mockSendMail.mockResolvedValue({ messageId: 'msg-123' });

            await emailService.sendTestEmail('test@example.com', 'en');

            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Dployr - Test Email',
                    html: expect.stringContaining('Test Email')
                })
            );
        });
    });

    describe('resetTransporter', () => {
        it('should reset transporter to create new one', () => {
            process.env.EMAIL_ENABLED = 'true';

            // This test ensures resetTransporter can be called without error
            emailService.resetTransporter();
            expect(true).toBe(true);
        });
    });
});
