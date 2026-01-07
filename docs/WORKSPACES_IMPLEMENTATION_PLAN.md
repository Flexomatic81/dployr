# Workspaces Implementation Plan

> **Issue:** #19 - Feature: Workspaces (Cloud IDE per Project)
> **Status:** Planning
> **Erstellt:** 2026-01-08

---

## 1. Executive Summary

Workspaces erweitern dployr um eine vollständige, browserbasierte Entwicklungsumgebung (Cloud IDE) pro Projekt. Entwickler können direkt im Browser mit VS Code, integriertem Terminal und Claude Code arbeiten, ohne lokale Installation.

### Kernprinzip
```
PROJECT (Production) ←→ WORKSPACE (Development) ←→ DATABASE
```

Jedes Projekt kann einen zugeordneten Workspace haben. Bidirektionale Synchronisation ermöglicht nahtlosen Workflow zwischen Entwicklung und Deployment.

---

## 2. Architektur-Übersicht

### 2.1 System-Architektur

```
┌─────────────────────────────────────────────────────────────────────┐
│                         dployr Dashboard                            │
│                      (Express.js Application)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │  Projects   │  │  Databases  │  │   Backups   │  │ WORKSPACES │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
           ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
           │   Project    │ │  Workspace   │ │   Preview    │
           │  Container   │ │  Container   │ │  Container   │
           │              │ │              │ │              │
           │ • nginx/node │ │ • code-server│ │ • temp deploy│
           │ • app code   │ │ • claude-code│ │ • auto-expire│
           │ • port 80    │ │ • dev tools  │ │ • unique URL │
           └──────────────┘ └──────────────┘ └──────────────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    │
                                    ▼
                          ┌──────────────────┐
                          │   Shared Data    │
                          │                  │
                          │ • Project Files  │
                          │ • Database       │
                          │ • .env Config    │
                          └──────────────────┘
```

### 2.2 Daten-Fluss

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Request Flow                        │
└─────────────────────────────────────────────────────────────────┘

[Browser] → [Nginx Proxy Manager] → [dployr Dashboard :3000]
                                            │
                    ┌───────────────────────┼───────────────────┐
                    │                       │                   │
                    ▼                       ▼                   ▼
            [Project Routes]       [Workspace Routes]    [Preview Routes]
                    │                       │                   │
                    ▼                       ▼                   ▼
            [Project Service]      [Workspace Service]   [Preview Service]
                    │                       │                   │
                    └───────────────────────┼───────────────────┘
                                            │
                                            ▼
                                    [Docker Service]
                                            │
                                            ▼
                                    [Docker Engine]
```

---

## 3. Sicherheitskonzept

### 3.1 Container-Isolation

```yaml
# Sicherheits-Konfiguration für Workspace-Container
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
cap_add:
  - CHOWN
  - SETUID
  - SETGID
read_only: false  # Workspace braucht Schreibzugriff
tmpfs:
  - /tmp:size=512M,mode=1777
```

**Maßnahmen:**
- Kein Zugriff auf Host-Filesystem außer gemounteten Volumes
- Kein Zugriff auf Docker Socket (kein Docker-in-Docker)
- Netzwerk-Isolation zwischen Workspaces verschiedener User
- Keine privilegierten Container
- Resource Limits (CPU, RAM, Disk)

### 3.2 API-Key Sicherheit

```
┌─────────────────────────────────────────────────────────────────┐
│                    API Key Storage Flow                         │
└─────────────────────────────────────────────────────────────────┘

[User Input] → [HTTPS/TLS] → [Server Validation]
                                      │
                                      ▼
                            [AES-256-GCM Encryption]
                                      │
                                      ▼
                            [Database Storage]
                            (encrypted blob + IV)
                                      │
                                      ▼
                            [Workspace Start]
                                      │
                                      ▼
                            [Decrypt in Memory]
                                      │
                                      ▼
                            [Inject as ENV Variable]
                            (never written to disk)
```

**Maßnahmen:**
- Verschlüsselung mit AES-256-GCM (Authenticated Encryption)
- Encryption Key aus `SESSION_SECRET` abgeleitet
- IV (Initialization Vector) pro Verschlüsselung
- API-Key wird NIE im Klartext geloggt
- API-Key wird nur in Container-Memory injiziert

### 3.3 Authentifizierung & Autorisierung

```
┌─────────────────────────────────────────────────────────────────┐
│                    Access Control Matrix                        │
└─────────────────────────────────────────────────────────────────┘

                    │ View │ Start │ Stop │ Sync │ Delete │ Settings
────────────────────┼──────┼───────┼──────┼──────┼────────┼─────────
Owner               │  ✓   │   ✓   │  ✓   │  ✓   │   ✓    │    ✓
Share: full         │  ✓   │   ✓   │  ✓   │  ✓   │   ✗    │    ✗
Share: manage       │  ✓   │   ✓   │  ✓   │  ✓   │   ✗    │    ✗
Share: read         │  ✓   │   ✗   │  ✗   │  ✗   │   ✗    │    ✗
Admin               │  ✓   │   ✓   │  ✓   │  ✗   │   ✓    │    ✓
```

**Maßnahmen:**
- Session-basierte Auth (wie bestehend)
- Projekt-Berechtigungen gelten auch für Workspace
- code-server erhält Session-Token für Zugriff
- CSRF-Schutz auf allen Mutationen
- Rate Limiting auf Start/Stop Aktionen

### 3.4 Netzwerk-Sicherheit

```
┌─────────────────────────────────────────────────────────────────┐
│                    Network Architecture                         │
└─────────────────────────────────────────────────────────────────┘

                    [Internet]
                        │
                        ▼
                [Nginx Proxy Manager]
                   (SSL Termination)
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
   [dployr Net]   [workspace-net-1] [workspace-net-2]
        │               │               │
   [Dashboard]    [Workspace 1]    [Workspace 2]
   [MariaDB]           │               │
   [PostgreSQL]        │               │
        │               │               │
        └───────────────┴───────────────┘
                        │
                   [Shared DB Net]
                   (if DB attached)
```

**Maßnahmen:**
- Jeder Workspace in eigenem Docker Network
- Keine direkte Internet-Erreichbarkeit
- Zugriff nur über Dashboard-Proxy
- Preview Environments: Temporäre, zufällige URLs

---

## 4. Datenbank-Schema

### 4.1 Neue Tabellen

```sql
-- ============================================================
-- WORKSPACES TABLE
-- Speichert Workspace-Konfiguration und Status
-- ============================================================
CREATE TABLE IF NOT EXISTS workspaces (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Beziehungen
    user_id INT NOT NULL,
    project_name VARCHAR(100) NOT NULL,

    -- Container-Info
    container_id VARCHAR(64) NULL,
    container_name VARCHAR(100) NULL,

    -- Status
    status ENUM('stopped', 'starting', 'running', 'stopping', 'error')
        DEFAULT 'stopped',
    error_message TEXT NULL,

    -- Netzwerk
    internal_port INT DEFAULT 8080,
    assigned_port INT NULL,

    -- Resource Limits
    cpu_limit VARCHAR(20) DEFAULT '1',
    ram_limit VARCHAR(20) DEFAULT '2g',
    disk_limit VARCHAR(20) DEFAULT '10g',

    -- Timeouts
    idle_timeout_minutes INT DEFAULT 30,
    max_lifetime_hours INT DEFAULT 24,

    -- Activity Tracking
    last_activity TIMESTAMP NULL,
    started_at TIMESTAMP NULL,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Constraints
    FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_workspace (user_id, project_name),
    INDEX idx_status (status),
    INDEX idx_last_activity (last_activity)
);

-- ============================================================
-- USER API KEYS TABLE
-- Verschlüsselte Speicherung von API Keys
-- ============================================================
CREATE TABLE IF NOT EXISTS user_api_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,

    -- Anthropic API Key (verschlüsselt)
    anthropic_key_encrypted VARBINARY(512) NULL,
    anthropic_key_iv VARBINARY(16) NULL,

    -- Weitere Provider (Zukunft)
    openai_key_encrypted VARBINARY(512) NULL,
    openai_key_iv VARBINARY(16) NULL,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE
);

