#!/bin/bash

# Deployr - Web-basiertes Setup
# Startet das Dashboard im Setup-Modus

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="$SCRIPT_DIR/dashboard"

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "════════════════════════════════════════════"
echo "         Deployr - Web Setup"
echo "════════════════════════════════════════════"
echo ""

# Docker-Prüfung
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker ist nicht installiert!${NC}"
    echo ""
    echo "Docker wird benötigt. Installation:"
    echo "  curl -fsSL https://get.docker.com | sh"
    echo "  sudo usermod -aG docker \$USER"
    exit 1
fi

# Docker Compose Prüfung
if ! docker compose version &> /dev/null; then
    echo -e "${RED}✗ Docker Compose ist nicht installiert!${NC}"
    exit 1
fi

# Docker Daemon Prüfung
if ! docker info &> /dev/null; then
    echo -e "${RED}✗ Docker-Daemon läuft nicht!${NC}"
    echo "Starte Docker: sudo systemctl start docker"
    exit 1
fi

echo -e "${GREEN}✓${NC} Docker gefunden"

# Dashboard .env erstellen falls nicht vorhanden (Minimal-Config für Setup)
if [ ! -f "$DASHBOARD_DIR/.env" ]; then
    echo "Erstelle temporäre Konfiguration..."
    SESSION_SECRET=$(openssl rand -base64 32 | tr -d "=+/")

    cat > "$DASHBOARD_DIR/.env" << EOF
# Temporäre Konfiguration für Setup-Wizard
DB_HOST=deployr-mariadb
DB_PORT=3306
DB_DATABASE=dashboard
DB_USERNAME=dashboard_user
DB_PASSWORD=setup_temp_$(openssl rand -hex 8)
SESSION_SECRET=$SESSION_SECRET
MYSQL_ROOT_PASSWORD=TempSetupPassword123!
USERS_PATH=/app/users
SCRIPTS_PATH=/app/scripts
TEMPLATES_PATH=/app/templates
EOF
fi

# Docker Network erstellen falls nicht vorhanden
echo "Erstelle Docker-Netzwerk..."
docker network create deployr-network 2>/dev/null || true

# Leere config.sh erstellen falls nicht vorhanden (für Volume-Mount)
if [ ! -f "$SCRIPT_DIR/config.sh" ]; then
    touch "$SCRIPT_DIR/config.sh"
fi

# Users-Verzeichnis erstellen
mkdir -p "$SCRIPT_DIR/users"

# Dashboard bauen und starten
echo "Starte Dashboard im Setup-Modus..."
cd "$DASHBOARD_DIR"
docker compose -f docker-compose.standalone.yml build --quiet
docker compose -f docker-compose.standalone.yml up -d

# Server-IP ermitteln
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "════════════════════════════════════════════"
echo -e "${GREEN}✓ Dashboard gestartet!${NC}"
echo "════════════════════════════════════════════"
echo ""
echo -e "Öffne im Browser: ${BLUE}http://$SERVER_IP:3000${NC}"
echo ""
echo "Der Setup-Wizard führt dich durch die Installation:"
echo "  1. Server-IP und MySQL Passwort konfigurieren"
echo "  2. Admin-Benutzer erstellen"
echo "  3. Infrastruktur automatisch starten"
echo ""
echo "Nach dem Setup kannst du dich im Dashboard anmelden"
echo "und deine Projekte verwalten."
echo ""
echo "Logs anzeigen:"
echo "  cd dashboard && docker compose -f docker-compose.standalone.yml logs -f"
echo ""
