#!/bin/bash

# Stoppt die zentrale Infrastruktur

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
INFRA_DIR="$BASE_DIR/infrastructure"

echo "Stoppe Infrastruktur..."

cd "$INFRA_DIR"
docker-compose down

echo ""
echo "✓ Infrastruktur gestoppt"
echo ""
echo "Hinweis: User-Container sind davon nicht betroffen"
echo "Um alle User-Container zu stoppen:"
echo "  docker ps -q --filter network=deployr-network | xargs -r docker stop"
