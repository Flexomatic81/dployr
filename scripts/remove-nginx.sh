#!/bin/bash

# Script to remove an existing Nginx installation on the host
# IMPORTANT: Only run if Nginx is no longer needed!

set -e

echo "════════════════════════════════════════════"
echo "Remove Nginx Host Installation"
echo "════════════════════════════════════════════"
echo ""
echo "WARNING: This script completely removes Nginx from the host system!"
echo "This is safe because our Docker setup uses its own Nginx containers."
echo ""
read -p "Do you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "[1/6] Checking if Nginx is installed..."

if ! command -v nginx &> /dev/null; then
    echo "✓ Nginx is not installed (good!)"
    echo ""
    echo "Checking ports 80 and 443 anyway..."
    netstat -tulpn | grep -E ':(80|443) ' || echo "✓ Ports 80 and 443 are free"
    exit 0
fi

echo "✓ Nginx found, removing..."
echo ""

# Show Nginx version
echo "Installed version:"
nginx -v 2>&1 || true
echo ""

# Stop Nginx
echo "[2/6] Stopping Nginx service..."
systemctl stop nginx 2>/dev/null || service nginx stop 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true
echo "✓ Nginx stopped"
echo ""

# Uninstall Nginx
echo "[3/6] Uninstalling Nginx packages..."
if command -v apt-get &> /dev/null; then
    # Debian/Ubuntu
    apt-get purge -y nginx nginx-common nginx-core nginx-full 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
    apt-get autoclean 2>/dev/null || true
elif command -v yum &> /dev/null; then
    # CentOS/RHEL
    yum remove -y nginx 2>/dev/null || true
fi
echo "✓ Packages uninstalled"
echo ""

# Remove configuration files
echo "[4/6] Removing configuration files..."
rm -rf /etc/nginx
rm -rf /var/log/nginx
rm -rf /var/lib/nginx
rm -rf /usr/share/nginx
echo "✓ Configuration removed"
echo ""

# Remove user/group (optional)
echo "[5/6] Removing nginx user/group..."
userdel nginx 2>/dev/null || true
groupdel nginx 2>/dev/null || true
echo "✓ User/group removed"
echo ""

# Port check
echo "[6/6] Checking ports..."
echo ""
if netstat -tulpn | grep -E ':(80|443) '; then
    echo "⚠ WARNING: Port 80 or 443 is still in use!"
    echo "Check which process is using the ports."
else
    echo "✓ Ports 80 and 443 are free"
fi
echo ""

echo "════════════════════════════════════════════"
echo "✓ Nginx successfully removed!"
echo "════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo ""
echo "1. Check if Docker and NPM are running:"
echo "   docker ps"
echo ""
echo "2. Start the Docker setup:"
echo "   ./quick-start.sh"
echo ""
echo "3. NPM should now be able to use ports 80/443"
echo "   (if NPM runs on this host)"
echo ""
echo "════════════════════════════════════════════"
