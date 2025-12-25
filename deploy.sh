#!/bin/bash
# Dployr Deploy Script
# Aktualisiert das Repository und baut das Dashboard mit Versionsinformationen

set -e

cd "$(dirname "$0")"

echo "=== Dployr Deploy ==="

# Git Pull
echo "Aktualisiere Repository..."
git pull

# Versionsinformationen ermitteln
export GIT_HASH=$(git rev-parse --short HEAD)
export GIT_DATE=$(git log -1 --format=%cd --date=format:'%d.%m.%Y')

echo "Version: $GIT_HASH ($GIT_DATE)"

# Dashboard bauen
echo "Baue Dashboard..."
docker compose build dashboard

# Dashboard starten
echo "Starte Dashboard..."
docker compose up -d dashboard

echo "=== Fertig ==="
