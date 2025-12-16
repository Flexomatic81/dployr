#!/bin/bash

# Interaktives Script zum Erstellen eines neuen User-Projekts

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"

# Gemeinsame Funktionen laden
source "$SCRIPT_DIR/common.sh"

# Docker prüfen
check_docker

# Zentrale Konfiguration laden
load_config "$SCRIPT_DIR"

echo ""
echo "═══════════════════════════════════════════="
echo "   Neues Webserver-Projekt erstellen"
echo "═══════════════════════════════════════════="
echo ""

# 1. Username abfragen
echo -e "${BLUE}1. Username:${NC}"
echo -n "Username eingeben (Standard: $DEFAULT_USER): "
read USERNAME
USERNAME=${USERNAME:-$DEFAULT_USER}
echo -e "${GREEN}✓${NC} Username: $USERNAME"
echo ""

# 2. Projektname abfragen
echo -e "${BLUE}2. Projektname:${NC}"
echo -n "Projektname eingeben: "
read PROJECT_NAME

while [ -z "$PROJECT_NAME" ]; do
    echo -e "${YELLOW}⚠${NC} Projektname darf nicht leer sein!"
    echo -n "Projektname eingeben: "
    read PROJECT_NAME
done

# Prüfen ob Projekt bereits existiert
PROJECT_DIR="$BASE_DIR/users/$USERNAME/$PROJECT_NAME"
if [ -d "$PROJECT_DIR" ]; then
    echo -e "${YELLOW}⚠${NC} Fehler: Projekt $PROJECT_NAME für User $USERNAME existiert bereits!"
    exit 1
fi

echo -e "${GREEN}✓${NC} Projektname: $PROJECT_NAME"
echo ""

# 3. Template auswählen
echo -e "${BLUE}3. Projekt-Template:${NC}"
echo "1) Statische Website (HTML/CSS/JS)"
echo "2) PHP Website (PHP + Nginx + Datenbank)"
echo "3) Node.js App (Express + Datenbank)"
echo -n "Template auswählen (1-3, Standard: 1): "
read TEMPLATE_CHOICE
TEMPLATE_CHOICE=${TEMPLATE_CHOICE:-1}

case $TEMPLATE_CHOICE in
    1)
        TEMPLATE="static-website"
        TEMPLATE_NAME="Statische Website"
        NEEDS_DB_DEFAULT="n"
        ;;
    2)
        TEMPLATE="php-website"
        TEMPLATE_NAME="PHP Website"
        NEEDS_DB_DEFAULT="j"
        ;;
    3)
        TEMPLATE="nodejs-app"
        TEMPLATE_NAME="Node.js App"
        NEEDS_DB_DEFAULT="j"
        ;;
    *)
        echo -e "${YELLOW}⚠${NC} Ungültige Auswahl, verwende Standard: Statische Website"
        TEMPLATE="static-website"
        TEMPLATE_NAME="Statische Website"
        NEEDS_DB_DEFAULT="n"
        ;;
esac

TEMPLATE_PATH="$BASE_DIR/templates/$TEMPLATE"
if [ ! -d "$TEMPLATE_PATH" ]; then
    echo -e "${YELLOW}⚠${NC} Fehler: Template '$TEMPLATE' existiert nicht!"
    exit 1
fi

echo -e "${GREEN}✓${NC} Template: $TEMPLATE_NAME"
echo ""

# 4. Port auswählen
echo -e "${BLUE}4. Port-Konfiguration:${NC}"

# Finde nächsten freien Port
NEXT_PORT=8001
while docker ps --format '{{.Ports}}' | grep -q "0.0.0.0:$NEXT_PORT"; do
    NEXT_PORT=$((NEXT_PORT + 1))
done

echo "Nächster freier Port: $NEXT_PORT"
echo -n "Port verwenden (Enter für $NEXT_PORT, oder eigenen Port eingeben): "
read EXPOSED_PORT
EXPOSED_PORT=${EXPOSED_PORT:-$NEXT_PORT}

echo -e "${GREEN}✓${NC} Port: $EXPOSED_PORT"
echo ""

# 5. GitHub Repository (optional)
echo -e "${BLUE}5. GitHub Integration (optional):${NC}"
echo -n "GitHub Repository URL (leer lassen für später): "
read GITHUB_REPO

if [ -n "$GITHUB_REPO" ]; then
    echo -e "${GREEN}✓${NC} GitHub: $GITHUB_REPO"
fi
echo ""