-- ============================================================
-- PREVIEW ENVIRONMENTS TABLE
-- Temporäre Deployment-Umgebungen
-- ============================================================
CREATE TABLE IF NOT EXISTS preview_environments (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Beziehungen
    workspace_id INT NOT NULL,
    user_id INT NOT NULL,
    project_name VARCHAR(100) NOT NULL,

    -- Identifikation
    preview_hash VARCHAR(32) NOT NULL UNIQUE,
    preview_url VARCHAR(255) NULL,

    -- Container-Info
    container_id VARCHAR(64) NULL,
    container_name VARCHAR(100) NULL,
    assigned_port INT NULL,

    -- Status
    status ENUM('creating', 'running', 'stopping', 'stopped', 'expired', 'error')
        DEFAULT 'creating',
    error_message TEXT NULL,

    -- Lifecycle
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Optional: Passwortschutz
    password_hash VARCHAR(255) NULL,

    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
    INDEX idx_expires (expires_at),
    INDEX idx_status (status)
);

-- ============================================================
-- WORKSPACE ACTIVITY LOG
-- Audit Trail für Workspace-Aktionen
-- ============================================================
CREATE TABLE IF NOT EXISTS workspace_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Beziehungen
    workspace_id INT NULL,
    user_id INT NOT NULL,
    project_name VARCHAR(100) NOT NULL,

    -- Aktion
    action ENUM(
        'create', 'start', 'stop', 'delete',
        'sync_to_project', 'sync_from_project',
        'preview_create', 'preview_delete',
        'timeout', 'error'
    ) NOT NULL,

    -- Details
    details JSON NULL,

    -- Timestamp
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
    INDEX idx_user_project (user_id, project_name),
    INDEX idx_created (created_at)
);

-- ============================================================
-- RESOURCE LIMITS TABLE (Admin-Konfiguration)
-- Globale und User-spezifische Limits
-- ============================================================
CREATE TABLE IF NOT EXISTS resource_limits (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- NULL = globale Defaults, sonst User-spezifisch
    user_id INT NULL,

    -- Workspace Limits
    max_workspaces INT DEFAULT 2,
    default_cpu VARCHAR(20) DEFAULT '1',
    default_ram VARCHAR(20) DEFAULT '2g',
    default_disk VARCHAR(20) DEFAULT '10g',
    default_idle_timeout INT DEFAULT 30,

    -- Preview Limits
    max_previews_per_workspace INT DEFAULT 3,
    default_preview_lifetime_hours INT DEFAULT 24,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_limits (user_id)
);

-- Global Defaults einfügen
INSERT INTO resource_limits (user_id) VALUES (NULL);
```

### 4.2 Migration Strategy

Migrations werden im bestehenden Pattern in `database.js` hinzugefügt:

```javascript
// Migration: Create workspaces table
try {
    await connection.execute(`CREATE TABLE IF NOT EXISTS workspaces ...`);
    logger.info('Migration: Created workspaces table');
} catch (e) {
    // Table already exists - ignore
}
```

---

## 5. Docker Image: dployr-workspace

### 5.1 Dockerfile

```dockerfile
# ============================================================
# dployr-workspace
# VS Code im Browser mit Claude Code Integration
# ============================================================

FROM codercom/code-server:4.99.4

# Metadata
LABEL maintainer="dployr"
LABEL description="Cloud IDE with Claude Code for dployr"

# Switch to root for installation
USER root

# ============================================================
# System Dependencies
# ============================================================
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Basic tools
    git \
    curl \
    wget \
    ca-certificates \
    gnupg \
    # Build essentials (for native npm modules)
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    # Database clients
    mariadb-client \
    postgresql-client \
    # PHP (for PHP projects)
    php \
    php-cli \
    php-mysql \
    php-pgsql \
    php-curl \
    php-json \
    php-mbstring \
    php-xml \
    composer \
    # Utilities
    rsync \
    zip \
    unzip \
    jq \
    && rm -rf /var/lib/apt/lists/*

# ============================================================
# Node.js (LTS)
# ============================================================
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ============================================================
# Claude Code CLI
# ============================================================
RUN npm install -g @anthropic-ai/claude-code

# ============================================================
# Global npm packages (commonly used)
# ============================================================
RUN npm install -g \
    typescript \
    ts-node \
    nodemon \
    pm2 \
    eslint \
    prettier

# ============================================================
# VS Code Extensions (pre-installed)
# ============================================================
USER coder

# Essential extensions
RUN code-server --install-extension esbenp.prettier-vscode \
    && code-server --install-extension dbaeumer.vscode-eslint \
    && code-server --install-extension ms-python.python \
    && code-server --install-extension bmewburn.vscode-intelephense-client \
    && code-server --install-extension formulahendry.auto-rename-tag \
    && code-server --install-extension christian-kohler.path-intellisense \
    && code-server --install-extension eamodio.gitlens \
    && code-server --install-extension pkief.material-icon-theme

# ============================================================
# Configuration
# ============================================================
USER root

# code-server config directory
RUN mkdir -p /home/coder/.config/code-server

# Default settings
COPY workspace-settings.json /home/coder/.local/share/code-server/User/settings.json

# Startup script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# ============================================================
# Runtime Configuration
# ============================================================

# Switch back to coder user
USER coder

# Working directory (will be mounted)
WORKDIR /workspace

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/healthz || exit 1

# Default port
EXPOSE 8080

# Environment
ENV SHELL=/bin/bash

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

### 5.2 Entrypoint Script

```bash
#!/bin/bash
# entrypoint.sh - Workspace Container Startup

set -e

# ============================================================
# Environment Setup
# ============================================================

# Create workspace directory if not exists
mkdir -p /workspace

# Setup Claude Code if API key provided
if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "Claude Code: API Key configured"
    # Claude Code will read from environment
fi

# Database connection info (if provided)
if [ -n "$DATABASE_URL" ]; then
    echo "Database: Connection configured"
fi

# ============================================================
# Git Configuration (if provided)
# ============================================================

if [ -n "$GIT_USER_NAME" ]; then
    git config --global user.name "$GIT_USER_NAME"
fi

if [ -n "$GIT_USER_EMAIL" ]; then
    git config --global user.email "$GIT_USER_EMAIL"
fi

# ============================================================
# Start code-server
# ============================================================

exec code-server \
    --bind-addr 0.0.0.0:8080 \
    --auth none \
    --disable-telemetry \
    /workspace
```

### 5.3 VS Code Settings

```json
{
    "editor.fontSize": 14,
    "editor.tabSize": 2,
    "editor.formatOnSave": true,
    "editor.minimap.enabled": false,
    "editor.wordWrap": "on",
    "files.autoSave": "afterDelay",
    "files.autoSaveDelay": 1000,
    "terminal.integrated.defaultProfile.linux": "bash",
    "workbench.colorTheme": "Default Dark+",
    "workbench.iconTheme": "material-icon-theme",
    "git.autofetch": true,
    "git.confirmSync": false,
    "extensions.autoUpdate": false
}
```

---

## 6. Service Layer

### 6.1 Workspace Service

**Datei:** `dashboard/src/services/workspace.js`

```javascript
/**
 * Workspace Service
 *
 * Verantwortlich für:
 * - Workspace Lifecycle (create, start, stop, delete)
 * - Resource Management
 * - Container Orchestration
 * - Sync mit Projekten
 */

const Docker = require('dockerode');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const { pool } = require('../config/database');
const { logger } = require('../config/logger');

// ============================================================
// CONSTANTS
// ============================================================

const WORKSPACE_IMAGE = 'dployr-workspace:latest';
const WORKSPACE_NETWORK_PREFIX = 'dployr-workspace-';
const CONTAINER_PREFIX = 'dployr-ws-';

const STATUS = {
    STOPPED: 'stopped',
    STARTING: 'starting',
    RUNNING: 'running',
    STOPPING: 'stopping',
    ERROR: 'error'
};

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Erstellt einen neuen Workspace für ein Projekt
 */
async function createWorkspace(userId, projectName, options = {}) { }

/**
 * Startet einen gestoppten Workspace
 */
async function startWorkspace(userId, projectName) { }

/**
 * Stoppt einen laufenden Workspace
 */
async function stopWorkspace(userId, projectName) { }

/**
 * Löscht einen Workspace vollständig
 */
async function deleteWorkspace(userId, projectName) { }

/**
 * Holt den aktuellen Status eines Workspaces
 */
