#!/bin/bash

# Script to delete a single project
# Usage: ./delete-project.sh <username> <projectname>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"

# Load common functions
source "$SCRIPT_DIR/common.sh"

# Check Docker
check_docker

# Load central configuration
load_config "$SCRIPT_DIR"

USERNAME=$1
PROJECT_NAME=$2

# Validation
if [ -z "$USERNAME" ] || [ -z "$PROJECT_NAME" ]; then
    echo "Usage: $0 <username> <projectname>"
    echo ""
    echo "Example: $0 mehmed my-project"
    exit 1
fi

PROJECT_DIR="$BASE_DIR/users/$USERNAME/$PROJECT_NAME"

# Check if project exists
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}✗ Project '$PROJECT_NAME' does not exist!${NC}"
    echo "Path: $PROJECT_DIR"
    exit 1
fi

# Read project database from .env
PROJECT_DB=""
PROJECT_DB_USER=""
if [ -f "$PROJECT_DIR/.env" ]; then
    PROJECT_DB=$(grep "^DB_DATABASE=" "$PROJECT_DIR/.env" 2>/dev/null | cut -d'=' -f2 || true)
    PROJECT_DB_USER=$(grep "^DB_USERNAME=" "$PROJECT_DIR/.env" 2>/dev/null | cut -d'=' -f2 || true)
fi

# Check container status
CONTAINER_RUNNING=false
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "${USERNAME}-${PROJECT_NAME}"; then
    CONTAINER_RUNNING=true
fi

echo ""
echo "════════════════════════════════════════════"
echo -e "${YELLOW}⚠ Delete project${NC}"
echo "════════════════════════════════════════════"
echo ""
echo "User:       $USERNAME"
echo "Project:    $PROJECT_NAME"
echo "Directory:  $PROJECT_DIR"
if [ "$CONTAINER_RUNNING" = true ]; then
    echo -e "Status:     ${GREEN}running${NC}"
else
    echo "Status:     stopped"
fi
if [ -n "$PROJECT_DB" ]; then
    echo "Database:   $PROJECT_DB"
fi
echo ""
echo -e "${YELLOW}This action CANNOT be undone!${NC}"
echo ""
read -p "Really delete project '$PROJECT_NAME'? (y/N): " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo ""
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Deleting project '$PROJECT_NAME'..."
echo ""

# 1. Stop container
echo "[1/3] Stopping container..."
if [ -f "$PROJECT_DIR/docker-compose.yml" ]; then
    cd "$PROJECT_DIR"
    docker compose down --volumes --remove-orphans 2>/dev/null || docker-compose down --volumes --remove-orphans 2>/dev/null || true
    cd "$BASE_DIR"
    echo -e "  ${GREEN}✓${NC} Container stopped"
else
    echo "  No docker-compose.yml found"
fi

# 2. Delete database (optional)
MARIADB_CONTAINER="dployr-mariadb"
if [ -n "$PROJECT_DB" ] && docker ps | grep -q "$MARIADB_CONTAINER"; then
    echo "[2/3] Deleting database..."

    read -p "  Also delete database '$PROJECT_DB'? (y/N): " DELETE_DB

    if [ "$DELETE_DB" = "y" ] || [ "$DELETE_DB" = "Y" ]; then
        docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "DROP DATABASE IF EXISTS \`$PROJECT_DB\`;" 2>/dev/null || true

        if [ -n "$PROJECT_DB_USER" ]; then
            docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "DROP USER IF EXISTS '$PROJECT_DB_USER'@'%';" 2>/dev/null || true
        fi

        docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "FLUSH PRIVILEGES;" 2>/dev/null || true

        # Remove from .db-credentials
        CREDS_FILE="$BASE_DIR/users/$USERNAME/.db-credentials"
        if [ -f "$CREDS_FILE" ] && [ -n "$PROJECT_DB" ]; then
            # Create temp file without the DB entries
            grep -v "DB_DATABASE=$PROJECT_DB" "$CREDS_FILE" | grep -v "DB_USERNAME=$PROJECT_DB_USER" | grep -v "# Database: $PROJECT_DB" > "$CREDS_FILE.tmp" 2>/dev/null || true
            mv "$CREDS_FILE.tmp" "$CREDS_FILE" 2>/dev/null || true
        fi

        echo -e "  ${GREEN}✓${NC} Database deleted"
    else
        echo "  Database kept"
    fi
else
    echo "[2/3] No database to delete"
fi

# 3. Delete project directory
echo "[3/3] Deleting project directory..."
rm -rf "$PROJECT_DIR"
echo -e "  ${GREEN}✓${NC} Directory deleted"

echo ""
echo "════════════════════════════════════════════"
echo -e "${GREEN}✓ Project '$PROJECT_NAME' deleted successfully!${NC}"
echo "════════════════════════════════════════════"
echo ""
