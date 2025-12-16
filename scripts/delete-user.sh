#!/bin/bash

# Script zum Löschen eines Users mit allen Projekten und Datenbanken
# Verwendung: ./delete-user.sh <username>

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

# Validierung
if [ -z "$USERNAME" ]; then
    echo "Verwendung: $0 <username>"
    echo ""
    echo "Beispiel: $0 mehmed"
    echo ""
    echo "WARNUNG: Dies löscht ALLE Projekte und Datenbanken des Users!"
    exit 1
fi

USER_DIR="$BASE_DIR/users/$USERNAME"

# Prüfen ob User existiert
if [ ! -d "$USER_DIR" ]; then
    echo -e "${RED}✗ User '$USERNAME' existiert nicht!${NC}"
    echo "Pfad: $USER_DIR"
    exit 1
fi

# Projekte sammeln
PROJECTS=$(find "$USER_DIR" -maxdepth 1 -mindepth 1 -type d -not -name ".*" 2>/dev/null || true)
PROJECT_COUNT=$(echo "$PROJECTS" | grep -c "." 2>/dev/null || echo "0")

# Datenbanken aus .db-credentials lesen
CREDS_FILE="$USER_DIR/.db-credentials"
DATABASES=""
if [ -f "$CREDS_FILE" ]; then
    DATABASES=$(grep "^DB_DATABASE=" "$CREDS_FILE" | cut -d'=' -f2 | sort -u)
fi
DB_COUNT=$(echo "$DATABASES" | grep -c "." 2>/dev/null || echo "0")

echo ""
echo "════════════════════════════════════════════"
echo -e "${RED}⚠ WARNUNG: User löschen${NC}"
echo "════════════════════════════════════════════"
echo ""
echo "User:       $USERNAME"
echo "Verzeichnis: $USER_DIR"
echo ""

if [ "$PROJECT_COUNT" -gt 0 ]; then
    echo "Projekte ($PROJECT_COUNT):"
    for project in $PROJECTS; do
        project_name=$(basename "$project")
        # Prüfen ob Container läuft
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "${USERNAME}-${project_name}"; then
            echo "  - $project_name (läuft)"
        else
            echo "  - $project_name"
        fi
    done
    echo ""
fi

if [ -n "$DATABASES" ] && [ "$DB_COUNT" -gt 0 ]; then
    echo "Datenbanken ($DB_COUNT):"
    for db in $DATABASES; do
        echo "  - $db"
    done
    echo ""
fi

echo -e "${YELLOW}Diese Aktion kann NICHT rückgängig gemacht werden!${NC}"
echo ""
read -p "Wirklich löschen? Tippe '$USERNAME' zur Bestätigung: " CONFIRM

if [ "$CONFIRM" != "$USERNAME" ]; then
    echo ""
    echo "Abgebrochen."
    exit 0
fi

echo ""
echo "Lösche User '$USERNAME'..."
echo ""

# 1. Alle Container stoppen und entfernen
if [ "$PROJECT_COUNT" -gt 0 ]; then
    echo "[1/3] Stoppe und entferne Container..."
    for project in $PROJECTS; do
        project_name=$(basename "$project")
        if [ -f "$project/docker-compose.yml" ]; then
            echo "  Stoppe $project_name..."
            cd "$project"
            docker compose down --volumes --remove-orphans 2>/dev/null || docker-compose down --volumes --remove-orphans 2>/dev/null || true
            cd "$BASE_DIR"
        fi
    done
    echo -e "  ${GREEN}✓${NC} Container gestoppt"
else
    echo "[1/3] Keine Projekte gefunden"
fi

# 2. Datenbanken löschen
MARIADB_CONTAINER="dployr-mariadb"
if [ -n "$DATABASES" ] && [ "$DB_COUNT" -gt 0 ] && docker ps | grep -q "$MARIADB_CONTAINER"; then
    echo "[2/3] Lösche Datenbanken..."

    # DB Users aus .db-credentials lesen
    DB_USERS=""
    if [ -f "$CREDS_FILE" ]; then
        DB_USERS=$(grep "^DB_USERNAME=" "$CREDS_FILE" | cut -d'=' -f2 | sort -u)
    fi

    for db in $DATABASES; do
        echo "  Lösche Datenbank: $db"
        docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "DROP DATABASE IF EXISTS \`$db\`;" 2>/dev/null || true
    done

    for db_user in $DB_USERS; do
        echo "  Lösche DB-User: $db_user"
        docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "DROP USER IF EXISTS '$db_user'@'%';" 2>/dev/null || true
    done

    docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "FLUSH PRIVILEGES;" 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Datenbanken gelöscht"
else
    echo "[2/3] Keine Datenbanken zu löschen"
fi

# 3. User-Verzeichnis löschen
echo "[3/3] Lösche User-Verzeichnis..."
rm -rf "$USER_DIR"
echo -e "  ${GREEN}✓${NC} Verzeichnis gelöscht"

echo ""
echo "════════════════════════════════════════════"
echo -e "${GREEN}✓ User '$USERNAME' erfolgreich gelöscht!${NC}"
echo "════════════════════════════════════════════"
echo ""
echo "Gelöscht:"
if [ "$PROJECT_COUNT" -gt 0 ]; then
    echo "  - $PROJECT_COUNT Projekt(e)"
fi
if [ "$DB_COUNT" -gt 0 ]; then
    echo "  - $DB_COUNT Datenbank(en)"
fi
echo "  - User-Verzeichnis: $USER_DIR"
echo ""