async function getWorkspaceStatus(userId, projectName) { }

/**
 * Synchronisiert Workspace-Änderungen zum Projekt
 */
async function syncToProject(userId, projectName) { }

/**
 * Holt Projekt-Änderungen in den Workspace
 */
async function syncFromProject(userId, projectName) { }

/**
 * Aktualisiert die Last-Activity Zeit (für Idle Timeout)
 */
async function updateActivity(workspaceId) { }

/**
 * Prüft und stoppt idle Workspaces (Cron Job)
 */
async function checkIdleWorkspaces() { }

/**
 * Holt alle Workspaces eines Users
 */
async function getUserWorkspaces(userId) { }

/**
 * Holt globale und user-spezifische Resource Limits
 */
async function getResourceLimits(userId) { }

module.exports = {
    createWorkspace,
    startWorkspace,
    stopWorkspace,
    deleteWorkspace,
    getWorkspaceStatus,
    syncToProject,
    syncFromProject,
    updateActivity,
    checkIdleWorkspaces,
    getUserWorkspaces,
    getResourceLimits,
    STATUS
};
```

### 6.2 Preview Service

**Datei:** `dashboard/src/services/preview.js`

```javascript
/**
 * Preview Service
 *
 * Verantwortlich für:
 * - Temporäre Preview-Deployments
 * - URL-Generierung
 * - Auto-Cleanup
 */

/**
 * Erstellt ein Preview Environment aus einem Workspace
 */
async function createPreview(workspaceId, options = {}) { }

/**
 * Löscht ein Preview Environment
 */
async function deletePreview(previewId) { }

/**
 * Verlängert die Lebenszeit eines Previews
 */
async function extendPreview(previewId, hours) { }

/**
 * Bereinigt abgelaufene Previews (Cron Job)
 */
async function cleanupExpiredPreviews() { }

/**
 * Holt alle Previews eines Workspaces
 */
async function getWorkspacePreviews(workspaceId) { }

/**
 * Validiert Preview-Zugriff (optional mit Passwort)
 */
async function validatePreviewAccess(previewHash, password = null) { }

module.exports = {
    createPreview,
    deletePreview,
    extendPreview,
    cleanupExpiredPreviews,
    getWorkspacePreviews,
    validatePreviewAccess
};
```

### 6.3 Encryption Service

**Datei:** `dashboard/src/services/encryption.js`

```javascript
/**
 * Encryption Service
 *
 * Verantwortlich für:
 * - Sichere Verschlüsselung von API Keys
 * - Key Derivation
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Leitet einen Encryption Key aus dem Session Secret ab
 */
function deriveKey(secret) {
    return crypto.scryptSync(secret, 'dployr-api-keys', KEY_LENGTH);
}

/**
 * Verschlüsselt einen Wert
 * @returns {{ encrypted: Buffer, iv: Buffer }}
 */
function encrypt(plaintext, secret) {
    const key = deriveKey(secret);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    // Auth Tag für Authenticated Encryption
    const authTag = cipher.getAuthTag();

    // Kombiniere encrypted + authTag
    const combined = Buffer.concat([encrypted, authTag]);

    return { encrypted: combined, iv };
}

/**
 * Entschlüsselt einen Wert
 */
