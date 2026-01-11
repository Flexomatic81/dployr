#!/bin/bash
# entrypoint.sh - Workspace Container Startup

set -e

# ============================================================
# Fix Permissions (running as root)
# ============================================================

# Ensure workspace directory exists and is owned by coder
mkdir -p /workspace
chown -R coder:coder /workspace

# ============================================================
# Environment Setup
# ============================================================

# Setup Claude Code if API key provided
if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "Claude Code: API Key configured"
fi

# Database connection info (if provided)
if [ -n "$DATABASE_URL" ]; then
    echo "Database: Connection configured"
fi

# ============================================================
# Git Configuration (if provided)
# ============================================================

if [ -n "$GIT_USER_NAME" ]; then
    gosu coder git config --global user.name "$GIT_USER_NAME"
fi

if [ -n "$GIT_USER_EMAIL" ]; then
    gosu coder git config --global user.email "$GIT_USER_EMAIL"
fi

# ============================================================
# VS Code Language Configuration
# ============================================================

# Set VS Code display language based on VSCODE_LOCALE env var
if [ -n "$VSCODE_LOCALE" ]; then
    ARGV_JSON_DIR="/home/coder/.local/share/code-server/User"
    ARGV_JSON="$ARGV_JSON_DIR/argv.json"

    # Ensure parent directories exist (running as root)
    mkdir -p /home/coder/.local/share/code-server/User
    echo "{\"locale\": \"$VSCODE_LOCALE\"}" > "$ARGV_JSON"
    chown -R coder:coder /home/coder/.local

    echo "VS Code: Language set to $VSCODE_LOCALE"
fi

# ============================================================
# Start code-server as coder user
# ============================================================

# No authentication - access is controlled by the dashboard proxy
# The workspace container is only accessible via internal Docker network

exec gosu coder code-server \
    --bind-addr 0.0.0.0:8080 \
    --auth none \
    --disable-telemetry \
    /workspace
