#!/bin/bash

# Startet die zentrale Infrastruktur (MariaDB, phpMyAdmin)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
INFRA_DIR="$BASE_DIR/infrastructure"

# Gemeinsame Funktionen laden
source "$SCRIPT_DIR/common.sh"

# Docker prüfen
check_docker

# Zentrale Konfiguration laden
load_config "$SCRIPT_DIR"

echo "Starte Infrastruktur..."

cd "$INFRA_DIR"

# .env prüfen
if [ ! -f ".env" ]; then
    echo "⚠ Warnung: .env Datei nicht gefunden!"
    echo "Erstelle .env aus .env.example..."
    cp .env.example .env
    echo ""
    echo "WICHTIG: Bitte ändere das MySQL Root Passwort in:"
    echo "$INFRA_DIR/.env"
    echo ""
    read -p "Drücke Enter um fortzufahren..."
fi

# Docker Network erstellen (falls nicht vorhanden)
if ! docker network ls | grep -q "deployr-network"; then
    echo "Erstelle Docker Network: deployr-network"
    docker network create deployr-network
fi

# Infrastruktur starten
docker-compose up -d

echo ""
echo "════════════════════════════════════════════"
echo "✓ Infrastruktur gestartet!"
echo "════════════════════════════════════════════"
echo ""
docker-compose ps
echo ""
echo "Services:"
echo "  MariaDB:     $SERVER_IP:$MARIADB_PORT"
echo "  phpMyAdmin:  http://$SERVER_IP:$PHPMYADMIN_PORT"
echo "               (oder über NPM exposen)"
echo "════════════════════════════════════════════"
