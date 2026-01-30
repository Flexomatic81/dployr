# Changelog

All notable changes to Dployr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.4.7] - 2026-01-21

### Fixed
- Laravel Apache config now uses literal paths instead of environment variables
- Fixes "directive requires additional arguments" error on Laravel projects

### Added
- Persistence hint banner in Terminal and Claude Panel
- Shows "Only changes in /workspace are persisted!" on connect

## [v1.4.6] - 2026-01-18

### Added
- Claude Code now starts in YOLO mode (`--dangerously-skip-permissions`) in workspace
- Workspace container is isolated, so YOLO mode is safe and improves workflow

## [v1.4.5] - 2026-01-18

### Fixed
- Reliable version tag detection for annotated git tags
- deploy.sh uses `--force` when fetching tags to ensure updates
- deploy.sh fallback to check remote tags via `git ls-remote`
- update.js correctly dereferences annotated tags to commit hash
- False "update available" notification when already on latest release

## [v1.4.4] - 2026-01-18

### Fixed
- Version tag now reliably displayed in footer and update page
- deploy.sh writes `.version.json` to host with tag information
- Dashboard reads version from host file (most reliable method)

## [v1.4.3] - 2026-01-18

### Fixed
- Improved version tag resolution with multiple fallback methods
- Use `git tag --points-at HEAD` as primary method (more reliable)
- Better error handling and logging for version detection

## [v1.4.2] - 2026-01-18

### Fixed
- Version tag now resolved from git at startup if missing in version.json
- Update check now compares commit hashes when tags don't match
- Fixes false "update available" when server is already on latest release

## [v1.4.1] - 2026-01-18

### Fixed
- Fetch git tags before checking current version to correctly identify tagged releases

## [v1.4.0] - 2026-01-18

### Added
- **Two-Factor Authentication (2FA)**: Secure accounts with TOTP-based authentication
  - QR code setup with authenticator apps (Google Authenticator, Authy, Microsoft Authenticator)
  - 10 backup codes for account recovery
  - Backup code regeneration in security settings
  - 2FA verification during login flow
- **Claude Code Panel**: Dedicated panel for Claude Code AI assistant in workspaces
  - Integrated terminal for Claude Code CLI
  - OAuth authentication flow with code input field
  - Auth success detection and panel auto-hide
- Sync button to Terminal and Claude Code panels for quick file synchronization
- Sync progress modal showing detailed sync status in workspace views

### Fixed
- Backup codes display and button functionality improvements
- Database pool import in admin settings
- Switched from otplib to otpauth for better TOTP compatibility
- Always rebuild custom projects on workspace sync
- Terminal input: send code and Enter key separately with delay
- Use carriage return for terminal Enter key
- Only show auth panel when auth URL is detected

### Changed
- Restructured Claude Code skills for clarity (precommit, check, review, release)
- Integrated test skill into review skill
- Addressed code review action items (moved DB queries to services, split large functions)

### Documentation
- Added Security section with 2FA documentation to help page (DE/EN)
- Added proactive skill usage instructions to CLAUDE.md
- Added claude-terminal.js and twofa.js service references

### Tests
- Added unit tests for twofa service (32 tests)
- Added unit tests for claude-terminal service (27 tests)

## [v1.3.0] - 2026-01-15

### Added
- **Custom Docker-Compose Projects**: Deploy projects with your own docker-compose.yml
  - Automatic detection and validation of user-provided docker-compose files
  - Security validation (blocks privileged mode, host networking, dangerous mounts)
  - Port remapping to available external ports
  - Resource limits enforcement (1 CPU, 512MB RAM per service by default)
  - Container names prefixed with username-projectname for isolation
  - Database volumes isolated to `./data/` directory
  - Re-import docker-compose.yml on rebuild/git pull
  - Technology detection from Dockerfile
  - Port remapping info hint in project details
- Status modal with polling for project actions (start/stop/restart/rebuild)
- Custom project type badge in dashboard and project list

### Fixed
- Git "dubious ownership" error in dashboard container (safe.directory config)
- MySQL session store not initializing at startup (WebSocket/IDE failures)
- Missing `Accept: application/json` header in AJAX fetch calls
- JSON and form submission support for workspace routes
- Service detection in custom docker-compose parsing
- Wait for all containers to be running before success response

### Security
- SQL injection vulnerability in database providers (parameterized queries)
- Open redirect vulnerability in return URLs (sanitizeReturnUrl function)

### Changed
- Removed project settings card with type dropdown (type is now immutable)
- Custom projects cannot change type after creation
- Improved custom project type detection with flexible regex

### Documentation
- Added Custom Docker-Compose documentation to CLAUDE.md
- Updated technical debt documentation

## [v1.2.2] - 2026-01-13

### Fixed
- Separate branch and tag fetch in deploy script to avoid false errors

## [v1.2.1] - 2026-01-12

### Fixed
- Use git reset instead of pull in deploy script for cleaner updates
- Better error handling and feedback in deploy script

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

[v1.4.7]: https://github.com/Flexomatic81/dployr/releases/tag/v1.4.7
[v1.4.6]: https://github.com/Flexomatic81/dployr/releases/tag/v1.4.6
[v1.4.5]: https://github.com/Flexomatic81/dployr/releases/tag/v1.4.5
[v1.4.4]: https://github.com/Flexomatic81/dployr/releases/tag/v1.4.4
[v1.4.3]: https://github.com/Flexomatic81/dployr/releases/tag/v1.4.3
[v1.4.2]: https://github.com/Flexomatic81/dployr/releases/tag/v1.4.2
[v1.4.1]: https://github.com/Flexomatic81/dployr/releases/tag/v1.4.1
[v1.4.0]: https://github.com/Flexomatic81/dployr/releases/tag/v1.4.0
[v1.3.0]: https://github.com/Flexomatic81/dployr/releases/tag/v1.3.0
[v1.2.2]: https://github.com/Flexomatic81/dployr/releases/tag/v1.2.2
[v1.2.1]: https://github.com/Flexomatic81/dployr/releases/tag/v1.2.1
[v1.2.0]: https://github.com/Flexomatic81/dployr/releases/tag/v1.2.0
[v1.1.1]: https://github.com/Flexomatic81/dployr/releases/tag/v1.1.1
[v1.1.0]: https://github.com/Flexomatic81/dployr/releases/tag/v1.1.0
[v1.0.0]: https://github.com/Flexomatic81/dployr/releases/tag/v1.0.0
