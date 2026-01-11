#!/bin/bash
# entrypoint.sh - Workspace Container Startup

set -e

# ============================================================
# Fix Permissions (running as root)
# ============================================================

# Ensure workspace directory exists and is owned by coder
mkdir -p /workspace
chown -R coder:coder /workspace

# Ensure claude-config directory exists and is owned by coder
if [ -d "/claude-config" ]; then
    chown -R coder:coder /claude-config
fi

# ============================================================
# Claude Code Persistence
# ============================================================

# If /claude-config is mounted, symlink ~/.claude to it
# This persists Claude login across workspace restarts
if [ -d "/claude-config" ]; then
    # Remove existing .claude directory if it exists
    rm -rf /home/coder/.claude
    # Create symlink to persistent storage
    ln -sf /claude-config /home/coder/.claude
    chown -h coder:coder /home/coder/.claude
    echo "Claude Code: Using persistent config from /claude-config"
fi

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
# Start code-server as coder user
# ============================================================

# No authentication - access is controlled by the dashboard proxy
# The workspace container is only accessible via internal Docker network

exec gosu coder code-server \
    --bind-addr 0.0.0.0:8080 \
    --auth none \
    --disable-telemetry \
    /workspace
