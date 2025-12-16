#!/bin/bash

# Script zum Löschen eines einzelnen Projekts
# Verwendung: ./delete-project.sh <username> <projektname>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"

# Gemeinsame Funktionen laden
source "$SCRIPT_DIR/common.sh"

# Docker prüfen
check_docker

# Zentrale Konfiguration laden
load_config "$SCRIPT_DIR"

USERNAME=$1
PROJECT_NAME=$2

# Validierung
if [ -z "$USERNAME" ] || [ -z "$PROJECT_NAME" ]; then
    echo "Verwendung: $0 <username> <projektname>"
    echo ""
    echo "Beispiel: $0 mehmed mein-projekt"
    exit 1
fi

PROJECT_DIR="$BASE_DIR/users/$USERNAME/$PROJECT_NAME"

# Prüfen ob Projekt existiert
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}✗ Projekt '$PROJECT_NAME' existiert nicht!${NC}"
    echo "Pfad: $PROJECT_DIR"
    exit 1
fi

# Projekt-Datenbank aus .env lesen
PROJECT_DB=""
PROJECT_DB_USER=""
if [ -f "$PROJECT_DIR/.env" ]; then
    PROJECT_DB=$(grep "^DB_DATABASE=" "$PROJECT_DIR/.env" 2>/dev/null | cut -d'=' -f2 || true)
    PROJECT_DB_USER=$(grep "^DB_USERNAME=" "$PROJECT_DIR/.env" 2>/dev/null | cut -d'=' -f2 || true)
fi

# Container-Status prüfen
CONTAINER_RUNNING=false
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "${USERNAME}-${PROJECT_NAME}"; then
    CONTAINER_RUNNING=true
fi

echo ""
echo "════════════════════════════════════════════"
echo -e "${YELLOW}⚠ Projekt löschen${NC}"
echo "════════════════════════════════════════════"
echo ""
echo "User:       $USERNAME"
echo "Projekt:    $PROJECT_NAME"
echo "Verzeichnis: $PROJECT_DIR"
if [ "$CONTAINER_RUNNING" = true ]; then
    echo -e "Status:     ${GREEN}läuft${NC}"
else
    echo "Status:     gestoppt"
fi
if [ -n "$PROJECT_DB" ]; then
    echo "Datenbank:  $PROJECT_DB"
fi
echo ""
echo -e "${YELLOW}Diese Aktion kann NICHT rückgängig gemacht werden!${NC}"
echo ""
read -p "Projekt '$PROJECT_NAME' wirklich löschen? (j/N): " CONFIRM

if [ "$CONFIRM" != "j" ] && [ "$CONFIRM" != "J" ]; then
    echo ""
    echo "Abgebrochen."
    exit 0
fi

echo ""
echo "Lösche Projekt '$PROJECT_NAME'..."
echo ""

# 1. Container stoppen
echo "[1/3] Stoppe Container..."
if [ -f "$PROJECT_DIR/docker-compose.yml" ]; then
    cd "$PROJECT_DIR"
    docker compose down --volumes --remove-orphans 2>/dev/null || docker-compose down --volumes --remove-orphans 2>/dev/null || true
    cd "$BASE_DIR"
    echo -e "  ${GREEN}✓${NC} Container gestoppt"
else
    echo "  Keine docker-compose.yml gefunden"
fi

# 2. Datenbank löschen (optional)
MARIADB_CONTAINER="dployr-mariadb"
if [ -n "$PROJECT_DB" ] && docker ps | grep -q "$MARIADB_CONTAINER"; then
    echo "[2/3] Lösche Datenbank..."

    read -p "  Datenbank '$PROJECT_DB' auch löschen? (j/N): " DELETE_DB

    if [ "$DELETE_DB" = "j" ] || [ "$DELETE_DB" = "J" ]; then
        docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "DROP DATABASE IF EXISTS \`$PROJECT_DB\`;" 2>/dev/null || true

        if [ -n "$PROJECT_DB_USER" ]; then
            docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "DROP USER IF EXISTS '$PROJECT_DB_USER'@'%';" 2>/dev/null || true
        fi

        docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "FLUSH PRIVILEGES;" 2>/dev/null || true

        # Aus .db-credentials entfernen
        CREDS_FILE="$BASE_DIR/users/$USERNAME/.db-credentials"
        if [ -f "$CREDS_FILE" ] && [ -n "$PROJECT_DB" ]; then
            # Temporäre Datei erstellen ohne die DB-Einträge
            grep -v "DB_DATABASE=$PROJECT_DB" "$CREDS_FILE" | grep -v "DB_USERNAME=$PROJECT_DB_USER" | grep -v "# Datenbank: $PROJECT_DB" > "$CREDS_FILE.tmp" 2>/dev/null || true
            mv "$CREDS_FILE.tmp" "$CREDS_FILE" 2>/dev/null || true
        fi

        echo -e "  ${GREEN}✓${NC} Datenbank gelöscht"
    else
        echo "  Datenbank beibehalten"
    fi
else
    echo "[2/3] Keine Datenbank zu löschen"
fi

# 3. Projekt-Verzeichnis löschen
echo "[3/3] Lösche Projekt-Verzeichnis..."
rm -rf "$PROJECT_DIR"
echo -e "  ${GREEN}✓${NC} Verzeichnis gelöscht"

echo ""
echo "════════════════════════════════════════════"
echo -e "${GREEN}✓ Projekt '$PROJECT_NAME' erfolgreich gelöscht!${NC}"
echo "════════════════════════════════════════════"
echo ""
