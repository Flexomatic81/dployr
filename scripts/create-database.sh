#!/bin/bash

# Script zum Erstellen einer neuen Datenbank mit eigenem User
# Verwendung: ./create-database.sh <username> <database_name>

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
DB_NAME=$2

# Validierung
if [ -z "$USERNAME" ] || [ -z "$DB_NAME" ]; then
    echo "Verwendung: $0 <username> <database_name>"
    echo ""
    echo "Beispiel: $0 user1 user1_myapp"
    exit 1
fi

# DB User und Passwort generieren
DB_USER="${USERNAME}_${DB_NAME}"
DB_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)

# MariaDB Container Name
MARIADB_CONTAINER="dployr-mariadb"

# Prüfen ob MariaDB läuft
if ! docker ps | grep -q "$MARIADB_CONTAINER"; then
    echo "Fehler: MariaDB Container '$MARIADB_CONTAINER' läuft nicht!"
    echo "Bitte erst die Infrastruktur starten:"
    echo "  cd infrastructure && docker-compose up -d"
    exit 1
fi

echo "Erstelle Datenbank und User..."
echo "Datenbank: $DB_NAME"
echo "User:      $DB_USER"

# SQL Commands ausführen
docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" <<EOF
-- Datenbank erstellen
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- User erstellen
CREATE USER IF NOT EXISTS '$DB_USER'@'%' IDENTIFIED BY '$DB_PASSWORD';

-- Rechte vergeben (nur für diese Datenbank)
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'%';

FLUSH PRIVILEGES;

-- Info ausgeben
SELECT 'Datenbank erstellt' AS status;
EOF

# Credentials speichern
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
CREDS_FILE="$BASE_DIR/users/$USERNAME/.db-credentials"

mkdir -p "$BASE_DIR/users/$USERNAME"
echo "" >> "$CREDS_FILE"
echo "# Datenbank: $DB_NAME (erstellt: $(date))" >> "$CREDS_FILE"
echo "DB_DATABASE=$DB_NAME" >> "$CREDS_FILE"
echo "DB_USERNAME=$DB_USER" >> "$CREDS_FILE"
echo "DB_PASSWORD=$DB_PASSWORD" >> "$CREDS_FILE"

echo ""
echo "════════════════════════════════════════════"
echo "✓ Datenbank erfolgreich erstellt!"
echo "════════════════════════════════════════════"
echo "Datenbank:  $DB_NAME"
echo "User:       $DB_USER"
echo "Passwort:   $DB_PASSWORD"
echo ""
echo "Host:       dployr-mariadb (im Docker Network)"
echo "            $SERVER_IP:$MARIADB_PORT (von außen)"
echo "Port:       3306"
echo ""
echo "Credentials gespeichert in:"
echo "$CREDS_FILE"
echo ""
echo "Füge diese Werte in die .env Datei deines Projekts ein:"
echo "  DB_DATABASE=$DB_NAME"
echo "  DB_USERNAME=$DB_USER"
echo "  DB_PASSWORD=$DB_PASSWORD"
echo "════════════════════════════════════════════"
