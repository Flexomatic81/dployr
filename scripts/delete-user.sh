#!/bin/bash

# Script to delete a user with all projects and databases
# Usage: ./delete-user.sh <username>

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

# Validation
if [ -z "$USERNAME" ]; then
    echo "Usage: $0 <username>"
    echo ""
    echo "Example: $0 mehmed"
    echo ""
    echo "WARNING: This will delete ALL projects and databases of the user!"
    exit 1
fi

USER_DIR="$BASE_DIR/users/$USERNAME"

# Check if user exists
if [ ! -d "$USER_DIR" ]; then
    echo -e "${RED}✗ User '$USERNAME' does not exist!${NC}"
    echo "Path: $USER_DIR"
    exit 1
fi

# Collect projects
PROJECTS=$(find "$USER_DIR" -maxdepth 1 -mindepth 1 -type d -not -name ".*" 2>/dev/null || true)
PROJECT_COUNT=$(echo "$PROJECTS" | grep -c "." 2>/dev/null || echo "0")

# Read databases from .db-credentials
CREDS_FILE="$USER_DIR/.db-credentials"
DATABASES=""
if [ -f "$CREDS_FILE" ]; then
    DATABASES=$(grep "^DB_DATABASE=" "$CREDS_FILE" | cut -d'=' -f2 | sort -u)
fi
DB_COUNT=$(echo "$DATABASES" | grep -c "." 2>/dev/null || echo "0")

echo ""
echo "════════════════════════════════════════════"
echo -e "${RED}⚠ WARNING: Delete user${NC}"
echo "════════════════════════════════════════════"
echo ""
echo "User:       $USERNAME"
echo "Directory:  $USER_DIR"
echo ""

if [ "$PROJECT_COUNT" -gt 0 ]; then
    echo "Projects ($PROJECT_COUNT):"
    for project in $PROJECTS; do
        project_name=$(basename "$project")
        # Check if container is running
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "${USERNAME}-${project_name}"; then
            echo "  - $project_name (running)"
        else
            echo "  - $project_name"
        fi
    done
    echo ""
fi

if [ -n "$DATABASES" ] && [ "$DB_COUNT" -gt 0 ]; then
    echo "Databases ($DB_COUNT):"
    for db in $DATABASES; do
        echo "  - $db"
    done
    echo ""
fi

echo -e "${YELLOW}This action CANNOT be undone!${NC}"
echo ""
read -p "Really delete? Type '$USERNAME' to confirm: " CONFIRM

if [ "$CONFIRM" != "$USERNAME" ]; then
    echo ""
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Deleting user '$USERNAME'..."
echo ""

# 1. Stop and remove all containers
if [ "$PROJECT_COUNT" -gt 0 ]; then
    echo "[1/3] Stopping and removing containers..."
    for project in $PROJECTS; do
        project_name=$(basename "$project")
        if [ -f "$project/docker-compose.yml" ]; then
            echo "  Stopping $project_name..."
            cd "$project"
            docker compose down --volumes --remove-orphans 2>/dev/null || docker-compose down --volumes --remove-orphans 2>/dev/null || true
            cd "$BASE_DIR"
        fi
    done
    echo -e "  ${GREEN}✓${NC} Containers stopped"
else
    echo "[1/3] No projects found"
fi

# 2. Delete databases
MARIADB_CONTAINER="dployr-mariadb"
if [ -n "$DATABASES" ] && [ "$DB_COUNT" -gt 0 ] && docker ps | grep -q "$MARIADB_CONTAINER"; then
    echo "[2/3] Deleting databases..."

    # Read DB users from .db-credentials
    DB_USERS=""
    if [ -f "$CREDS_FILE" ]; then
        DB_USERS=$(grep "^DB_USERNAME=" "$CREDS_FILE" | cut -d'=' -f2 | sort -u)
    fi

    for db in $DATABASES; do
        echo "  Deleting database: $db"
        docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "DROP DATABASE IF EXISTS \`$db\`;" 2>/dev/null || true
    done

    for db_user in $DB_USERS; do
        echo "  Deleting DB user: $db_user"
        docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "DROP USER IF EXISTS '$db_user'@'%';" 2>/dev/null || true
    done

    docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" -e "FLUSH PRIVILEGES;" 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Databases deleted"
else
    echo "[2/3] No databases to delete"
fi

# 3. Delete user directory
echo "[3/3] Deleting user directory..."
rm -rf "$USER_DIR"
echo -e "  ${GREEN}✓${NC} Directory deleted"

echo ""
echo "════════════════════════════════════════════"
echo -e "${GREEN}✓ User '$USERNAME' deleted successfully!${NC}"
echo "════════════════════════════════════════════"
echo ""
echo "Deleted:"
if [ "$PROJECT_COUNT" -gt 0 ]; then
    echo "  - $PROJECT_COUNT project(s)"
fi
if [ "$DB_COUNT" -gt 0 ]; then
    echo "  - $DB_COUNT database(s)"
fi
echo "  - User directory: $USER_DIR"
echo ""