function decrypt(encryptedWithTag, iv, secret) {
    const key = deriveKey(secret);

    // Trenne encrypted und authTag
    const authTag = encryptedWithTag.slice(-AUTH_TAG_LENGTH);
    const encrypted = encryptedWithTag.slice(0, -AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
```

---

## 7. Routes & API

### 7.1 Workspace Routes

**Datei:** `dashboard/src/routes/workspaces.js`

```javascript
/**
 * Workspace Routes
 *
 * Base: /workspaces
 */

const express = require('express');
const router = express.Router();

// ============================================================
// LIST & OVERVIEW
// ============================================================

// GET /workspaces - Liste aller User-Workspaces
router.get('/', listWorkspaces);

// ============================================================
// WORKSPACE CRUD
// ============================================================

// POST /workspaces/:projectName - Workspace erstellen
router.post('/:projectName', createWorkspace);

// GET /workspaces/:projectName - Workspace Details
router.get('/:projectName', getWorkspace);

// DELETE /workspaces/:projectName - Workspace löschen
router.delete('/:projectName', deleteWorkspace);

// ============================================================
// WORKSPACE ACTIONS
// ============================================================

// POST /workspaces/:projectName/start - Workspace starten
router.post('/:projectName/start', startWorkspace);

// POST /workspaces/:projectName/stop - Workspace stoppen
router.post('/:projectName/stop', stopWorkspace);

// POST /workspaces/:projectName/sync/to-project - Sync zum Projekt
router.post('/:projectName/sync/to-project', syncToProject);

// POST /workspaces/:projectName/sync/from-project - Sync vom Projekt
router.post('/:projectName/sync/from-project', syncFromProject);

// ============================================================
// WORKSPACE IDE ACCESS
// ============================================================

// GET /workspaces/:projectName/ide - IDE Proxy (code-server)
router.get('/:projectName/ide', accessIDE);

// WebSocket Upgrade für IDE (in app.js konfiguriert)

// ============================================================
// PREVIEW ENVIRONMENTS
// ============================================================

// POST /workspaces/:projectName/previews - Preview erstellen
router.post('/:projectName/previews', createPreview);

// GET /workspaces/:projectName/previews - Liste der Previews
router.get('/:projectName/previews', listPreviews);

// DELETE /workspaces/:projectName/previews/:previewId - Preview löschen
router.delete('/:projectName/previews/:previewId', deletePreview);

module.exports = router;
```

### 7.2 API Key Routes

**Datei:** `dashboard/src/routes/api-keys.js`

```javascript
/**
 * API Key Management Routes
 *
 * Base: /settings/api-keys
 */

const express = require('express');
const router = express.Router();

// GET /settings/api-keys - Status der konfigurierten Keys
router.get('/', getApiKeyStatus);

// POST /settings/api-keys/anthropic - Anthropic Key setzen
router.post('/anthropic', setAnthropicKey);

// DELETE /settings/api-keys/anthropic - Anthropic Key löschen
router.delete('/anthropic', deleteAnthropicKey);

// POST /settings/api-keys/anthropic/test - Key testen
router.post('/anthropic/test', testAnthropicKey);

module.exports = router;
```

### 7.3 Admin Routes für Resource Limits

**Datei:** `dashboard/src/routes/admin/resources.js`

```javascript
/**
 * Admin Resource Management Routes
 *
 * Base: /admin/resources
 */

const express = require('express');
const router = express.Router();

// GET /admin/resources - Übersicht aller Workspaces
router.get('/', getResourceOverview);

// GET /admin/resources/limits - Globale Limits
router.get('/limits', getGlobalLimits);

// PUT /admin/resources/limits - Globale Limits setzen
router.put('/limits', setGlobalLimits);

// GET /admin/resources/users/:userId - User-spezifische Limits
router.get('/users/:userId', getUserLimits);

// PUT /admin/resources/users/:userId - User-spezifische Limits setzen
router.put('/users/:userId', setUserLimits);

// POST /admin/resources/workspaces/:id/stop - Admin Force Stop
router.post('/workspaces/:id/stop', forceStopWorkspace);

module.exports = router;
```

---

## 8. Frontend / UI

### 8.1 Neue Views

```
dashboard/src/views/
├── workspaces/
│   ├── index.ejs          # Liste aller Workspaces
│   ├── show.ejs           # Workspace Details & Controls
│   └── ide.ejs            # Full-Screen IDE View
├── previews/
│   └── show.ejs           # Preview Environment Viewer
├── settings/
│   └── api-keys.ejs       # API Key Management
└── admin/
    └── resources.ejs      # Resource Management
```

### 8.2 UI Components

```
dashboard/src/views/components/
├── workspace-card.ejs     # Workspace Status Card
├── workspace-controls.ejs # Start/Stop/Sync Buttons
├── preview-list.ejs       # Preview Environment Liste
└── resource-meter.ejs     # CPU/RAM Anzeige
```

### 8.3 Project Integration

Erweiterung von `dashboard/src/views/projects/show.ejs`:

```html
<!-- Workspace Section -->
<div class="card mt-4">
    <div class="card-header">
        <h5><i class="fas fa-code"></i> Development Workspace</h5>
    </div>
    <div class="card-body">
        <% if (workspace) { %>
            <!-- Workspace existiert -->
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <span class="badge bg-<%= workspace.status === 'running' ? 'success' : 'secondary' %>">
                        <%= workspace.status %>
                    </span>
                    <% if (workspace.status === 'running') { %>
                        <small class="text-muted ms-2">
                            Running since <%= workspace.started_at %>
                        </small>
                    <% } %>
                </div>
                <div>
                    <% if (workspace.status === 'running') { %>
                        <a href="/workspaces/<%= project.name %>/ide"
                           class="btn btn-primary" target="_blank">
                            <i class="fas fa-external-link-alt"></i> Open IDE
                        </a>
                        <button class="btn btn-warning" data-action="stop-workspace">
                            <i class="fas fa-stop"></i> Stop
                        </button>
                    <% } else { %>
                        <button class="btn btn-success" data-action="start-workspace">
                            <i class="fas fa-play"></i> Start Workspace
                        </button>
                    <% } %>
                </div>
            </div>
        <% } else { %>
            <!-- Kein Workspace -->
            <p class="text-muted">No workspace configured for this project.</p>
            <button class="btn btn-outline-primary" data-action="create-workspace">
                <i class="fas fa-plus"></i> Create Workspace
            </button>
        <% } %>
    </div>
</div>
```

---

## 9. Implementierungs-Phasen

> **Hinweis:** Für jede Phase stehen spezialisierte Subagents zur Verfügung.
> Diese befinden sich in `.claude/agents/` und werden automatisch verwendet.

### Automatische Implementierung mit Orchestrator

Der **`workspace-orchestrator`** Agent kann die gesamte Implementierung automatisch durchführen:

```
Aufruf: "Starte den workspace-orchestrator um das Workspaces Feature zu implementieren"
```

Der Orchestrator:
- Führt alle Phasen in der richtigen Reihenfolge aus
- Startet Agents parallel wo möglich
- Prüft Ergebnisse vor dem Fortfahren
- Behandelt Fehler und Abhängigkeiten
- Trackt den Fortschritt mit TodoWrite

**Agents-Übersicht:**

| Agent | Verantwortung |
|-------|--------------|
| `workspace-orchestrator` | Koordiniert alle Agents, führt Plan aus |
| `workspace-database-migrator` | Datenbank-Schema, Migrationen |
| `workspace-docker-builder` | Dockerfile, Entrypoint, Settings |
| `workspace-service-builder` | Backend-Services |
| `workspace-routes-builder` | Express Routes, Middleware |
| `workspace-ui-builder` | EJS Views, i18n |
| `workspace-security-auditor` | Sicherheits-Review |

**Abhängigkeits-Graph:**

```
                    ┌─────────────────────────┐
                    │  workspace-orchestrator │
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       │
┌───────────────┐     ┌─────────────────┐              │
│   database-   │     │  docker-builder │              │
│   migrator    │     │                 │              │
└───────┬───────┘     └────────┬────────┘              │
        │                      │                       │
        └──────────┬───────────┘                       │
                   │                                   │
                   ▼                                   │
        ┌─────────────────────┐                       │
        │  service-builder    │◄──────────────────────┘
        └──────────┬──────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌───────────────┐     ┌───────────────┐
│ routes-builder│     │  ui-builder   │
└───────┬───────┘     └───────┬───────┘
        │                     │
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │  security-auditor   │
        └─────────────────────┘
```

### Phase 1: Foundation (Basis)

**Ziel:** Grundlegende Infrastruktur

**Zu verwendende Agents:**
- `workspace-database-migrator` → Task 1.1
- `workspace-docker-builder` → Task 1.2
- `workspace-service-builder` → Tasks 1.3, 1.4, 1.5

| Task | Beschreibung | Dateien | Agent |
|------|--------------|---------|-------|
| 1.1 | Datenbank-Schema erstellen | `config/database.js` | `workspace-database-migrator` |
| 1.2 | Docker Image bauen | `docker/workspace/Dockerfile` | `workspace-docker-builder` |
| 1.3 | Encryption Service | `services/encryption.js` | `workspace-service-builder` |
| 1.4 | Basis Workspace Service | `services/workspace.js` | `workspace-service-builder` |
| 1.5 | Port Manager Service | `services/portManager.js` | `workspace-service-builder` |

**Akzeptanzkriterien:**
- [ ] Tabellen werden bei Start erstellt
- [ ] Docker Image baut erfolgreich
- [ ] Encryption funktioniert (Unit Tests)
- [ ] Workspace kann erstellt werden (DB-Eintrag)

### Phase 2: Core Workspace

**Ziel:** Workspace Lifecycle funktioniert

**Zu verwendende Agents:**
- `workspace-service-builder` → Tasks 2.1-2.3, 2.6
- `workspace-routes-builder` → Task 2.4
- `workspace-ui-builder` → Task 2.5

| Task | Beschreibung | Dateien | Agent |
|------|--------------|---------|-------|
| 2.1 | Container Start/Stop | `services/workspace.js` | `workspace-service-builder` |
| 2.2 | Port Management | `services/portManager.js` | `workspace-service-builder` |
| 2.3 | Network Isolation | `services/workspace.js` | `workspace-service-builder` |
| 2.4 | Workspace Routes | `routes/workspaces.js` | `workspace-routes-builder` |
| 2.5 | Workspace Views | `views/workspaces/*` | `workspace-ui-builder` |
| 2.6 | Idle Timeout Cron | `services/workspace.js` | `workspace-service-builder` |

**Akzeptanzkriterien:**
- [ ] Workspace startet und stoppt korrekt
- [ ] code-server ist erreichbar
- [ ] Resource Limits werden angewendet
- [ ] Idle Timeout funktioniert

### Phase 3: Integration

**Ziel:** Nahtlose Integration mit Projekten

**Zu verwendende Agents:**
- `workspace-service-builder` → Tasks 3.1, 3.2
- `workspace-routes-builder` → Task 3.3
- `workspace-docker-builder` → Task 3.4
- `workspace-ui-builder` → Task 3.5

| Task | Beschreibung | Dateien | Agent |
|------|--------------|---------|-------|
| 3.1 | Projekt-Workspace Sync | `services/workspace.js` | `workspace-service-builder` |
| 3.2 | Datenbank-Anbindung | `services/workspace.js` | `workspace-service-builder` |
| 3.3 | API Key Management | `services/encryption.js`, `routes/api-keys.js` | `workspace-routes-builder` |
| 3.4 | Claude Code Setup | `docker/workspace/entrypoint.sh` | `workspace-docker-builder` |
| 3.5 | Project View Integration | `views/projects/show.ejs` | `workspace-ui-builder` |

**Akzeptanzkriterien:**
- [ ] Sync to/from Project funktioniert
- [ ] DB Credentials werden injiziert
- [ ] Claude Code ist nutzbar
- [ ] Workspace von Project-Seite startbar

### Phase 4: Preview Environments

**Ziel:** Temporäre Deployments

**Zu verwendende Agents:**
- `workspace-service-builder` → Tasks 4.1, 4.3, 4.4
- `workspace-routes-builder` → Task 4.2
- `workspace-ui-builder` → Task 4.5

| Task | Beschreibung | Dateien | Agent |
|------|--------------|---------|-------|
| 4.1 | Preview Service | `services/preview.js` | `workspace-service-builder` |
| 4.2 | Preview Routes | `routes/workspaces.js` | `workspace-routes-builder` |
| 4.3 | Preview Container | `services/preview.js` | `workspace-service-builder` |
| 4.4 | Auto-Cleanup Cron | `services/preview.js` | `workspace-service-builder` |
| 4.5 | Preview UI | `views/workspaces/*` | `workspace-ui-builder` |
| 4.6 | NPM Integration (optional) | `services/proxy.js` | - |

**Akzeptanzkriterien:**
- [ ] Preview aus Workspace erstellbar
- [ ] Eindeutige, temporäre URL
- [ ] Auto-Expiration funktioniert
- [ ] Optional: SSL via NPM

### Phase 5: Admin & Polish

**Ziel:** Vollständige Verwaltung

**Zu verwendende Agents:**
- `workspace-ui-builder` → Tasks 5.1, 5.4
- `workspace-routes-builder` → Task 5.2
- `workspace-service-builder` → Task 5.3
- `i18n-translator` → Task 5.4 (Übersetzungsprüfung)

| Task | Beschreibung | Dateien | Agent |
|------|--------------|---------|-------|
| 5.1 | Admin Resource Dashboard | `views/admin/resources.ejs` | `workspace-ui-builder` |
| 5.2 | User Limit Management | `routes/admin/resources.js` | `workspace-routes-builder` |
| 5.3 | Workspace Activity Logs | `services/workspace.js` | `workspace-service-builder` |
| 5.4 | i18n Integration | `locales/*/workspaces.json` | `workspace-ui-builder`, `i18n-translator` |
| 5.5 | Documentation | `docs/workspaces.md` | - |
| 5.6 | Error Handling & Edge Cases | Alle Services | - |

**Akzeptanzkriterien:**
- [ ] Admin kann alle Workspaces sehen/stoppen
- [ ] Resource Limits pro User konfigurierbar
- [ ] Vollständige Übersetzungen
- [ ] Dokumentation komplett

### Phase 6: Security Review

**Ziel:** Sicherheitsüberprüfung vor Release

**Zu verwendende Agents:**
- `workspace-security-auditor` → Komplette Phase

| Task | Beschreibung | Agent |
|------|--------------|-------|
| 6.1 | Code Review aller Services | `workspace-security-auditor` |
| 6.2 | Container Security Check | `workspace-security-auditor` |
| 6.3 | Encryption Audit | `workspace-security-auditor` |
| 6.4 | Auth/Authz Audit | `workspace-security-auditor` |
| 6.5 | OWASP Top 10 Check | `workspace-security-auditor` |
| 6.6 | Fixes implementieren | Alle relevanten Agents |

**Akzeptanzkriterien:**
- [ ] Keine Critical/High Findings offen
- [ ] Security Report dokumentiert
- [ ] Alle Fixes implementiert und verifiziert

---

## 10. Testing Strategy

### 10.1 Unit Tests

```javascript
// tests/services/workspace.test.js
describe('Workspace Service', () => {
    describe('createWorkspace', () => {
        it('should create workspace record in database', async () => {});
        it('should respect resource limits', async () => {});
        it('should fail if max workspaces reached', async () => {});
    });

    describe('startWorkspace', () => {
        it('should start container with correct config', async () => {});
        it('should inject API key as environment variable', async () => {});
        it('should update status to running', async () => {});
    });

    // ...
});

// tests/services/encryption.test.js
describe('Encryption Service', () => {
    it('should encrypt and decrypt correctly', () => {});
    it('should use unique IV for each encryption', () => {});
    it('should fail on tampered data (auth tag)', () => {});
});
```

### 10.2 Integration Tests

```javascript
// tests/integration/workspace.test.js
describe('Workspace Integration', () => {
    it('should create, start, and stop workspace', async () => {});
    it('should sync files between workspace and project', async () => {});
    it('should cleanup on idle timeout', async () => {});
});
```

### 10.3 E2E Tests

```javascript
// tests/e2e/workspace.test.js
describe('Workspace E2E', () => {
    it('should open IDE in browser', async () => {});
    it('should allow code editing and saving', async () => {});
    it('should deploy to project successfully', async () => {});
});
```

---

## 11. Monitoring & Logging

### 11.1 Log Events

```javascript
// Zu loggende Events
const LOG_EVENTS = {
    WORKSPACE_CREATED: 'workspace.created',
    WORKSPACE_STARTED: 'workspace.started',
    WORKSPACE_STOPPED: 'workspace.stopped',
    WORKSPACE_DELETED: 'workspace.deleted',
    WORKSPACE_TIMEOUT: 'workspace.timeout',
    WORKSPACE_ERROR: 'workspace.error',
    SYNC_TO_PROJECT: 'workspace.sync.to_project',
    SYNC_FROM_PROJECT: 'workspace.sync.from_project',
    PREVIEW_CREATED: 'preview.created',
    PREVIEW_EXPIRED: 'preview.expired',
    API_KEY_UPDATED: 'api_key.updated'
};
```

### 11.2 Metriken (Future)

```javascript
// Für späteres Monitoring
const METRICS = {
    active_workspaces: 'gauge',
    workspace_start_duration: 'histogram',
    workspace_memory_usage: 'gauge',
    preview_count: 'gauge'
};
```

---

## 12. Konfiguration

### 12.1 Environment Variables

```bash
# .env Erweiterung für Workspaces

# ============================================================
# WORKSPACE CONFIGURATION
# ============================================================

# Enable/Disable Workspaces Feature
WORKSPACES_ENABLED=true

# Docker Image für Workspaces
WORKSPACE_IMAGE=dployr-workspace:latest

# Default Resource Limits
WORKSPACE_DEFAULT_CPU=1
WORKSPACE_DEFAULT_RAM=2g
WORKSPACE_DEFAULT_DISK=10g

# Timeouts
WORKSPACE_IDLE_TIMEOUT_MINUTES=30
WORKSPACE_MAX_LIFETIME_HOURS=24

# Maximum Workspaces
WORKSPACE_MAX_PER_USER=2
WORKSPACE_MAX_TOTAL=6

# Port Range für Workspaces
WORKSPACE_PORT_RANGE_START=10000
WORKSPACE_PORT_RANGE_END=10100

# ============================================================
# PREVIEW CONFIGURATION
# ============================================================

# Enable/Disable Previews
PREVIEWS_ENABLED=true

# Default Preview Lifetime
PREVIEW_DEFAULT_LIFETIME_HOURS=24

# Maximum Previews per Workspace
PREVIEW_MAX_PER_WORKSPACE=3

# Preview URL Pattern (falls NPM)
PREVIEW_URL_PATTERN=preview-{hash}.{domain}
```

### 12.2 Setup Wizard Erweiterung

Neuer Schritt im Setup Wizard für Workspace-Konfiguration:

1. Enable/Disable Workspaces
2. Resource Defaults
3. Maximum Limits
4. Port Range

---

## 13. Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Auswirkung | Mitigation |
|--------|-------------------|------------|------------|
| Resource Exhaustion | Mittel | Hoch | Strikte Limits, Idle Timeout |
| Container Escape | Niedrig | Kritisch | Security Context, Updates |
| API Key Leak | Niedrig | Hoch | Encryption, Memory-only |
| Sync Conflicts | Mittel | Mittel | Clear Sync Direction, Backup |
| Port Conflicts | Niedrig | Mittel | Dynamic Port Allocation |
| Disk Space | Mittel | Mittel | Disk Quotas, Cleanup |

---

## 14. Offene Punkte

- [ ] WebSocket Proxy für code-server Terminal
- [ ] Git Credentials im Workspace (SSH Keys?)
- [ ] Multi-User Collaboration (Future)
- [ ] Workspace Templates (vorkonfigurierte Umgebungen)
- [ ] Metriken & Dashboard für Ressourcen
- [ ] Backup von Workspace-Zuständen

---

## 15. Referenzen

- [code-server Documentation](https://coder.com/docs/code-server)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Node.js Crypto Module](https://nodejs.org/api/crypto.html)
- [Claude Code Documentation](https://docs.anthropic.com/claude-code)

---

---

## 16. Fehlende Integrationen (Nachtrag nach Code-Review)

Nach gründlicher Analyse des bestehenden Codes ergeben sich folgende zusätzliche Anforderungen:

### 16.1 Helmet CSP Update

Die Content Security Policy muss für code-server iframe angepasst werden:

```javascript
// app.js - Helmet Konfiguration erweitern
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            // ... bestehende Direktiven ...
            // NEU: Workspace iframes erlauben
            frameSrc: ["'self'", "http://localhost:*", "https://localhost:*"],
            // NEU: WebSocket für code-server Terminal
            connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"],
        }
    },
    // ... rest
}));
```

### 16.2 WebSocket Proxy für code-server

code-server nutzt WebSockets für das Terminal. Das Dashboard muss diese proxyen:

```javascript
// app.js - WebSocket Proxy hinzufügen
const { createProxyMiddleware } = require('http-proxy-middleware');

