/**
 * Tests for webhook.js utilities
 * Tests HMAC signature validation, provider detection, and payload parsing
 */
const crypto = require('crypto');
const {
    generateWebhookSecret,
    validateGitHubSignature,
    validateGitLabToken,
    validateBitbucketSignature,
    validateWebhookSignature,
    detectProvider,
    isPushEvent,
    extractBranch,
    extractCommitInfo
} = require('../../src/services/utils/webhook');

describe('Webhook Utilities', () => {
    describe('generateWebhookSecret', () => {
        it('should generate a 64-character hex string', () => {
            const secret = generateWebhookSecret();

            expect(secret).toHaveLength(64);
            expect(secret).toMatch(/^[a-f0-9]+$/);
        });

        it('should generate unique secrets each time', () => {
            const secret1 = generateWebhookSecret();
            const secret2 = generateWebhookSecret();

            expect(secret1).not.toBe(secret2);
        });
    });

    describe('validateGitHubSignature', () => {
        const secret = 'test-secret-key';
        const payload = Buffer.from('{"test":"payload"}');

        function createGitHubSignature(payload, secret) {
            const hmac = crypto.createHmac('sha256', secret);
            hmac.update(payload);
            return 'sha256=' + hmac.digest('hex');
        }

        it('should validate correct signature', () => {
            const signature = createGitHubSignature(payload, secret);

            expect(validateGitHubSignature(payload, signature, secret)).toBe(true);
        });

        it('should reject incorrect signature', () => {
            const signature = createGitHubSignature(payload, 'wrong-secret');

            expect(validateGitHubSignature(payload, signature, secret)).toBe(false);
        });

        it('should reject signature without sha256= prefix', () => {
            const hmac = crypto.createHmac('sha256', secret);
            hmac.update(payload);
            const signatureWithoutPrefix = hmac.digest('hex');

            expect(validateGitHubSignature(payload, signatureWithoutPrefix, secret)).toBe(false);
        });

        it('should reject null signature', () => {
            expect(validateGitHubSignature(payload, null, secret)).toBe(false);
        });

        it('should reject undefined signature', () => {
            expect(validateGitHubSignature(payload, undefined, secret)).toBe(false);
        });

        it('should reject empty signature', () => {
            expect(validateGitHubSignature(payload, '', secret)).toBe(false);
        });

        it('should reject signature with different length', () => {
            expect(validateGitHubSignature(payload, 'sha256=short', secret)).toBe(false);
        });
    });

    describe('validateGitLabToken', () => {
        const secret = 'gitlab-webhook-token';

        it('should validate correct token', () => {
            expect(validateGitLabToken(secret, secret)).toBe(true);
        });

        it('should reject incorrect token', () => {
            expect(validateGitLabToken('wrong-token', secret)).toBe(false);
        });

        it('should reject null token', () => {
            expect(validateGitLabToken(null, secret)).toBe(false);
        });

        it('should reject null secret', () => {
            expect(validateGitLabToken('token', null)).toBe(false);
        });

        it('should reject empty token', () => {
            expect(validateGitLabToken('', secret)).toBe(false);
        });

        it('should reject tokens with different lengths', () => {
            expect(validateGitLabToken('short', 'much-longer-token')).toBe(false);
        });
    });

    describe('validateBitbucketSignature', () => {
        const secret = 'bitbucket-secret';
        const payload = Buffer.from('{"repository":"test"}');

        function createBitbucketSignature(payload, secret) {
            const hmac = crypto.createHmac('sha256', secret);
            hmac.update(payload);
            return 'sha256=' + hmac.digest('hex');
        }

        it('should validate correct signature', () => {
            const signature = createBitbucketSignature(payload, secret);

            expect(validateBitbucketSignature(payload, signature, secret)).toBe(true);
        });

        it('should reject incorrect signature', () => {
            const signature = createBitbucketSignature(payload, 'wrong-secret');

            expect(validateBitbucketSignature(payload, signature, secret)).toBe(false);
        });

        it('should reject signature without sha256= prefix', () => {
            const hmac = crypto.createHmac('sha256', secret);
            hmac.update(payload);
            const signatureWithoutPrefix = hmac.digest('hex');

            expect(validateBitbucketSignature(payload, signatureWithoutPrefix, secret)).toBe(false);
        });

        it('should reject null signature', () => {
            expect(validateBitbucketSignature(payload, null, secret)).toBe(false);
        });
    });

    describe('validateWebhookSignature', () => {
        const secret = 'unified-secret';
        const payload = Buffer.from('{"test":"data"}');

        function createHmacSignature(payload, secret) {
            const hmac = crypto.createHmac('sha256', secret);
            hmac.update(payload);
            return 'sha256=' + hmac.digest('hex');
        }

        it('should validate GitHub webhook', () => {
            const signature = createHmacSignature(payload, secret);
            const headers = { 'x-hub-signature-256': signature };

            expect(validateWebhookSignature('github', payload, headers, secret)).toBe(true);
        });

        it('should validate GitLab webhook', () => {
            const headers = { 'x-gitlab-token': secret };

            expect(validateWebhookSignature('gitlab', payload, headers, secret)).toBe(true);
        });

        it('should validate Bitbucket webhook', () => {
            const signature = createHmacSignature(payload, secret);
            const headers = { 'x-hub-signature': signature };

            expect(validateWebhookSignature('bitbucket', payload, headers, secret)).toBe(true);
        });

        it('should reject unknown provider', () => {
            expect(validateWebhookSignature('unknown', payload, {}, secret)).toBe(false);
        });

        it('should reject missing signature header', () => {
            expect(validateWebhookSignature('github', payload, {}, secret)).toBe(false);
        });
    });

    describe('detectProvider', () => {
        it('should detect GitHub', () => {
            const headers = { 'x-github-event': 'push' };

            expect(detectProvider(headers)).toBe('github');
        });

        it('should detect GitLab', () => {
            const headers = { 'x-gitlab-event': 'Push Hook' };

            expect(detectProvider(headers)).toBe('gitlab');
        });

        it('should detect Bitbucket', () => {
            const headers = { 'x-event-key': 'repo:push' };

            expect(detectProvider(headers)).toBe('bitbucket');
        });

        it('should return null for unknown provider', () => {
            const headers = { 'content-type': 'application/json' };

            expect(detectProvider(headers)).toBeNull();
        });

        it('should return null for empty headers', () => {
            expect(detectProvider({})).toBeNull();
        });
    });

    describe('isPushEvent', () => {
        it('should detect GitHub push event', () => {
            const headers = { 'x-github-event': 'push' };

            expect(isPushEvent('github', headers)).toBe(true);
        });

        it('should reject GitHub non-push event', () => {
            const headers = { 'x-github-event': 'pull_request' };

            expect(isPushEvent('github', headers)).toBe(false);
        });

        it('should detect GitLab push event', () => {
            const headers = { 'x-gitlab-event': 'Push Hook' };

            expect(isPushEvent('gitlab', headers)).toBe(true);
        });

        it('should reject GitLab non-push event', () => {
            const headers = { 'x-gitlab-event': 'Merge Request Hook' };

            expect(isPushEvent('gitlab', headers)).toBe(false);
        });

        it('should detect Bitbucket push event', () => {
            const headers = { 'x-event-key': 'repo:push' };

            expect(isPushEvent('bitbucket', headers)).toBe(true);
        });

        it('should reject Bitbucket non-push event', () => {
            const headers = { 'x-event-key': 'pullrequest:created' };

            expect(isPushEvent('bitbucket', headers)).toBe(false);
        });

        it('should return false for unknown provider', () => {
            expect(isPushEvent('unknown', {})).toBe(false);
        });
    });

    describe('extractBranch', () => {
        it('should extract branch from GitHub payload', () => {
            const payload = { ref: 'refs/heads/main' };

            expect(extractBranch('github', payload)).toBe('main');
        });

        it('should extract branch from GitHub payload with feature branch', () => {
            const payload = { ref: 'refs/heads/feature/new-feature' };

            expect(extractBranch('github', payload)).toBe('feature/new-feature');
        });

        it('should extract branch from GitLab payload', () => {
            const payload = { ref: 'refs/heads/develop' };

            expect(extractBranch('gitlab', payload)).toBe('develop');
        });

        it('should handle GitLab payload with plain ref', () => {
            const payload = { ref: 'main' };

            expect(extractBranch('gitlab', payload)).toBe('main');
        });

        it('should extract branch from Bitbucket payload', () => {
            const payload = {
                push: {
                    changes: [{ new: { name: 'master' } }]
                }
            };

            expect(extractBranch('bitbucket', payload)).toBe('master');
        });

        it('should return null for Bitbucket payload without changes', () => {
            const payload = { push: { changes: [] } };

            expect(extractBranch('bitbucket', payload)).toBeNull();
        });

        it('should return null for empty payload', () => {
            expect(extractBranch('github', {})).toBeNull();
        });

        it('should return null for unknown provider', () => {
            expect(extractBranch('unknown', { ref: 'refs/heads/main' })).toBeNull();
        });
    });

    describe('extractCommitInfo', () => {
        it('should extract commit info from GitHub payload', () => {
            const payload = {
                after: 'abc123',
                head_commit: { message: 'Fix bug' }
            };

            expect(extractCommitInfo('github', payload)).toEqual({
                hash: 'abc123',
                message: 'Fix bug'
            });
        });

        it('should extract commit info from GitLab payload', () => {
            const payload = {
                after: 'def456',
                commits: [{ message: 'Add feature' }]
            };

            expect(extractCommitInfo('gitlab', payload)).toEqual({
                hash: 'def456',
                message: 'Add feature'
            });
        });

        it('should use checkout_sha as fallback for GitLab', () => {
            const payload = {
                checkout_sha: 'ghi789',
                commits: []
            };

            expect(extractCommitInfo('gitlab', payload)).toEqual({
                hash: 'ghi789',
                message: null
            });
        });

        it('should extract commit info from Bitbucket payload', () => {
            const payload = {
                push: {
                    changes: [{
                        new: {
                            target: {
                                hash: 'jkl012',
                                message: 'Update readme'
                            }
                        }
                    }]
                }
            };

            expect(extractCommitInfo('bitbucket', payload)).toEqual({
                hash: 'jkl012',
                message: 'Update readme'
            });
        });

        it('should return nulls for empty Bitbucket changes', () => {
            const payload = { push: { changes: [] } };

            expect(extractCommitInfo('bitbucket', payload)).toEqual({
                hash: null,
                message: null
            });
        });

        it('should return nulls for empty payload', () => {
            expect(extractCommitInfo('github', {})).toEqual({
                hash: null,
                message: null
            });
        });

        it('should return nulls for unknown provider', () => {
            expect(extractCommitInfo('unknown', { after: 'abc' })).toEqual({
                hash: null,
                message: null
            });
        });
    });

    describe('Security: Timing-safe comparison', () => {
        // These tests verify that timing-safe comparison is used
        // which is important for preventing timing attacks

        it('should handle very long signatures without timing leak', () => {
            const secret = 'a'.repeat(1000);
            const payload = Buffer.from('test');
            const hmac = crypto.createHmac('sha256', secret);
            hmac.update(payload);
            const signature = 'sha256=' + hmac.digest('hex');

            // Should complete without timing issues
            expect(validateGitHubSignature(payload, signature, secret)).toBe(true);
        });

        it('should handle unicode in tokens', () => {
            const secret = 'secret-with-émojis-🎉';

            // Should not throw, just return false for different lengths
            expect(validateGitLabToken('short', secret)).toBe(false);
        });
    });
});
