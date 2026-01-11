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
# Claude Code Update (background)
# ============================================================

# Update Claude Code in background to not block container startup
# This replaces Claude's built-in auto-update which causes issues
(
    echo "Claude Code: Checking for updates..."
    if npm update -g @anthropic-ai/claude-code --loglevel=error 2>/dev/null; then
        echo "Claude Code: Updated successfully"
    else
        echo "Claude Code: Update check completed"
    fi
) &

# ============================================================
# Claude Code Configuration
# ============================================================

# Create a dummy 'code' command to prevent "spawn code ENOENT" errors
# Claude Code tries to install VS Code extension but code-server doesn't have 'code' CLI
# This dummy script silently succeeds so Claude Code doesn't show error messages
if [ ! -f /usr/local/bin/code ]; then
    cat > /usr/local/bin/code << 'CODESCRIPT'
#!/bin/bash
# Dummy 'code' CLI for code-server environment
# Claude Code calls this to install VS Code extension, but code-server
# doesn't support the standard VS Code CLI. We exit silently.
exit 0
CODESCRIPT
    chmod +x /usr/local/bin/code
fi

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