// Workspace WebSocket Proxy
app.use('/workspaces/:projectName/ws', createProxyMiddleware({
    target: 'dynamic', // wird pro Request ermittelt
    ws: true,
    router: async (req) => {
        const workspace = await workspaceService.getWorkspace(
            req.session.user.id,
            req.params.projectName
        );
        return `http://localhost:${workspace.assigned_port}`;
    },
    changeOrigin: true
}));
```

**Neue Dependency:**
```bash
npm install http-proxy-middleware
```

### 16.3 Navigation Update (layout.ejs)

Neuer Nav-Eintrag nach "Backups":

```html
<li class="nav-item">
    <a class="nav-link" href="/workspaces">
        <i class="bi bi-code-square"></i> <%= t('common:nav.workspaces') %>
    </a>
</li>
```

### 16.4 i18n Locale Files

**Neue Dateien erstellen:**

`dashboard/src/locales/de/workspaces.json`:
```json
{
    "nav": "Workspaces",
    "title": "Entwicklungsumgebungen",
    "create": {
        "title": "Workspace erstellen",
        "button": "Workspace erstellen"
    },
    "status": {
        "stopped": "Gestoppt",
        "starting": "Startet...",
        "running": "Läuft",
        "stopping": "Stoppt...",
        "error": "Fehler"
    },
    "actions": {
        "start": "Starten",
        "stop": "Stoppen",
        "openIDE": "IDE öffnen",
        "syncToProject": "Zum Projekt synchronisieren",
        "syncFromProject": "Vom Projekt aktualisieren",
        "delete": "Löschen"
    },
    "preview": {
        "title": "Preview Environments",
        "create": "Preview erstellen",
        "expires": "Läuft ab",
        "extend": "Verlängern",
        "copyUrl": "URL kopieren"
    },
    "settings": {
        "apiKey": "Claude API Key",
        "apiKeyHint": "Dein Anthropic API Key für Claude Code",
        "resourceLimits": "Ressourcen-Limits"
    },
    "errors": {
        "notFound": "Workspace nicht gefunden",
        "startFailed": "Workspace konnte nicht gestartet werden",
        "maxReached": "Maximale Anzahl Workspaces erreicht",
        "noApiKey": "Kein API Key konfiguriert"
    },
    "messages": {
        "created": "Workspace erstellt",
        "started": "Workspace gestartet",
        "stopped": "Workspace gestoppt",
        "deleted": "Workspace gelöscht",
        "synced": "Synchronisierung abgeschlossen"
    }
}
```

`dashboard/src/locales/en/workspaces.json`:
```json
{
    "nav": "Workspaces",
    "title": "Development Environments",
    "create": {
        "title": "Create Workspace",
        "button": "Create Workspace"
    },
    "status": {
        "stopped": "Stopped",
        "starting": "Starting...",
        "running": "Running",
        "stopping": "Stopping...",
        "error": "Error"
    },
    "actions": {
        "start": "Start",
        "stop": "Stop",
        "openIDE": "Open IDE",
        "syncToProject": "Sync to Project",
        "syncFromProject": "Sync from Project",
        "delete": "Delete"
    },
    "preview": {
        "title": "Preview Environments",
        "create": "Create Preview",
        "expires": "Expires",
        "extend": "Extend",
        "copyUrl": "Copy URL"
    },
    "settings": {
        "apiKey": "Claude API Key",
        "apiKeyHint": "Your Anthropic API key for Claude Code",
        "resourceLimits": "Resource Limits"
    },
    "errors": {
        "notFound": "Workspace not found",
        "startFailed": "Failed to start workspace",
        "maxReached": "Maximum number of workspaces reached",
        "noApiKey": "No API key configured"
    },
    "messages": {
        "created": "Workspace created",
        "started": "Workspace started",
        "stopped": "Workspace stopped",
        "deleted": "Workspace deleted",
        "synced": "Synchronization complete"
    }
}
```

**i18n Config Update** (`config/i18n.js`):
```javascript
ns: ['common', 'auth', 'projects', /* ... */, 'workspaces'],
```

### 16.5 Validation Schemas (middleware/validation.js)

```javascript
// Workspace Schemas
createWorkspace: Joi.object({
    projectName: Joi.string()
        .pattern(/^[a-z0-9-]+$/)
        .required()
}),

