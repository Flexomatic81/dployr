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
    # Create symlink to persistent storage (~/.claude -> /claude-config)
    ln -sf /claude-config /home/coder/.claude
    chown -h coder:coder /home/coder/.claude

    # Also symlink ~/.claude.json for OAuth session persistence
    # Claude Code stores OAuth tokens in ~/.claude.json (not in ~/.claude/)
    if [ -f "/claude-config/claude.json" ] && [ -s "/claude-config/claude.json" ]; then
        # File exists and is not empty - use it
        rm -f /home/coder/.claude.json
        ln -sf /claude-config/claude.json /home/coder/.claude.json
        chown -h coder:coder /home/coder/.claude.json
    else
        # Create valid empty JSON file so symlink works on first run
        echo '{}' > /claude-config/claude.json
        chown coder:coder /claude-config/claude.json
        rm -f /home/coder/.claude.json
        ln -sf /claude-config/claude.json /home/coder/.claude.json
        chown -h coder:coder /home/coder/.claude.json
    fi

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
