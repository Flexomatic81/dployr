#!/bin/bash

# Setup-Script für das Webserver Dashboard
# Erstellt Datenbank, User und startet das Dashboard

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
DASHBOARD_DIR="$BASE_DIR/dashboard"

# Gemeinsame Funktionen laden
source "$SCRIPT_DIR/common.sh"

# Docker prüfen
check_docker

# Zentrale Konfiguration laden
load_config "$SCRIPT_DIR"

echo ""
echo "════════════════════════════════════════════"
echo "  Webserver Dashboard Setup"
echo "════════════════════════════════════════════"
echo ""

# Prüfen ob Dashboard-Verzeichnis existiert
if [ ! -d "$DASHBOARD_DIR" ]; then
    echo -e "${RED}✗ Dashboard-Verzeichnis nicht gefunden!${NC}"
    echo "Pfad: $DASHBOARD_DIR"
    exit 1
fi

# Prüfen ob MariaDB läuft
MARIADB_CONTAINER="deployr-mariadb"
if ! docker ps | grep -q "$MARIADB_CONTAINER"; then
    echo -e "${YELLOW}⚠ MariaDB Container läuft nicht.${NC}"
    echo "Starte Infrastruktur..."
    "$SCRIPT_DIR/start-infrastructure.sh"
    sleep 5
fi

# .env Datei erstellen falls nicht vorhanden
if [ ! -f "$DASHBOARD_DIR/.env" ]; then
    echo "[1/4] Erstelle .env Datei..."

    # Sichere Passwörter generieren
    DASHBOARD_DB_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)
    SESSION_SECRET=$(openssl rand -base64 32 | tr -d "=+/")

    cat > "$DASHBOARD_DIR/.env" << EOF
# Dashboard Datenbank-Konfiguration
DB_HOST=deployr-mariadb
DB_PORT=3306
DB_DATABASE=dashboard
DB_USERNAME=dashboard_user
DB_PASSWORD=$DASHBOARD_DB_PASSWORD

# Session Secret
SESSION_SECRET=$SESSION_SECRET

# MySQL Root Passwort (aus infrastructure/.env)
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}

# Pfade (Docker-intern)
USERS_PATH=/app/users
SCRIPTS_PATH=/app/scripts
TEMPLATES_PATH=/app/templates
EOF

    echo -e "  ${GREEN}✓${NC} .env erstellt"
else
    echo "[1/4] .env existiert bereits"
    source "$DASHBOARD_DIR/.env"
fi

# Dashboard Datenbank und User erstellen
echo "[2/4] Erstelle Dashboard Datenbank..."

# Root-Passwort aus infrastructure/.env holen
if [ -f "$BASE_DIR/infrastructure/.env" ]; then
    source "$BASE_DIR/infrastructure/.env"
fi

# Dashboard DB Password aus .env laden
source "$DASHBOARD_DIR/.env"

docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" << EOF
-- Dashboard Datenbank erstellen
CREATE DATABASE IF NOT EXISTS dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Dashboard User erstellen
CREATE USER IF NOT EXISTS 'dashboard_user'@'%' IDENTIFIED BY '$DB_PASSWORD';

-- Rechte vergeben
GRANT ALL PRIVILEGES ON dashboard.* TO 'dashboard_user'@'%';

FLUSH PRIVILEGES;
EOF

echo -e "  ${GREEN}✓${NC} Datenbank erstellt"

# Docker Image bauen
echo "[3/4] Baue Dashboard Docker Image..."
cd "$DASHBOARD_DIR"
docker compose build --quiet
echo -e "  ${GREEN}✓${NC} Image gebaut"

# Dashboard starten
echo "[4/4] Starte Dashboard..."
docker compose up -d
echo -e "  ${GREEN}✓${NC} Dashboard gestartet"

echo ""
echo "════════════════════════════════════════════"
echo -e "  ${GREEN}✓ Dashboard erfolgreich eingerichtet!${NC}"
echo "════════════════════════════════════════════"
echo ""
echo "Dashboard URL: http://$SERVER_IP:3000"
echo ""
echo "Nächste Schritte:"
echo "  1. Öffne http://$SERVER_IP:3000 im Browser"
echo "  2. Registriere einen neuen Benutzer"
echo "  3. Verwalte deine Projekte über das Dashboard"
echo ""
echo "Befehle:"
echo "  Stoppen:    cd $DASHBOARD_DIR && docker compose down"
echo "  Logs:       cd $DASHBOARD_DIR && docker compose logs -f"
echo "  Neustarten: cd $DASHBOARD_DIR && docker compose restart"
echo ""