updateWorkspaceSettings: Joi.object({
    cpu_limit: Joi.string()
        .pattern(/^[0-9.]+$/)
        .optional(),
    ram_limit: Joi.string()
        .pattern(/^[0-9]+[mg]$/i)
        .optional(),
    idle_timeout_minutes: Joi.number()
        .integer()
        .min(5)
        .max(480)
        .optional()
}),

setApiKey: Joi.object({
    provider: Joi.string()
        .valid('anthropic', 'openai')
        .required(),
    api_key: Joi.string()
        .min(20)
        .max(200)
        .required()
}),

createPreview: Joi.object({
    lifetime_hours: Joi.number()
        .integer()
        .min(1)
        .max(168) // max 1 week
        .default(24),
    password: Joi.string()
        .min(4)
        .max(50)
        .optional()
})
```

### 16.6 Constants Update (config/constants.js)

```javascript
// Workspace Status
const WORKSPACE_STATUS = {
    STOPPED: 'stopped',
    STARTING: 'starting',
    RUNNING: 'running',
    STOPPING: 'stopping',
    ERROR: 'error'
};

// Default Resource Limits
const DEFAULT_WORKSPACE_LIMITS = {
    cpu: '1',
    ram: '2g',
    disk: '10g',
    idleTimeout: 30,  // minutes
    maxLifetime: 24   // hours
};

// Port Range for Workspaces
const WORKSPACE_PORT_RANGE = {
    start: 10000,
    end: 10100
};

// Preview Status
const PREVIEW_STATUS = {
    CREATING: 'creating',
    RUNNING: 'running',
    STOPPING: 'stopping',
    STOPPED: 'stopped',
    EXPIRED: 'expired',
    ERROR: 'error'
};

module.exports = {
    // ... bestehende exports
    WORKSPACE_STATUS,
    DEFAULT_WORKSPACE_LIMITS,
    WORKSPACE_PORT_RANGE,
    PREVIEW_STATUS
};
```

### 16.7 Deploy Script Update (deploy.sh)

Workspace Docker Image beim Deploy bauen:

```bash
# In do_deploy() nach Dashboard Build hinzufügen:

if [ "$JSON_OUTPUT" = true ]; then
    echo "{\"status\":\"building\",\"step\":\"workspace-image\"}"
else
    echo "Building workspace image..."
fi

# Build workspace image if Dockerfile exists
if [ -f "docker/workspace/Dockerfile" ]; then
    docker build -t dployr-workspace:latest ./docker/workspace
fi
```

### 16.8 Middleware: workspaceAccess.js

Neue Middleware für Workspace-Zugriff (basiert auf projectAccess):

```javascript
// dashboard/src/middleware/workspaceAccess.js

const workspaceService = require('../services/workspace');
const { getProjectAccess } = require('./projectAccess');

/**
 * Middleware: Check workspace access
 * Kombiniert Project-Access mit Workspace-Existenz
 */
function getWorkspaceAccess(paramName = 'projectName') {
    return [
        // Erst Project-Zugriff prüfen
        getProjectAccess(paramName),
        // Dann Workspace laden
        async (req, res, next) => {
            try {
                const workspace = await workspaceService.getWorkspace(
                    req.session.user.id,
                    req.params[paramName]
                );
                req.workspace = workspace; // kann null sein
                next();
            } catch (error) {
                req.flash('error', req.t('workspaces:errors.notFound'));
                return res.redirect('/workspaces');
            }
        }
    ];
}

/**
 * Require workspace to exist
 */
function requireWorkspace(req, res, next) {
    if (!req.workspace) {
        req.flash('error', req.t('workspaces:errors.notFound'));
        return res.redirect(`/projects/${req.params.projectName}`);
    }
    next();
}

/**
 * Require workspace to be running
 */
function requireRunningWorkspace(req, res, next) {
    if (!req.workspace || req.workspace.status !== 'running') {
        req.flash('error', req.t('workspaces:errors.notRunning'));
        return res.redirect(`/workspaces/${req.params.projectName}`);
    }
    next();
}

