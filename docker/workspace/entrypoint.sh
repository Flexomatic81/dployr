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
    CODE_SERVER_DIR="/home/coder/.local/share/code-server"
    USER_DIR="$CODE_SERVER_DIR/User"

    # Ensure directories exist
    mkdir -p "$USER_DIR"

    # Create locale.json (tells VS Code which locale to use)
    echo "{\"locale\": \"$VSCODE_LOCALE\"}" > "$USER_DIR/locale.json"

    # Create languagepacks.json (required for CLI-installed language packs)
    # This file is normally created by UI installation but missing for CLI installs
    # Find the German language pack extension
    DE_LANGPACK=$(find "$CODE_SERVER_DIR/extensions" -maxdepth 1 -type d -name "ms-ceintl.vscode-language-pack-de*" 2>/dev/null | head -1)

    if [ -n "$DE_LANGPACK" ] && [ "$VSCODE_LOCALE" = "de" ]; then
        cat > "$CODE_SERVER_DIR/languagepacks.json" << LPEOF
{
    "de": [
        {
            "extensionIdentifier": {
                "id": "ms-ceintl.vscode-language-pack-de",
                "uuid": "a1e72f2-5093-4875-9d7d-8d72d54a9bb4"
            },
            "version": "1.99.0",
            "path": "$DE_LANGPACK/translations/main.i18n.json"
        }
    ]
}
LPEOF
        echo "VS Code: German language pack configured"
    fi

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
