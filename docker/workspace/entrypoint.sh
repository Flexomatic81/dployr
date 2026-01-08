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

# Generate secure password if not provided
if [ -z "$CODE_SERVER_PASSWORD" ]; then
    CODE_SERVER_PASSWORD=$(openssl rand -base64 32)
    echo "Generated workspace password: $CODE_SERVER_PASSWORD" > /workspace/.code-server-password
    chmod 600 /workspace/.code-server-password
    echo "INFO: Workspace password saved to /workspace/.code-server-password"
fi

exec code-server \
    --bind-addr 0.0.0.0:8080 \
    --auth password \
    --password "$CODE_SERVER_PASSWORD" \
    --disable-telemetry \
    /workspace
