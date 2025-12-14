#!/bin/bash

# Script zur Überprüfung welche Dienste die wichtigen Ports belegen

echo "════════════════════════════════════════════"
echo "Port-Übersicht für Webserver"
echo "════════════════════════════════════════════"
echo ""

check_port() {
    local port=$1
    local service=$2

    echo "Port $port ($service):"
    echo "─────────────────────────────────"

    if netstat -tulpn 2>/dev/null | grep -E ":$port " > /dev/null; then
        netstat -tulpn 2>/dev/null | grep -E ":$port " | head -5
        echo ""

        # Prozess-Details
        local pid=$(netstat -tulpn 2>/dev/null | grep -E ":$port " | awk '{print $7}' | cut -d'/' -f1 | head -1)
        if [ -n "$pid" ] && [ "$pid" != "-" ]; then
            echo "Prozess-Info:"
            ps aux | grep -E "^[^ ]+ +$pid " | grep -v grep || true
        fi
    else
        echo "✓ Port ist frei"
    fi
    echo ""
}

# Web-Ports
check_port 80 "HTTP"
check_port 443 "HTTPS"
check_port 8080 "phpMyAdmin / Alternative HTTP"
check_port 3306 "MySQL/MariaDB"

# Beispiel User-Ports
echo "User-Projekt Ports (8001-8010):"
echo "─────────────────────────────────"
for port in {8001..8010}; do
    if netstat -tulpn 2>/dev/null | grep -E ":$port " > /dev/null; then
        echo "Port $port: BELEGT"
        netstat -tulpn 2>/dev/null | grep -E ":$port " | awk '{print "  " $7}'
    fi
done
echo ""

# Docker Container
echo "Docker Container im deployr-network:"
echo "─────────────────────────────────"
if command -v docker &> /dev/null; then
    if docker network ls 2>/dev/null | grep -q deployr-network; then
        docker ps --filter "network=deployr-network" --format "{{.Names}}\t{{.Ports}}" 2>/dev/null || echo "Keine Container im deployr-network"
    else
        echo "deployr-network existiert noch nicht"
    fi
else
    echo "Docker nicht installiert"
fi
echo ""

# Nginx Check
echo "Nginx Status:"
echo "─────────────────────────────────"
if command -v nginx &> /dev/null; then
    echo "⚠ Nginx ist auf dem Host installiert!"
    nginx -v 2>&1
    systemctl is-active nginx 2>/dev/null || service nginx status 2>/dev/null | head -3 || echo "Status unbekannt"
    echo ""
    echo "Empfehlung: Nginx Host-Installation entfernen mit:"
    echo "  ./scripts/remove-nginx.sh"
else
    echo "✓ Keine Host-Nginx Installation (gut!)"
fi
echo ""

echo "════════════════════════════════════════════"
echo "Zusammenfassung:"
echo "════════════════════════════════════════════"
echo ""
echo "Für dieses Docker-Setup benötigt:"
echo "  - Frei: Port 80, 443 (für NPM, falls auf diesem Host)"
echo "  - Frei: Port 8080 (für phpMyAdmin)"
echo "  - Frei: Port 3306 (für MariaDB, nur localhost)"
echo "  - Frei: Port 8001+ (für User-Projekte)"
echo ""
echo "Nginx auf dem Host: NICHT benötigt!"
echo "Jeder Docker-Container bringt seinen eigenen Webserver mit."
echo ""
echo "════════════════════════════════════════════"