module.exports = {
    getWorkspaceAccess,
    requireWorkspace,
    requireRunningWorkspace
};
```

### 16.9 Dashboard Integration

Workspace-Status auf der Hauptseite anzeigen (`views/dashboard.ejs`):

```html
<!-- Active Workspaces Section -->
<% if (activeWorkspaces && activeWorkspaces.length > 0) { %>
<div class="card d-elevated mb-4">
    <div class="card-header">
        <h5 class="mb-0">
            <i class="bi bi-code-square"></i>
            <%= t('workspaces:title') %>
            <span class="badge bg-success ms-2"><%= activeWorkspaces.length %></span>
        </h5>
    </div>
    <div class="card-body">
        <% activeWorkspaces.forEach(ws => { %>
        <div class="d-flex justify-content-between align-items-center mb-2">
            <span><%= ws.project_name %></span>
            <div>
                <span class="badge bg-success-subtle text-success me-2">
                    <%= t('workspaces:status.running') %>
                </span>
                <a href="/workspaces/<%= ws.project_name %>/ide"
                   class="btn btn-sm btn-primary" target="_blank">
                    <i class="bi bi-box-arrow-up-right"></i> IDE
                </a>
            </div>
        </div>
        <% }); %>
    </div>
</div>
<% } %>
```

### 16.10 Graceful Shutdown

Workspaces bei Server-Restart sauber handhaben:

```javascript
// app.js - Shutdown Handler erweitern
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');

    // Alle laufenden Workspaces in "stopping" Status setzen
    // (Container werden NICHT gestoppt, da sie unabhängig laufen)
    await workspaceService.markAllAsStopping();

    // ... bestehender Shutdown Code
});
```

### 16.11 Email Notifications (optional)

Benachrichtigungen für Workspace-Events:

```javascript
// services/workspace.js - Bei Timeout
async function handleIdleTimeout(workspace) {
    await stopWorkspace(workspace.user_id, workspace.project_name);

    // Optional: Email senden
    if (user.notify_workspace_timeout) {
        await emailService.sendWorkspaceTimeoutNotification(
            user.email,
            workspace.project_name
        );
    }
}
```

### 16.12 Rate Limiting für Workspace-Aktionen

```javascript
// app.js - Neuer Rate Limiter
const workspaceLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // 10 actions per minute
    message: { error: 'Too many workspace operations. Please try again later.' }
});

// Anwenden auf Workspace-Mutations-Routes
app.use('/workspaces/:projectName/start', workspaceLimiter);
app.use('/workspaces/:projectName/stop', workspaceLimiter);
app.use('/workspaces/:projectName/sync', workspaceLimiter);
```

### 16.13 Backup Integration

Workspace-Daten werden NICHT separat gebackupt - sie teilen sich die Dateien mit dem Projekt. Das Projekt-Backup enthält somit automatisch alle Workspace-Änderungen nach einem Sync.

**Wichtig:** Vor einem Restore sollte der Workspace gestoppt werden.

```javascript
// services/backup.js - Erweiterung
async function restoreProject(backupId) {
    // Check if workspace is running
    const workspace = await workspaceService.getWorkspace(userId, projectName);
    if (workspace && workspace.status === 'running') {
        throw new Error('Please stop the workspace before restoring');
    }

    // ... bestehender Restore Code
}
```

### 16.14 Docker Network

Workspace-Container müssen im `dployr-network` sein für DB-Zugriff:

```javascript
// services/workspace.js - Container erstellen
const container = await docker.createContainer({
    // ... andere Optionen
    NetworkingConfig: {
        EndpointsConfig: {
            'dployr-network': {}
        }
    }
});
```

### 16.15 Port Allocation Service

Dynamische Port-Vergabe um Konflikte zu vermeiden:

```javascript
// services/portManager.js
const { pool } = require('../config/database');

const PORT_RANGE = { start: 10000, end: 10100 };

async function allocatePort() {
    // Finde alle genutzten Ports
    const [rows] = await pool.query(
        'SELECT assigned_port FROM workspaces WHERE assigned_port IS NOT NULL'
    );
    const usedPorts = new Set(rows.map(r => r.assigned_port));

    // Finde freien Port
    for (let port = PORT_RANGE.start; port <= PORT_RANGE.end; port++) {
        if (!usedPorts.has(port)) {
            return port;
        }
    }

    throw new Error('No available ports in range');
}

async function releasePort(port) {
    // Port wird automatisch freigegeben wenn Workspace gelöscht wird
    // (assigned_port = NULL bei Stop)
}

module.exports = { allocatePort, releasePort };
```

---

## 17. Aktualisierte Datei-Übersicht

### Neue Dateien

```
dashboard/
├── src/
│   ├── services/
│   │   ├── workspace.js       # Workspace Lifecycle
│   │   ├── preview.js         # Preview Environments
│   │   ├── encryption.js      # API Key Encryption
│   │   └── portManager.js     # Port Allocation
│   ├── routes/
│   │   ├── workspaces.js      # Workspace Routes
│   │   └── api-keys.js        # API Key Management
│   ├── middleware/
│   │   └── workspaceAccess.js # Access Control
│   ├── views/
│   │   ├── workspaces/
│   │   │   ├── index.ejs      # Liste
│   │   │   ├── show.ejs       # Details
│   │   │   └── ide.ejs        # IDE Container
│   │   └── settings/
│   │       └── api-keys.ejs   # Key Management
│   └── locales/
│       ├── de/workspaces.json
│       └── en/workspaces.json
│
docker/
└── workspace/
    ├── Dockerfile
    ├── entrypoint.sh
    └── workspace-settings.json
```

### Zu ändernde Dateien

```
dashboard/src/
├── app.js                 # Routes, WebSocket Proxy, Helmet CSP
├── config/
│   ├── database.js        # Neue Tabellen
│   ├── constants.js       # Neue Konstanten
│   └── i18n.js            # Namespace registrieren
├── middleware/
│   └── validation.js      # Neue Schemas
├── views/
│   ├── layout.ejs         # Navigation
│   ├── dashboard.ejs      # Workspace Status
│   └── projects/show.ejs  # Workspace Button
└── routes/
    └── admin.js           # Resource Management

deploy.sh                  # Workspace Image Build
docker-compose.yml         # (optional) Workspace Volume
.env.example               # Neue ENV Variablen
```

---

## 18. Weitere wichtige Aspekte

### 18.1 Shared Projects & Workspaces

**Wichtige Entscheidung:** Wie verhält sich das Workspace-System bei geteilten Projekten?

**Empfehlung:**
- **Ein Workspace pro Projekt** (nicht pro User)
- Der Workspace gehört dem Projekt-Owner
- Shared Users mit `manage` oder `full` Permission können den Workspace starten/stoppen
- Shared Users mit `read` Permission können den Workspace NICHT nutzen (nur Projekt ansehen)

```javascript
// workspaceAccess.js - Berechtigung prüfen
function requireWorkspacePermission(req, res, next) {
    const access = req.projectAccess;

    // Owner hat immer Zugriff
    if (access.isOwner) return next();

    // Shared: mindestens 'manage' für Workspace-Nutzung
    if (access.permission === 'manage' || access.permission === 'full') {
        return next();
    }

    req.flash('error', req.t('workspaces:errors.noPermission'));
    return res.redirect(`/projects/${req.params.projectName}`);
}
```

### 18.2 Container Cleanup (Orphan Protection)

Was passiert wenn das Dashboard abstürzt oder Container verwaisen?

**Startup Cleanup:**
```javascript
// services/workspace.js - Bei App-Start ausführen
async function cleanupOrphanedWorkspaces() {
    // 1. Alle Workspaces in DB mit status 'running' oder 'starting' finden
    const [workspaces] = await pool.query(
        "SELECT * FROM workspaces WHERE status IN ('running', 'starting')"
    );

    for (const ws of workspaces) {
        try {
            // 2. Prüfen ob Container noch existiert
            const container = docker.getContainer(ws.container_id);
            const info = await container.inspect();

            if (info.State.Running) {
                // Container läuft - Status OK
                continue;
            } else {
                // Container existiert aber läuft nicht
                await pool.query(
                    'UPDATE workspaces SET status = ?, container_id = NULL WHERE id = ?',
                    ['stopped', ws.id]
                );
            }
        } catch (error) {
            // Container existiert nicht mehr
            await pool.query(
                'UPDATE workspaces SET status = ?, container_id = NULL WHERE id = ?',
                ['stopped', ws.id]
            );
        }
    }

    logger.info('Orphaned workspace cleanup completed');
}

