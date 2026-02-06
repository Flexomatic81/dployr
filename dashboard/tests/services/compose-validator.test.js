/**
 * Tests for compose-validator.js
 * Security-critical service that validates and transforms user-provided docker-compose files
 */

// Mock the logger to avoid file system operations during tests
jest.mock('../../src/config/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }
}));

const composeValidator = require('../../src/services/compose-validator');

describe('ComposeValidator', () => {
    describe('parseCompose', () => {
        it('should parse valid YAML', () => {
            const yaml = `
services:
  web:
    image: nginx
    ports:
      - "80:80"
`;
            const result = composeValidator.parseCompose(yaml);

            expect(result.success).toBe(true);
            expect(result.compose).toBeDefined();
            expect(result.compose.services.web.image).toBe('nginx');
        });

        it('should reject invalid YAML syntax', () => {
            const yaml = `
services:
  web:
    image: nginx
    ports:
      - 80:80
      invalid-indentation
`;
            const result = composeValidator.parseCompose(yaml);

            expect(result.success).toBe(false);
            expect(result.error).toContain('YAML parse error');
        });

        it('should reject non-object YAML', () => {
            const yaml = 'just a string';
            const result = composeValidator.parseCompose(yaml);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid YAML structure');
        });

        it('should reject null YAML', () => {
            const yaml = '';
            const result = composeValidator.parseCompose(yaml);

            expect(result.success).toBe(false);
        });
    });

    describe('validateCompose - Blocked Options', () => {
        it('should reject privileged containers', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        privileged: true
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": option "privileged" is not allowed for security reasons'
            );
        });

        it('should reject cap_add', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        cap_add: ['SYS_ADMIN']
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": option "cap_add" is not allowed for security reasons'
            );
        });

        it('should reject devices mount', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        devices: ['/dev/sda:/dev/sda']
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": option "devices" is not allowed for security reasons'
            );
        });

        it('should reject pid namespace sharing', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        pid: 'host'
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": option "pid" is not allowed for security reasons'
            );
        });

        it('should reject security_opt', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        security_opt: ['apparmor:unconfined']
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": option "security_opt" is not allowed for security reasons'
            );
        });

        it('should reject sysctls', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        sysctls: { 'net.ipv4.ip_forward': 1 }
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": option "sysctls" is not allowed for security reasons'
            );
        });

        it('should reject network_mode: host', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        network_mode: 'host'
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": network_mode "host" is not allowed'
            );
        });

        it('should reject network_mode: none', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        network_mode: 'none'
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": network_mode "none" is not allowed'
            );
        });

        it('should allow network_mode with service reference', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        network_mode: 'service:db'
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(true);
        });
    });

    describe('validateCompose - Blocked Volume Mounts', () => {
        it('should reject Docker socket mount', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        volumes: ['/var/run/docker.sock:/var/run/docker.sock']
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": volume mount to "/var/run/docker.sock" is not allowed'
            );
        });

        it('should reject /etc mount', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        volumes: ['/etc/passwd:/app/passwd']
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": volume mount to "/etc/passwd" is not allowed'
            );
        });

        it('should reject /root mount', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        volumes: ['/root/.ssh:/app/.ssh']
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": volume mount to "/root/.ssh" is not allowed'
            );
        });

        it('should reject /proc subpath mount', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        volumes: ['/proc/cpuinfo:/app/cpuinfo']
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": volume mount to "/proc/cpuinfo" is not allowed'
            );
        });

        it('should allow relative volume mounts', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        volumes: ['./data:/app/data', '.:/var/www/html']
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(true);
        });

        it('should allow named volumes', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        volumes: ['mydata:/app/data']
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(true);
        });
    });

    describe('validateCompose - Build Context', () => {
        it('should reject absolute build context', () => {
            const compose = {
                services: {
                    web: {
                        build: '/opt/malicious'
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": build context must be relative to project directory'
            );
        });

        it('should reject parent directory build context', () => {
            const compose = {
                services: {
                    web: {
                        build: '../other-project'
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": build context must be relative to project directory'
            );
        });

        it('should reject absolute build context in object form', () => {
            const compose = {
                services: {
                    web: {
                        build: {
                            context: '/etc',
                            dockerfile: 'Dockerfile'
                        }
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Service "web": build context must be relative to project directory'
            );
        });

        it('should allow relative build context', () => {
            const compose = {
                services: {
                    web: {
                        build: './app'
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(true);
        });

        it('should allow current directory build context', () => {
            const compose = {
                services: {
                    web: {
                        build: '.'
                    }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(true);
        });
    });

    describe('validateCompose - Networks', () => {
        it('should reject external networks other than dployr-network', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                },
                networks: {
                    'host-network': { external: true }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Network "host-network": external networks other than "dployr-network" are not allowed'
            );
        });

        it('should allow dployr-network as external', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                },
                networks: {
                    'dployr-network': { external: true }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(true);
        });

        it('should reject host network driver', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                },
                networks: {
                    mynet: { driver: 'host' }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Network "mynet": driver "host" is not allowed'
            );
        });

        it('should reject macvlan network driver', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                },
                networks: {
                    mynet: { driver: 'macvlan' }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Network "mynet": driver "macvlan" is not allowed'
            );
        });

        it('should allow bridge network driver', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                },
                networks: {
                    mynet: { driver: 'bridge' }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(true);
        });
    });

    describe('validateCompose - Service Structure', () => {
        it('should reject compose without services', () => {
            const compose = {
                version: '3.8'
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('No services defined in docker-compose.yml');
        });

        it('should reject invalid service definition', () => {
            const compose = {
                services: {
                    web: null
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Service "web" is invalid');
        });

        it('should validate multiple services', () => {
            const compose = {
                services: {
                    web: { image: 'nginx', privileged: true },
                    db: { image: 'mysql', cap_add: ['SYS_ADMIN'] }
                }
            };

            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBe(2);
        });
    });

    describe('transformCompose', () => {
        it('should prefix container names', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' },
                    db: { image: 'mysql' }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.container_name).toBe('john-myproject-web');
            expect(transformed.services.db.container_name).toBe('john-myproject-db');
        });

        it('should add dployr-custom label', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.labels['dployr-custom']).toBe('true');
        });

        it('should preserve existing labels as object', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        labels: { 'my.label': 'value' }
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.labels['my.label']).toBe('value');
            expect(transformed.services.web.labels['dployr-custom']).toBe('true');
        });

        it('should preserve existing labels as array', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        labels: ['my.label=value']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.labels).toContain('my.label=value');
            expect(transformed.services.web.labels).toContain('dployr-custom=true');
        });

        it('should add restart policy', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.restart).toBe('unless-stopped');
        });

        it('should not override existing restart policy', () => {
            const compose = {
                services: {
                    web: { image: 'nginx', restart: 'always' }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.restart).toBe('always');
        });

        it('should add default resource limits', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.deploy.resources.limits.cpus).toBe('1');
            expect(transformed.services.web.deploy.resources.limits.memory).toBe('512M');
        });

        it('should add timezone environment variable', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.environment).toContain('TZ=Europe/Berlin');
        });

        it('should not duplicate timezone if already set (array)', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        environment: ['TZ=America/New_York', 'OTHER=value']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            const tzCount = transformed.services.web.environment.filter(e => e.startsWith('TZ=')).length;
            expect(tzCount).toBe(1);
            expect(transformed.services.web.environment).toContain('TZ=America/New_York');
        });

        it('should not duplicate timezone if already set (object)', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        environment: { TZ: 'America/New_York' }
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.environment.TZ).toBe('America/New_York');
        });

        it('should add dployr-network to services', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.networks).toContain('dployr-network');
        });

        it('should preserve existing networks and add dployr-network', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        networks: ['mynet']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.networks).toContain('mynet');
            expect(transformed.services.web.networks).toContain('dployr-network');
        });

        it('should handle networks as object', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        networks: { mynet: { aliases: ['web-alias'] } }
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.networks['dployr-network']).toBeDefined();
            expect(transformed.services.web.networks.mynet.aliases).toContain('web-alias');
        });

        it('should define dployr-network as external', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.networks['dployr-network'].external).toBe(true);
        });

        it('should remove version field', () => {
            const compose = {
                version: '3.8',
                services: {
                    web: { image: 'nginx' }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.version).toBeUndefined();
        });
    });

    describe('transformCompose - Port Remapping', () => {
        it('should remap simple port string', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        ports: ['80']
                    }
                }
            };

            const { compose: transformed, portMappings } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.ports[0]).toBe('10000:80');
            expect(portMappings[0]).toEqual({
                service: 'web',
                internal: 80,
                external: 10000,
                protocol: 'tcp'
            });
        });

        it('should remap host:container port string', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        ports: ['8080:80']
                    }
                }
            };

            const { compose: transformed, portMappings } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.ports[0]).toBe('10000:80');
            expect(portMappings[0].internal).toBe(80);
            expect(portMappings[0].external).toBe(10000);
        });

        it('should handle UDP port protocol', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        ports: ['53:53/udp']
                    }
                }
            };

            const { compose: transformed, portMappings } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.ports[0]).toBe('10000:53/udp');
            expect(portMappings[0].protocol).toBe('udp');
        });

        it('should handle port as object', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        ports: [{ target: 80, published: 8080 }]
                    }
                }
            };

            const { compose: transformed, portMappings } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.ports[0]).toBe('10000:80');
            expect(portMappings[0].internal).toBe(80);
        });

        it('should allocate sequential ports for multiple services', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        ports: ['80']
                    },
                    api: {
                        image: 'node',
                        ports: ['3000']
                    }
                }
            };

            const { compose: transformed, portMappings } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.ports[0]).toBe('10000:80');
            expect(transformed.services.api.ports[0]).toBe('10001:3000');
            expect(portMappings.length).toBe(2);
        });

        it('should allocate sequential ports for service with multiple ports', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        ports: ['80', '443']
                    }
                }
            };

            const { compose: transformed, portMappings } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.ports[0]).toBe('10000:80');
            expect(transformed.services.web.ports[1]).toBe('10001:443');
            expect(portMappings.length).toBe(2);
        });

        it('should handle port as number', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        ports: [80]
                    }
                }
            };

            const { compose: transformed, portMappings } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.ports[0]).toBe('10000:80');
        });
    });

    describe('transformCompose - Volume Path Transformation', () => {
        it('should prefix relative volumes with ./html for app services', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        volumes: ['./src:/app']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.volumes[0]).toBe('./html/src:/app');
        });

        it('should prefix . with ./html for app services', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        volumes: ['.:/var/www/html']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.volumes[0]).toBe('./html:/var/www/html');
        });

        it('should prefix named volumes with ./html for app services', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        volumes: ['logs:/app/logs']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.volumes[0]).toBe('./html/logs:/app/logs');
        });

        it('should prefix volumes with ./data for database services', () => {
            const compose = {
                services: {
                    db: {
                        image: 'mysql:8',
                        volumes: ['./dbdata:/var/lib/mysql']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            // Database services get ./data prefix instead of ./html
            expect(transformed.services.db.volumes[0]).toBe('./data/dbdata:/var/lib/mysql');
        });

        it('should detect MariaDB as database service', () => {
            const compose = {
                services: {
                    db: {
                        image: 'mariadb:10',
                        volumes: ['.:/data']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.db.volumes[0]).toBe('./data:/data');
        });

        it('should detect PostgreSQL as database service', () => {
            const compose = {
                services: {
                    db: {
                        image: 'postgres:15',
                        volumes: ['.:/data']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.db.volumes[0]).toBe('./data:/data');
        });

        it('should detect MongoDB as database service', () => {
            const compose = {
                services: {
                    db: {
                        image: 'mongo:6',
                        volumes: ['.:/data']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.db.volumes[0]).toBe('./data:/data');
        });

        it('should detect Redis as database service', () => {
            const compose = {
                services: {
                    cache: {
                        image: 'redis:7-alpine',
                        volumes: ['.:/data']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.cache.volumes[0]).toBe('./data:/data');
        });

        it('should not double-prefix already prefixed volumes', () => {
            const compose = {
                services: {
                    web: {
                        image: 'nginx',
                        volumes: ['./html/src:/app', './data/logs:/logs']
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.volumes[0]).toBe('./html/src:/app');
            expect(transformed.services.web.volumes[1]).toBe('./data/logs:/logs');
        });
    });

    describe('transformCompose - Build Context Transformation', () => {
        it('should prefix build context string with ./html', () => {
            const compose = {
                services: {
                    web: {
                        build: '.'
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            // Current implementation produces './html/.' for '.'
            expect(transformed.services.web.build).toBe('./html/.');
        });

        it('should prefix relative build context with ./html', () => {
            const compose = {
                services: {
                    web: {
                        build: './app'
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.build).toBe('./html/app');
        });

        it('should prefix build context object with ./html', () => {
            const compose = {
                services: {
                    web: {
                        build: {
                            context: '.',
                            dockerfile: 'Dockerfile.prod'
                        }
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            // Current implementation produces './html/.' for '.'
            expect(transformed.services.web.build.context).toBe('./html/.');
            expect(transformed.services.web.build.dockerfile).toBe('Dockerfile.prod');
        });

        it('should not double-prefix already prefixed build context', () => {
            const compose = {
                services: {
                    web: {
                        build: {
                            context: './html/app'
                        }
                    }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.build.context).toBe('./html/app');
        });
    });

    describe('processUserCompose', () => {
        it('should process valid compose file end-to-end', () => {
            const yaml = `
services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - .:/var/www/html
`;
            const result = composeValidator.processUserCompose(yaml, 'john-myapp', 10000);

            expect(result.success).toBe(true);
            expect(result.yaml).toBeDefined();
            expect(result.services).toContain('web');
            expect(result.portMappings[0].external).toBe(10000);
        });

        it('should reject invalid YAML', () => {
            const yaml = 'not: valid: yaml: {{';
            const result = composeValidator.processUserCompose(yaml, 'john-myapp', 10000);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should reject compose with security violations', () => {
            const yaml = `
services:
  web:
    image: nginx
    privileged: true
`;
            const result = composeValidator.processUserCompose(yaml, 'john-myapp', 10000);

            expect(result.success).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors[0]).toContain('privileged');
        });

        it('should return transformed YAML with x-dployr marker', () => {
            const yaml = `
services:
  web:
    image: nginx
`;
            const result = composeValidator.processUserCompose(yaml, 'john-myapp', 10000);

            expect(result.success).toBe(true);
            expect(result.yaml).toContain('x-dployr');
            expect(result.yaml).toContain('dployr-custom');
        });
    });

    describe('stringifyCompose', () => {
        it('should add x-dployr extension', () => {
            const compose = {
                services: { web: { image: 'nginx' } }
            };

            const yaml = composeValidator.stringifyCompose(compose);

            expect(yaml).toContain('x-dployr');
            expect(yaml).toContain('dployr-custom');
            expect(yaml).toContain('generated');
        });
    });

    describe('findComposeFile', () => {
        // Note: These tests would need filesystem mocking for complete coverage
        it('should check for common compose filenames', () => {
            // The function looks for: docker-compose.yml, docker-compose.yaml, compose.yml, compose.yaml
            const result = composeValidator.findComposeFile('/nonexistent/path');

            expect(result.exists).toBe(false);
        });
    });

    describe('findDockerfile', () => {
        it('should return not found for nonexistent path', () => {
            const result = composeValidator.findDockerfile('/nonexistent/path');

            expect(result.exists).toBe(false);
        });
    });

    describe('Exported Constants', () => {
        it('should export BLOCKED_SERVICE_OPTIONS', () => {
            expect(composeValidator.BLOCKED_SERVICE_OPTIONS).toBeDefined();
            expect(composeValidator.BLOCKED_SERVICE_OPTIONS).toContain('privileged');
            expect(composeValidator.BLOCKED_SERVICE_OPTIONS).toContain('cap_add');
            expect(composeValidator.BLOCKED_SERVICE_OPTIONS).toContain('devices');
        });

        it('should export BLOCKED_VOLUME_SOURCES', () => {
            expect(composeValidator.BLOCKED_VOLUME_SOURCES).toBeDefined();
            expect(composeValidator.BLOCKED_VOLUME_SOURCES).toContain('/var/run/docker.sock');
            expect(composeValidator.BLOCKED_VOLUME_SOURCES).toContain('/etc/');
            expect(composeValidator.BLOCKED_VOLUME_SOURCES).toContain('/root/');
        });

        it('should export DEFAULT_RESOURCE_LIMITS', () => {
            expect(composeValidator.DEFAULT_RESOURCE_LIMITS).toBeDefined();
            expect(composeValidator.DEFAULT_RESOURCE_LIMITS.cpus).toBe('1');
            expect(composeValidator.DEFAULT_RESOURCE_LIMITS.memory).toBe('512M');
        });

        it('should export MAX_RESOURCE_LIMITS', () => {
            expect(composeValidator.MAX_RESOURCE_LIMITS).toBeDefined();
            expect(composeValidator.MAX_RESOURCE_LIMITS.cpus).toBe(2);
            expect(composeValidator.MAX_RESOURCE_LIMITS.memory).toBe('2G');
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty services object', () => {
            const compose = { services: {} };
            const result = composeValidator.validateCompose(compose);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should handle service without volumes', () => {
            const compose = {
                services: {
                    web: { image: 'nginx' }
                }
            };

            const { compose: transformed } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.web.volumes).toBeUndefined();
        });

        it('should handle service without ports', () => {
            const compose = {
                services: {
                    worker: { image: 'node' }
                }
            };

            const { compose: transformed, portMappings } = composeValidator.transformCompose(compose, 'john-myproject', 10000);

            expect(transformed.services.worker.ports).toBeUndefined();
            expect(portMappings).toHaveLength(0);
        });

        it('should handle complex real-world compose file', () => {
            const yaml = `
services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./public:/var/www/html
    depends_on:
      - app
    environment:
      - NGINX_HOST=localhost

  app:
    build: .
    ports:
      - "3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      NODE_ENV: production
      DB_HOST: db

  db:
    image: postgres:15-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: secret

volumes:
  pgdata:
`;
            const result = composeValidator.processUserCompose(yaml, 'john-fullstack', 10000);

            expect(result.success).toBe(true);
            expect(result.services).toContain('web');
            expect(result.services).toContain('app');
            expect(result.services).toContain('db');
            // 80, 443 from web and 3000 from app (db has no ports)
            expect(result.portMappings.length).toBe(3);
        });
    });

    describe('analyzeComposeCompleteness', () => {
        it('should detect infrastructure-only compose (databases + cache)', () => {
            const compose = {
                services: {
                    db: { image: 'postgres:15' },
                    redis: { image: 'redis:7-alpine' }
                }
            };
            const result = composeValidator.analyzeComposeCompleteness(compose);

            expect(result.isInfrastructureOnly).toBe(true);
            expect(result.infrastructureServices).toHaveLength(2);
            expect(result.appServices).toHaveLength(0);
            expect(result.totalServices).toBe(2);
        });

        it('should detect infrastructure-only with keycloak', () => {
            const compose = {
                services: {
                    db: { image: 'postgres:15' },
                    redis: { image: 'redis:7-alpine' },
                    keycloak: { image: 'quay.io/keycloak/keycloak:24.0' }
                }
            };
            const result = composeValidator.analyzeComposeCompleteness(compose);

            expect(result.isInfrastructureOnly).toBe(true);
            expect(result.infrastructureServices).toHaveLength(3);
        });

        it('should NOT flag compose with app services (unknown image)', () => {
            const compose = {
                services: {
                    app: { image: 'myapp:latest', ports: ['3000:3000'] },
                    db: { image: 'postgres:15' }
                }
            };
            const result = composeValidator.analyzeComposeCompleteness(compose);

            expect(result.isInfrastructureOnly).toBe(false);
            expect(result.appServices).toHaveLength(1);
            expect(result.appServices[0].name).toBe('app');
        });

        it('should NOT flag compose with build services', () => {
            const compose = {
                services: {
                    api: { build: './api' },
                    db: { image: 'postgres:15' }
                }
            };
            const result = composeValidator.analyzeComposeCompleteness(compose);

            expect(result.isInfrastructureOnly).toBe(false);
            expect(result.appServices).toHaveLength(1);
            expect(result.appServices[0].hasBuild).toBe(true);
        });

        it('should treat build directive as app even if image matches infra pattern', () => {
            const compose = {
                services: {
                    web: { build: '.', image: 'nginx' },
                    db: { image: 'postgres:15' }
                }
            };
            const result = composeValidator.analyzeComposeCompleteness(compose);

            expect(result.isInfrastructureOnly).toBe(false);
            expect(result.appServices).toHaveLength(1);
            expect(result.appServices[0].name).toBe('web');
        });

        it('should detect message brokers as infrastructure', () => {
            const compose = {
                services: {
                    rabbit: { image: 'rabbitmq:3-management' },
                    kafka: { image: 'confluentinc/cp-kafka:latest' }
                }
            };
            const result = composeValidator.analyzeComposeCompleteness(compose);

            expect(result.isInfrastructureOnly).toBe(true);
            expect(result.infrastructureServices).toHaveLength(2);
        });

        it('should handle empty compose', () => {
            const result = composeValidator.analyzeComposeCompleteness({});

            expect(result.isInfrastructureOnly).toBe(false);
            expect(result.totalServices).toBe(0);
        });

        it('should handle null compose', () => {
            const result = composeValidator.analyzeComposeCompleteness(null);

            expect(result.isInfrastructureOnly).toBe(false);
        });

        it('should handle mixed compose with both app and infra', () => {
            const compose = {
                services: {
                    frontend: { build: './frontend' },
                    api: { build: './api' },
                    db: { image: 'postgres:15' },
                    redis: { image: 'redis:7' },
                    keycloak: { image: 'quay.io/keycloak/keycloak:latest' }
                }
            };
            const result = composeValidator.analyzeComposeCompleteness(compose);

            expect(result.isInfrastructureOnly).toBe(false);
            expect(result.appServices).toHaveLength(2);
            expect(result.infrastructureServices).toHaveLength(3);
            expect(result.totalServices).toBe(5);
        });

        it('should detect monitoring tools as infrastructure', () => {
            const compose = {
                services: {
                    prometheus: { image: 'prom/prometheus:latest' },
                    grafana: { image: 'grafana/grafana:latest' }
                }
            };
            const result = composeValidator.analyzeComposeCompleteness(compose);

            expect(result.isInfrastructureOnly).toBe(true);
        });

        it('should detect admin tools as infrastructure', () => {
            const compose = {
                services: {
                    db: { image: 'mariadb:11' },
                    pma: { image: 'phpmyadmin:latest' }
                }
            };
            const result = composeValidator.analyzeComposeCompleteness(compose);

            expect(result.isInfrastructureOnly).toBe(true);
        });
    });
});
