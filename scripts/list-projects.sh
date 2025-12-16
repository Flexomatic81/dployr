#!/bin/bash

# Listet alle User-Projekte auf

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
USERS_DIR="$BASE_DIR/users"

echo "════════════════════════════════════════════"
echo "User-Projekte Übersicht"
echo "════════════════════════════════════════════"
echo ""

if [ ! -d "$USERS_DIR" ] || [ -z "$(ls -A "$USERS_DIR" 2>/dev/null)" ]; then
    echo "Keine Projekte gefunden."
    exit 0
fi

for USER_DIR in "$USERS_DIR"/*; do
    if [ -d "$USER_DIR" ]; then
        USERNAME=$(basename "$USER_DIR")
        echo "User: $USERNAME"
        echo "────────────────────────────────────────────"

        PROJECT_COUNT=0
        for PROJECT_DIR in "$USER_DIR"/*; do
            if [ -d "$PROJECT_DIR" ] && [ -f "$PROJECT_DIR/docker-compose.yml" ]; then
                PROJECT_NAME=$(basename "$PROJECT_DIR")
                PROJECT_COUNT=$((PROJECT_COUNT + 1))

                # Container Status prüfen
                cd "$PROJECT_DIR"
                CONTAINERS=$(docker-compose ps -q 2>/dev/null | wc -l)
                RUNNING=$(docker-compose ps 2>/dev/null | grep "Up" | wc -l)

                STATUS="Gestoppt"
                if [ "$RUNNING" -gt 0 ]; then
                    STATUS="Läuft ($RUNNING/$CONTAINERS Container)"
                fi

                # Port aus .env lesen
                PORT=""
                if [ -f ".env" ]; then
                    PORT=$(grep "EXPOSED_PORT" .env | cut -d= -f2)
                fi

                echo "  [$PROJECT_COUNT] $PROJECT_NAME"
                echo "      Status: $STATUS"
                if [ -n "$PORT" ]; then
                    echo "      Port:   $PORT"
                fi
                echo "      Pfad:   $PROJECT_DIR"
                echo ""
            fi
        done

        if [ $PROJECT_COUNT -eq 0 ]; then
            echo "  Keine Projekte"
            echo ""
        fi
    fi
done

echo "════════════════════════════════════════════"
echo "Docker Container Übersicht:"
echo "────────────────────────────────────────────"
docker ps --filter "network=dployr-network" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo "════════════════════════════════════════════"
