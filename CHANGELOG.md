# Changelog

All notable changes to Dployr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.2.0] - 2026-01-11

### Added
- **Workspaces (Cloud IDE)**: Browser-based development environments per project
  - Full VS Code IDE (code-server) accessible through dashboard
  - Integrated terminal with WebSocket connection to container
  - Standalone terminal view with xterm.js
  - Secure API key management with AES-256-GCM encryption
  - Automatic project synchronization and rebuild
  - IDE language synced with dashboard language setting
  - Claude Code VS Code extension pre-installed
  - Auto-update Claude Code on workspace start
  - Persistent Claude Code login across workspace restarts
  - Container health checks before loading IDE
  - Workspace proxy routing through dashboard for security
- Resource management admin panel for monitoring workspace limits
- API Keys settings page for secure credential storage
- Workspaces section in help page (DE/EN)
- Claude Code skills for development workflow (`/dployr-check`, `/dployr-review`, `/dployr-test`, `/dployr-changelog`, `/dployr-release`)
- i18n translation consistency check in `/dployr-check` skill
- Auto-generate CLAUDE.md on workspace start

### Fixed
- WebSocket ping/pong heartbeat for terminal connections
- CSRF header name (X-CSRF-Token)
- Popup blocker issues when opening IDE
- Workspace file permissions with root entrypoint
- CSP and rate limiting for workspace proxy
- Memory leak in workspace proxy logging
- WebSocket proxy for code-server compatibility
- Deploy script re-exec losing CLI arguments

### Changed
- Translated all German code comments to English
- Improved error logging with stack traces in projectAccess middleware
- Optimized N+1 queries with Promise.all in projects and admin routes
- Added getUserProjectCount for fast directory counting
- Added WebSocket retry logic for container IP retrieval
- Code review improvements and technical debt documentation

### Tests
- Added unit tests for workspace service
- Added unit tests for encryption service
- Added unit tests for portManager service
- Added unit tests for preview service
- Added unit tests for workspaceAccess middleware

## [v1.1.1] - 2026-01-02

### Fixed
- Version tag not displayed in footer (now shows tag with tooltip for commit hash)

### Documentation
- Updated CLAUDE.md with Backup & Restore feature documentation

## [v1.1.0] - 2026-01-02

### Added
- **Backup & Restore Feature**: Complete backup system for projects and databases
  - Project backups as tar.gz archives (excludes node_modules, vendor, .git)
  - Database backups for MariaDB and PostgreSQL
  - Restore functionality for both project and database backups
  - Backup preview showing archive contents
  - Backup history and statistics
- Database backup button in project detail page (linked to project's configured database)
- `/dployr-release` skill for creating releases with changelog

### Fixed
- Open Redirect vulnerability in backup routes (security fix)
- N+1 query performance issue in admin dashboard
- Delete modals moved outside table for valid HTML structure
- Database clients (mariadb-client, postgresql-client) installed in dashboard container

### Changed
- Improved update notification UX in dashboard

### Security
- Added `sanitizeReturnUrl()` function to prevent open redirect attacks
- Optimized `getTotalProjectCount()` to avoid N+1 database queries

## [v1.0.0] - 2024-12-XX

### Added
- Initial release of Dployr
- Multi-user hosting platform with Docker isolation
- Project types: Static, PHP, Node.js, Laravel, Next.js, Nuxt.js, Python Flask/Django
- Database provisioning: MariaDB and PostgreSQL
- Git deployment with auto-deploy and webhooks
- ZIP upload deployment
- Nginx Proxy Manager integration for domains and SSL
- Email notifications for deployments
- Admin dashboard with user management
- System updates from GitHub releases

[v1.2.0]: https://github.com/Flexomatic81/dployr/releases/tag/v1.2.0
[v1.1.1]: https://github.com/Flexomatic81/dployr/releases/tag/v1.1.1
[v1.1.0]: https://github.com/Flexomatic81/dployr/releases/tag/v1.1.0
[v1.0.0]: https://github.com/Flexomatic81/dployr/releases/tag/v1.0.0