# 6. Datenbank (nur für PHP und Node.js)
CREATE_DATABASE="n"
if [ "$TEMPLATE" != "static-website" ]; then
    echo -e "${BLUE}6. Datenbank:${NC}"
    echo -n "Datenbank erstellen? (j/n, Standard: $NEEDS_DB_DEFAULT): "
    read CREATE_DATABASE
    CREATE_DATABASE=${CREATE_DATABASE:-$NEEDS_DB_DEFAULT}
    
    if [ "$CREATE_DATABASE" = "j" ] || [ "$CREATE_DATABASE" = "J" ]; then
        CREATE_DATABASE="j"
        
        # Datenbankname vorschlagen
        DEFAULT_DB_NAME="${PROJECT_NAME}_db"
        echo -n "Datenbankname (Standard: $DEFAULT_DB_NAME): "
        read DB_NAME
        DB_NAME=${DB_NAME:-$DEFAULT_DB_NAME}
        
        # Datenbankname bereinigen (nur alphanumerisch und Unterstriche)
        DB_NAME=$(echo "$DB_NAME" | sed 's/[^a-zA-Z0-9_]/_/g')
        
        echo -e "${GREEN}✓${NC} Datenbank: $DB_NAME"
    fi
    echo ""
fi

# Zusammenfassung
echo ""
echo "═══════════════════════════════════════════="
echo "   Zusammenfassung"
echo "═══════════════════════════════════════════="
echo "Username:  $USERNAME"
echo "Projekt:   $PROJECT_NAME"
echo "Template:  $TEMPLATE_NAME"
echo "Port:      $EXPOSED_PORT"
if [ -n "$GITHUB_REPO" ]; then
    echo "GitHub:    $GITHUB_REPO"
fi
if [ "$CREATE_DATABASE" = "j" ]; then
    echo "Datenbank: $DB_NAME"
fi
echo "Pfad:      $PROJECT_DIR"
echo "═══════════════════════════════════════════="
echo ""
echo -n "Projekt erstellen? (j/n, Standard: j): "
read CONFIRM
CONFIRM=${CONFIRM:-j}

if [ "$CONFIRM" != "j" ] && [ "$CONFIRM" != "J" ]; then
    echo "Abgebrochen."
    exit 0
fi

echo ""
echo "Erstelle Projekt..."
echo ""

# User-Verzeichnis erstellen (falls nicht vorhanden)
if [ ! -d "$BASE_DIR/users/$USERNAME" ]; then
    echo "→ Erstelle User-Verzeichnis: $BASE_DIR/users/$USERNAME"
    mkdir -p "$BASE_DIR/users/$USERNAME"
fi

# Projekt aus Template erstellen
echo "→ Kopiere Template nach $PROJECT_DIR"
cp -r "$TEMPLATE_PATH" "$PROJECT_DIR"

# Berechtigungen setzen (für Docker-Kompatibilität)
echo "→ Setze Berechtigungen..."
find "$PROJECT_DIR" -type d -exec chmod 755 {} \;
find "$PROJECT_DIR" -type f -exec chmod 644 {} \;

# .env Datei erstellen und konfigurieren
if [ -f "$PROJECT_DIR/.env.example" ]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    
    # Port in .env setzen
    sed -i "s/EXPOSED_PORT=.*/EXPOSED_PORT=$EXPOSED_PORT/" "$PROJECT_DIR/.env"
    
    # Projekt-Name in .env setzen
    SAFE_PROJECT_NAME=$(echo "$PROJECT_NAME" | sed 's/[^a-zA-Z0-9]/-/g')
    sed -i "s/PROJECT_NAME=.*/PROJECT_NAME=$SAFE_PROJECT_NAME/" "$PROJECT_DIR/.env"
    
    echo -e "${GREEN}✓${NC} .env Datei erstellt und konfiguriert"
fi

# GitHub Repository klonen (falls angegeben)
if [ -n "$GITHUB_REPO" ]; then
    echo "→ Klone GitHub Repository..."
    rm -rf "$PROJECT_DIR/html"
    
    if git clone "$GITHUB_REPO" "$PROJECT_DIR/html" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Repository erfolgreich geklont"
        
        # Berechtigungen nach Git-Clone wieder setzen
        find "$PROJECT_DIR/html" -type d -exec chmod 755 {} \;
        find "$PROJECT_DIR/html" -type f -exec chmod 644 {} \;
    else
        echo -e "${YELLOW}⚠${NC} Warnung: Git-Clone fehlgeschlagen. Template-HTML wird verwendet."
        echo "   Stelle sicher, dass der SSH-Key auf GitHub hinterlegt ist."
    fi
fi

