#!/bin/bash

# Script to check which services are using important ports

echo "════════════════════════════════════════════"
echo "Port Overview for Webserver"
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

        # Process details
        local pid=$(netstat -tulpn 2>/dev/null | grep -E ":$port " | awk '{print $7}' | cut -d'/' -f1 | head -1)
        if [ -n "$pid" ] && [ "$pid" != "-" ]; then
            echo "Process info:"
            ps aux | grep -E "^[^ ]+ +$pid " | grep -v grep || true
        fi
    else
        echo "✓ Port is free"
    fi
    echo ""
}

# Web ports
check_port 80 "HTTP"
check_port 443 "HTTPS"
check_port 8080 "phpMyAdmin / Alternative HTTP"
check_port 3306 "MySQL/MariaDB"

# Example user ports
echo "User project ports (8001-8010):"
echo "─────────────────────────────────"
for port in {8001..8010}; do
    if netstat -tulpn 2>/dev/null | grep -E ":$port " > /dev/null; then
        echo "Port $port: IN USE"
        netstat -tulpn 2>/dev/null | grep -E ":$port " | awk '{print "  " $7}'
    fi
done
echo ""

# Docker containers
echo "Docker containers in dployr-network:"
echo "─────────────────────────────────"
if command -v docker &> /dev/null; then
    if docker network ls 2>/dev/null | grep -q dployr-network; then
        docker ps --filter "network=dployr-network" --format "{{.Names}}\t{{.Ports}}" 2>/dev/null || echo "No containers in dployr-network"
    else
        echo "dployr-network does not exist yet"
    fi
else
    echo "Docker not installed"
fi
echo ""

# Nginx check
echo "Nginx Status:"
echo "─────────────────────────────────"
if command -v nginx &> /dev/null; then
    echo "⚠ Nginx is installed on the host!"
    nginx -v 2>&1
    systemctl is-active nginx 2>/dev/null || service nginx status 2>/dev/null | head -3 || echo "Status unknown"
    echo ""
    echo "Recommendation: Remove host Nginx installation with:"
    echo "  ./scripts/remove-nginx.sh"
else
    echo "✓ No host Nginx installation (good!)"
fi
echo ""

echo "════════════════════════════════════════════"
echo "Summary:"
echo "════════════════════════════════════════════"
echo ""
echo "Required for this Docker setup:"
echo "  - Free: Port 80, 443 (for NPM, if on this host)"
echo "  - Free: Port 8080 (for phpMyAdmin)"
echo "  - Free: Port 3306 (for MariaDB, localhost only)"
echo "  - Free: Port 8001+ (for user projects)"
echo ""
echo "Nginx on host: NOT required!"
echo "Each Docker container brings its own web server."
echo ""
echo "════════════════════════════════════════════"
