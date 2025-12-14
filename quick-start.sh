#!/bin/bash

# Quick Start Script für die erste Einrichtung

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "════════════════════════════════════════════"
echo "       Deployr - Quick Start Setup"
echo "════════════════════════════════════════════"
echo ""

# Docker-Prüfung
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker ist nicht installiert!${NC}"
    echo ""
    echo "Docker wird benötigt. Installation:"
    echo ""
    echo "  Schnell (alle Distributionen):"
    echo "    curl -fsSL https://get.docker.com | sh"
    echo "    sudo usermod -aG docker \$USER"
    echo "    # Danach neu einloggen!"
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
    echo "Nach der Installation dieses Script erneut ausführen."
    exit 1
fi

# Docker Compose Prüfung (v2)
if ! docker compose version &> /dev/null; then
    echo -e "${YELLOW}⚠ Docker Compose v2 nicht gefunden, prüfe v1...${NC}"
    if ! command -v docker-compose &> /dev/null; then
        echo -e "${RED}✗ Docker Compose ist nicht installiert!${NC}"
        echo ""
        echo "Installation:"
        echo "  Debian/Ubuntu: sudo apt install -y docker-compose-plugin"
        echo "  CentOS/Fedora: sudo dnf install -y docker-compose-plugin"
        echo ""
        exit 1
    fi
fi

# Prüfen ob Docker-Daemon läuft
if ! docker info &> /dev/null; then
    echo -e "${RED}✗ Docker-Daemon läuft nicht!${NC}"
    echo ""
    echo "Starte Docker:"
    echo "  sudo systemctl start docker"
    echo ""
    echo "Oder prüfe ob dein User in der docker-Gruppe ist:"
    echo "  sudo usermod -aG docker \$USER"
    echo "  # Danach neu einloggen!"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} Docker gefunden: $(docker --version)"
echo ""

# Config erstellen falls nicht vorhanden
if [ ! -f "$SCRIPT_DIR/config.sh" ]; then
    echo "[0/5] Server-Konfiguration erstellen..."
    echo -n "Server IP-Adresse eingeben (Standard: 192.168.2.125): "
    read INPUT_IP
    INPUT_IP=${INPUT_IP:-192.168.2.125}

    echo -n "Standard-Benutzer eingeben (Standard: mehmed): "
    read INPUT_USER
    INPUT_USER=${INPUT_USER:-mehmed}

    cp "$SCRIPT_DIR/config.sh.example" "$SCRIPT_DIR/config.sh"
    sed -i "s/SERVER_IP=\".*\"/SERVER_IP=\"$INPUT_IP\"/" "$SCRIPT_DIR/config.sh"
    sed -i "s/DEFAULT_USER=\".*\"/DEFAULT_USER=\"$INPUT_USER\"/" "$SCRIPT_DIR/config.sh"
    echo "✓ config.sh erstellt mit IP: $INPUT_IP"
    echo ""
fi

# Zentrale Konfiguration laden
source "$SCRIPT_DIR/config.sh"

