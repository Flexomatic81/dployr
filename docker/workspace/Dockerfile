# ============================================================
# dployr-workspace
# VS Code in the browser with Claude Code integration
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

# Fix ownership
RUN chown -R coder:coder /home/coder

# ============================================================
# Runtime Configuration
# ============================================================

# Install gosu for dropping privileges in entrypoint
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

# Start as root - entrypoint will fix permissions and switch to coder
USER root

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
