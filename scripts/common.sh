#!/bin/bash

# Common functions for all scripts

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Docker check
check_docker() {
    # Docker installed?
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}✗ Docker is not installed!${NC}"
        echo ""
        echo "Docker is required. Installation:"
        echo ""
        echo "  Quick (all distributions):"
        echo "    curl -fsSL https://get.docker.com | sh"
        echo "    sudo usermod -aG docker \$USER"
        echo "    # Then log out and back in!"
        echo ""
        echo "  Debian/Ubuntu:"
        echo "    sudo apt update && sudo apt install -y docker.io docker-compose-plugin"
        echo ""
        echo "  CentOS/RHEL/Fedora:"
        echo "    sudo dnf install -y docker docker-compose-plugin"
        echo "    sudo systemctl enable --now docker"
        echo ""
        echo "  Arch Linux:"
        echo "    sudo pacman -S docker docker-compose"
        echo "    sudo systemctl enable --now docker"
        echo ""
        exit 1
    fi

    # Docker Compose v2?
    if ! docker compose version &> /dev/null; then
        if ! command -v docker-compose &> /dev/null; then
            echo -e "${RED}✗ Docker Compose is not installed!${NC}"
            echo ""
            echo "Installation:"
            echo "  Debian/Ubuntu: sudo apt install -y docker-compose-plugin"
            echo "  CentOS/Fedora: sudo dnf install -y docker-compose-plugin"
            echo ""
            exit 1
        fi
    fi

    # Docker daemon running?
    if ! docker info &> /dev/null; then
        echo -e "${RED}✗ Docker daemon is not running!${NC}"
        echo ""
        echo "Start Docker:"
        echo "  sudo systemctl start docker"
        echo ""
        echo "Or check if your user is in the docker group:"
        echo "  sudo usermod -aG docker \$USER"
        echo "  # Then log out and back in!"
        echo ""
        exit 1
    fi
}

# Load configuration
load_config() {
    local script_dir="$1"
    local base_dir="$(dirname "$script_dir")"
    local config_file="$base_dir/config.sh"

    if [ -f "$config_file" ]; then
        source "$config_file"
    fi

    # Fallback values
    SERVER_IP="${SERVER_IP:-192.168.2.125}"
    DEFAULT_USER="${DEFAULT_USER:-mehmed}"
    PHPMYADMIN_PORT="${PHPMYADMIN_PORT:-8080}"
    MARIADB_PORT="${MARIADB_PORT:-3306}"
}