# Scripts ausführbar machen
echo "[1/5] Mache Scripts ausführbar..."
chmod +x scripts/*.sh
echo "✓ Scripts sind jetzt ausführbar"
echo ""

# Infrastructure .env erstellen
echo "[2/5] Erstelle Infrastructure .env..."
if [ ! -f "infrastructure/.env" ]; then
    cp infrastructure/.env.example infrastructure/.env
    echo "✓ infrastructure/.env erstellt"
    echo "⚠ WICHTIG: Bitte ändere das MySQL Root Passwort in infrastructure/.env"
else
    echo "✓ infrastructure/.env existiert bereits"
fi
echo ""

# Docker Network erstellen
echo "[3/5] Erstelle Docker Network..."
if ! docker network ls | grep -q "deployr-network"; then
    docker network create deployr-network
    echo "✓ deployr-network erstellt"
else
    echo "✓ deployr-network existiert bereits"
fi
echo ""

# Infrastruktur starten
echo "[4/5] Starte Infrastruktur..."
cd infrastructure
docker compose up -d
cd ..
echo "✓ Infrastruktur gestartet"
echo ""

# Konfiguration anzeigen
echo "[5/5] Konfiguration prüfen..."
echo "✓ Server IP: $SERVER_IP"
echo ""

# Dashboard Installation abfragen
echo ""
echo -n "Möchtest du das Web-Dashboard installieren? (j/N): "
read INSTALL_DASHBOARD
INSTALL_DASHBOARD=${INSTALL_DASHBOARD:-n}

DASHBOARD_INSTALLED=false
if [ "$INSTALL_DASHBOARD" = "j" ] || [ "$INSTALL_DASHBOARD" = "J" ]; then
    echo ""
    echo "[+] Installiere Web-Dashboard..."

    # Dashboard .env erstellen
    if [ ! -f "$SCRIPT_DIR/dashboard/.env" ]; then
        DASHBOARD_DB_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)
        SESSION_SECRET=$(openssl rand -base64 32 | tr -d "=+/")

        # Root-Passwort aus infrastructure/.env holen
        if [ -f "$SCRIPT_DIR/infrastructure/.env" ]; then
            source "$SCRIPT_DIR/infrastructure/.env"
        fi

        cat > "$SCRIPT_DIR/dashboard/.env" << EOF
# Dashboard Datenbank-Konfiguration
DB_HOST=deployr-mariadb
DB_PORT=3306
DB_DATABASE=dashboard
DB_USERNAME=dashboard_user
DB_PASSWORD=$DASHBOARD_DB_PASSWORD

# Session Secret
SESSION_SECRET=$SESSION_SECRET

# MySQL Root Passwort
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}

# Pfade (Docker-intern)
USERS_PATH=/app/users
SCRIPTS_PATH=/app/scripts
TEMPLATES_PATH=/app/templates
EOF
        echo "  ✓ Dashboard .env erstellt"
    fi

    # Warten bis MariaDB bereit ist
    echo "  Warte auf MariaDB..."
    sleep 5

    # Dashboard Datenbank erstellen
    docker exec -i deployr-mariadb mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" << EOF 2>/dev/null || true
CREATE DATABASE IF NOT EXISTS dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'dashboard_user'@'%' IDENTIFIED BY '$DASHBOARD_DB_PASSWORD';
GRANT ALL PRIVILEGES ON dashboard.* TO 'dashboard_user'@'%';
FLUSH PRIVILEGES;
EOF
    echo "  ✓ Dashboard Datenbank erstellt"

    # Dashboard bauen und starten
    cd "$SCRIPT_DIR/dashboard"
    docker compose build --quiet
    docker compose up -d
    cd "$SCRIPT_DIR"
    echo "  ✓ Dashboard gestartet"
    DASHBOARD_INSTALLED=true
fi

echo ""
echo "════════════════════════════════════════════"
echo "✓ Setup abgeschlossen!"
echo "════════════════════════════════════════════"
echo ""
echo "Was läuft jetzt:"
docker ps --filter "network=deployr-network" --format "  - {{.Names}} ({{.Status}})"
echo ""
echo "Services:"
echo "  MariaDB:     $SERVER_IP:$MARIADB_PORT"
echo "  phpMyAdmin:  http://$SERVER_IP:$PHPMYADMIN_PORT"
if [ "$DASHBOARD_INSTALLED" = true ]; then
    echo -e "  ${GREEN}Dashboard:   http://$SERVER_IP:3000${NC}"
fi
echo ""
echo "Nächste Schritte:"
echo ""
if [ "$DASHBOARD_INSTALLED" = true ]; then
    echo "1. Dashboard öffnen und registrieren:"
    echo "   http://$SERVER_IP:3000"
    echo ""
    echo "2. Oder per Kommandozeile:"
    echo "   ./scripts/create-project.sh"
else
    echo "1. MySQL Root Passwort ändern (falls noch nicht geschehen):"
    echo "   nano infrastructure/.env"
    echo ""
    echo "2. Erstes Projekt erstellen:"
    echo "   ./scripts/create-project.sh"
    echo ""
    echo "3. Optional: Web-Dashboard nachinstallieren:"
    echo "   ./scripts/setup-dashboard.sh"
fi
echo ""
echo "Alle Projekte anzeigen:"
echo "   ./scripts/list-projects.sh"
echo ""
echo "Vollständige Anleitung: siehe SETUP.md"
echo "════════════════════════════════════════════"