# Datenbank erstellen (falls gewünscht)
if [ "$CREATE_DATABASE" = "j" ]; then
    echo ""
    echo "→ Erstelle Datenbank..."
    
    # Prüfen ob MariaDB läuft
    MARIADB_CONTAINER="dployr-mariadb"
    if ! docker ps | grep -q "$MARIADB_CONTAINER"; then
        echo -e "${YELLOW}⚠${NC} Warnung: MariaDB Container läuft nicht!"
        echo "   Starte erst die Infrastruktur: cd infrastructure && docker compose up -d"
        echo "   Datenbank wurde NICHT erstellt!"
    else
        # DB User und Passwort generieren
        DB_USER="${USERNAME}_$(echo $DB_NAME | sed 's/_db$//')"
        DB_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)
        
        # Root-Passwort aus Infrastruktur .env lesen
        if [ -f "$BASE_DIR/infrastructure/.env" ]; then
            source "$BASE_DIR/infrastructure/.env"
        fi
        MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}
        
        # SQL Commands ausführen
        docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<EOF 2>/dev/null
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'%' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'%';
FLUSH PRIVILEGES;
EOF
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓${NC} Datenbank erfolgreich erstellt"
            
            # Credentials in .env eintragen
            if [ -f "$PROJECT_DIR/.env" ]; then
                echo "" >> "$PROJECT_DIR/.env"
                echo "# Datenbank-Zugangsdaten (automatisch generiert)" >> "$PROJECT_DIR/.env"
                echo "DB_HOST=dployr-mariadb" >> "$PROJECT_DIR/.env"
                echo "DB_PORT=3306" >> "$PROJECT_DIR/.env"
                echo "DB_DATABASE=$DB_NAME" >> "$PROJECT_DIR/.env"
                echo "DB_USERNAME=$DB_USER" >> "$PROJECT_DIR/.env"
                echo "DB_PASSWORD=$DB_PASSWORD" >> "$PROJECT_DIR/.env"
                
                echo -e "${GREEN}✓${NC} Datenbank-Credentials in .env gespeichert"
            fi
            
            # Credentials auch in separater Datei speichern
            CREDS_FILE="$BASE_DIR/users/$USERNAME/.db-credentials"
            echo "" >> "$CREDS_FILE"
            echo "# Datenbank: $DB_NAME (erstellt: $(date))" >> "$CREDS_FILE"
            echo "DB_DATABASE=$DB_NAME" >> "$CREDS_FILE"
            echo "DB_USERNAME=$DB_USER" >> "$CREDS_FILE"
            echo "DB_PASSWORD=$DB_PASSWORD" >> "$CREDS_FILE"
            
            # Datenbank-Info für später speichern
            DB_INFO="
═══════════════════════════════════════════=
   Datenbank-Informationen
═══════════════════════════════════════════=
Datenbank:  $DB_NAME
User:       $DB_USER
Passwort:   $DB_PASSWORD
Host:       dployr-mariadb (im Docker Network)
            $SERVER_IP:$MARIADB_PORT (von außen)
Port:       3306

Credentials gespeichert in:
- $PROJECT_DIR/.env
- $CREDS_FILE
═══════════════════════════════════════════="
        else
            echo -e "${YELLOW}⚠${NC} Fehler beim Erstellen der Datenbank"
        fi
    fi
fi

echo ""
echo "═══════════════════════════════════════════="
echo -e "   ${GREEN}✓ Projekt erfolgreich erstellt!${NC}"
echo "═══════════════════════════════════════════="
echo ""
echo "Nächste Schritte:"
echo ""
echo "1. Container starten:"
echo "   cd $PROJECT_DIR"
echo "   docker compose up -d"
echo ""
echo "2. Im Browser öffnen:"
echo "   http://$SERVER_IP:$EXPOSED_PORT"
echo ""
echo "3. Mit VS Code Remote SSH bearbeiten:"
echo "   Remote-SSH → $DEFAULT_USER@$SERVER_IP"
echo "   Open Folder → $PROJECT_DIR/html"
echo ""
echo "4. In NPM Domain konfigurieren:"
echo "   Domain → $SERVER_IP:$EXPOSED_PORT"
echo ""
echo "═══════════════════════════════════════════="

# Datenbank-Info anzeigen (falls erstellt)
if [ -n "$DB_INFO" ]; then
    echo "$DB_INFO"
fi

echo ""

# Container direkt starten?
echo -n "Container jetzt starten? (j/n, Standard: j): "
read START_NOW
START_NOW=${START_NOW:-j}

if [ "$START_NOW" = "j" ] || [ "$START_NOW" = "J" ]; then
    echo ""
    echo "Starte Container..."
    cd "$PROJECT_DIR"
    docker compose up -d
    echo ""
    echo -e "${GREEN}✓ Container gestartet!${NC}"
    echo "Website verfügbar unter: http://$SERVER_IP:$EXPOSED_PORT"
    
    if [ "$CREATE_DATABASE" = "j" ]; then
        echo ""
        echo "phpMyAdmin: http://$SERVER_IP:$PHPMYADMIN_PORT"
        echo "→ Login mit: $DB_USER / $DB_PASSWORD"
    fi
fi

echo ""
