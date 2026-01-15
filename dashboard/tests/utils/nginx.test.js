/**
 * Tests for nginx.js utilities
 * Tests nginx configuration generation
 */
const { generateNginxConfig } = require('../../src/services/utils/nginx');

describe('Nginx Utilities', () => {
    describe('generateNginxConfig', () => {
        let config;

        beforeAll(() => {
            config = generateNginxConfig();
        });

        it('should return a string', () => {
            expect(typeof config).toBe('string');
        });

        it('should contain server block', () => {
            expect(config).toContain('server {');
            expect(config).toContain('}');
        });

        it('should listen on port 80', () => {
            expect(config).toContain('listen 80;');
        });

        it('should set wildcard server name', () => {
            expect(config).toContain('server_name _;');
        });

        it('should set correct document root', () => {
            expect(config).toContain('root /usr/share/nginx/html;');
        });

        it('should set index files', () => {
            expect(config).toContain('index index.html index.htm;');
        });

        describe('gzip compression', () => {
            it('should enable gzip', () => {
                expect(config).toContain('gzip on;');
            });

            it('should enable gzip_vary', () => {
                expect(config).toContain('gzip_vary on;');
            });

            it('should set minimum gzip length', () => {
                expect(config).toContain('gzip_min_length 1024;');
            });

            it('should define gzip types', () => {
                expect(config).toContain('gzip_types');
                expect(config).toContain('text/plain');
                expect(config).toContain('text/css');
                expect(config).toContain('application/json');
            });
        });

        describe('security headers', () => {
            it('should set X-Frame-Options', () => {
                expect(config).toContain('add_header X-Frame-Options "SAMEORIGIN" always;');
            });

            it('should set X-Content-Type-Options', () => {
                expect(config).toContain('add_header X-Content-Type-Options "nosniff" always;');
            });

            it('should set X-XSS-Protection', () => {
                expect(config).toContain('add_header X-XSS-Protection "1; mode=block" always;');
            });
        });

        describe('location blocks', () => {
            it('should have root location with try_files', () => {
                expect(config).toContain('location / {');
                expect(config).toContain('try_files $uri $uri/ =404;');
            });

            it('should have static assets location with caching', () => {
                expect(config).toContain('location ~*');
                expect(config).toContain('jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot');
                expect(config).toContain('expires 1y;');
                expect(config).toContain('Cache-Control "public, immutable"');
            });
        });

        describe('error pages', () => {
            it('should configure 404 error page', () => {
                expect(config).toContain('error_page 404 /404.html;');
            });

            it('should configure 5xx error pages', () => {
                expect(config).toContain('error_page 500 502 503 504 /50x.html;');
            });
        });

        describe('config structure validity', () => {
            it('should have balanced braces', () => {
                const openBraces = (config.match(/{/g) || []).length;
                const closeBraces = (config.match(/}/g) || []).length;

                expect(openBraces).toBe(closeBraces);
            });

            it('should have all directives end with semicolon', () => {
                // Split by lines and check non-block lines end with ; or {
                const lines = config.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                for (const line of lines) {
                    // Skip lines that are just braces or block starts
                    if (line === '{' || line === '}' || line.endsWith('{')) {
                        continue;
                    }
                    // All other lines should end with semicolon
                    expect(line.endsWith(';')).toBe(true);
                }
            });
        });

        it('should generate consistent output', () => {
            const config1 = generateNginxConfig();
            const config2 = generateNginxConfig();

            expect(config1).toBe(config2);
        });
    });
});