// In app.js beim Start aufrufen
workspaceService.cleanupOrphanedWorkspaces();
```

**Periodischer Cleanup (alle 5 Minuten):**
```javascript
setInterval(async () => {
    await cleanupOrphanedWorkspaces();
}, 5 * 60 * 1000);
```

### 18.3 Container Naming Convention

Um Container eindeutig zu identifizieren und Konflikte zu vermeiden:

```
dployr-ws-{userId}-{projectName}
```

Beispiel: `dployr-ws-5-my-project`

```javascript
function getContainerName(userId, projectName) {
    return `dployr-ws-${userId}-${projectName}`;
}
```

### 18.4 Volume Handling

Workspaces teilen sich die Projekt-Dateien. Es gibt zwei Ansätze:

**Option A: Shared Volume (Empfohlen)**
- Workspace und Projekt nutzen das gleiche `/html` Verzeichnis
- Änderungen sind sofort in beiden sichtbar
- Kein expliziter Sync nötig
- **Nachteil:** Gleichzeitige Bearbeitung kann zu Konflikten führen

**Option B: Separate Volumes mit Sync**
- Workspace hat eigenes Working Directory
- Expliziter Sync-Schritt nötig
- **Vorteil:** Isolation, keine unbeabsichtigten Änderungen am Projekt

**Empfehlung: Option A mit Warnung**
```javascript
// Beim Projekt-Start prüfen ob Workspace läuft
async function startProject(userId, projectName) {
    const workspace = await getWorkspace(userId, projectName);
    if (workspace && workspace.status === 'running') {
        throw new Error('Cannot start project while workspace is running. Please stop the workspace first.');
    }
    // ... normaler Start
}
```

### 18.5 Git in Workspaces

Wenn das Projekt ein Git-Repository ist:

```javascript
// Workspace Container Environment
const env = {
    // Git-Konfiguration (falls User diese hat)
    GIT_USER_NAME: user.git_name || user.username,
    GIT_USER_EMAIL: user.email || `${user.username}@dployr.local`,
    // ... andere ENV
};
```

**Git Credentials:**
- SSH Keys: User kann eigenen SSH Key im Workspace hinterlegen
- HTTPS: Personal Access Token als ENV Variable
- **Sicherheit:** Credentials nur im Memory, nicht persistent speichern

### 18.6 File Size Limits

Workspace-Dateien sollten limitiert werden:

```javascript
// constants.js
const WORKSPACE_FILE_LIMITS = {
    maxFileSize: 50 * 1024 * 1024,    // 50 MB pro Datei
    maxTotalSize: 5 * 1024 * 1024 * 1024, // 5 GB total
};
```

### 18.7 Concurrent Access Warning

Wenn mehrere User (durch Sharing) gleichzeitig den Workspace nutzen wollen:

```javascript
// Beim IDE-Zugriff prüfen
async function accessIDE(req, res) {
    const workspace = req.workspace;

    // Prüfen ob jemand anders gerade aktiv ist (last_activity < 5 min)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (workspace.last_activity > fiveMinAgo &&
        workspace.last_accessed_by !== req.session.user.id) {

        // Warnung anzeigen, aber Zugriff erlauben
        req.flash('warning', req.t('workspaces:warnings.concurrentAccess'));
    }

    // Update last_accessed_by
    await pool.query(
        'UPDATE workspaces SET last_accessed_by = ? WHERE id = ?',
        [req.session.user.id, workspace.id]
    );

    // ... IDE rendern
}
```

### 18.8 Logging & Audit Trail

Alle Workspace-Aktionen sollten geloggt werden:

```javascript
async function logWorkspaceAction(workspaceId, userId, action, details = {}) {
    await pool.query(
        `INSERT INTO workspace_logs (workspace_id, user_id, project_name, action, details)
         VALUES (?, ?, ?, ?, ?)`,
        [workspaceId, userId, projectName, action, JSON.stringify(details)]
    );
}

// Beispiel-Aufrufe
await logWorkspaceAction(ws.id, userId, 'start', { port: assignedPort });
await logWorkspaceAction(ws.id, userId, 'stop', { reason: 'manual' });
await logWorkspaceAction(ws.id, userId, 'timeout', { idleMinutes: 30 });
await logWorkspaceAction(ws.id, userId, 'sync_to_project', { files: changedFiles.length });
```

### 18.9 Feature Flag

Workspaces als Feature-Flag um schrittweises Rollout zu ermöglichen:

```bash
# .env
WORKSPACES_ENABLED=true
```

```javascript
// middleware/featureFlags.js
function requireWorkspacesEnabled(req, res, next) {
    if (process.env.WORKSPACES_ENABLED !== 'true') {
        req.flash('error', 'Workspaces feature is not enabled');
        return res.redirect('/dashboard');
    }
    next();
}

// In routes/workspaces.js
router.use(requireWorkspacesEnabled);
```

### 18.10 Admin Force-Stop

Admin muss jeden Workspace stoppen können (z.B. bei Missbrauch):

```javascript
// routes/admin/resources.js
router.post('/workspaces/:id/force-stop', isAdmin, async (req, res) => {
    const workspaceId = req.params.id;

    await workspaceService.forceStopWorkspace(workspaceId);
    await logWorkspaceAction(workspaceId, req.session.user.id, 'admin_force_stop', {
        admin: req.session.user.username
    });

    res.json({ success: true });
});
```

---

## 19. Risiko-Matrix (Aktualisiert)

| Risiko | Wahrscheinlichkeit | Auswirkung | Mitigation |
|--------|-------------------|------------|------------|
| Resource Exhaustion | Mittel | Hoch | Strikte Limits, Idle Timeout, Max Workspaces |
| Container Escape | Niedrig | Kritisch | Security Context, Updates, kein Docker-in-Docker |
| API Key Leak | Niedrig | Hoch | AES-256-GCM, Memory-only, Audit Logs |
| Sync Conflicts | Mittel | Mittel | Option A: Warnung bei gleichzeitigem Zugriff |
| Port Conflicts | Niedrig | Mittel | Dynamic Port Allocation, Port Manager Service |
| Orphaned Containers | Mittel | Niedrig | Startup Cleanup, Periodic Check |
| Disk Space | Mittel | Mittel | Disk Quotas, File Size Limits |
| Concurrent Edit Conflicts | Mittel | Niedrig | Last-accessed-by Tracking, Warnung |
| Missbrauch (Mining, etc.) | Niedrig | Hoch | Resource Limits, Admin Force-Stop, Monitoring |

---

## 20. Zusammenfassung der Änderungen

Der Plan wurde nach gründlicher Code-Review erweitert um:

1. **Helmet CSP Update** für iframe-Einbettung
2. **WebSocket Proxy** für code-server Terminal
3. **i18n Locale Files** (de/en)
4. **Validation Schemas** für alle Inputs
5. **workspaceAccess Middleware** basierend auf projectAccess
6. **Port Allocation Service** für dynamische Port-Vergabe
7. **Shared Project Handling** - ein Workspace pro Projekt
8. **Orphan Container Cleanup** bei Start und periodisch
9. **Container Naming Convention**
10. **Volume Handling Strategy** (Shared Volume empfohlen)
11. **Git Integration** im Workspace
12. **File Size Limits**
13. **Concurrent Access Warning**
14. **Audit Trail** für alle Aktionen
15. **Feature Flag** für schrittweises Rollout
16. **Admin Force-Stop** für Notfälle

---

## Changelog

| Datum | Version | Änderung |
|-------|---------|----------|
| 2026-01-08 | 1.0 | Initial Draft |
| 2026-01-08 | 1.1 | Ergänzung nach Code-Review: CSP, WebSocket, i18n, Validation, Middleware, Port Management |
| 2026-01-08 | 1.2 | Weitere Aspekte: Sharing, Cleanup, Volumes, Git, Concurrent Access, Audit, Feature Flags |
| 2026-01-08 | 1.3 | Subagents in Implementierungsphasen integriert, Phase 6 (Security Review) hinzugefügt |
| 2026-01-08 | 1.4 | Orchestrator Agent hinzugefügt für automatische Implementierung aller Phasen |
