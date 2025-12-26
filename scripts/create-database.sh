#!/bin/bash

# Script to create a new database with its own user
# Usage: ./create-database.sh <username> <database_name>

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
DB_NAME=$2

# Validation
if [ -z "$USERNAME" ] || [ -z "$DB_NAME" ]; then
    echo "Usage: $0 <username> <database_name>"
    echo ""
    echo "Example: $0 user1 user1_myapp"
    exit 1
fi

# Generate DB user and password
DB_USER="${USERNAME}_${DB_NAME}"
DB_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)

# MariaDB container name
MARIADB_CONTAINER="dployr-mariadb"

# Check if MariaDB is running
if ! docker ps | grep -q "$MARIADB_CONTAINER"; then
    echo "Error: MariaDB container '$MARIADB_CONTAINER' is not running!"
    echo "Please start the infrastructure first:"
    echo "  cd infrastructure && docker-compose up -d"
    exit 1
fi

echo "Creating database and user..."
echo "Database: $DB_NAME"
echo "User:     $DB_USER"

# Execute SQL commands
docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}" <<EOF
-- Create database
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create user
CREATE USER IF NOT EXISTS '$DB_USER'@'%' IDENTIFIED BY '$DB_PASSWORD';

-- Grant privileges (only for this database)
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'%';

FLUSH PRIVILEGES;

-- Output info
SELECT 'Database created' AS status;
EOF

# Save credentials
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
CREDS_FILE="$BASE_DIR/users/$USERNAME/.db-credentials"

mkdir -p "$BASE_DIR/users/$USERNAME"
echo "" >> "$CREDS_FILE"
echo "# Database: $DB_NAME (created: $(date))" >> "$CREDS_FILE"
echo "DB_DATABASE=$DB_NAME" >> "$CREDS_FILE"
echo "DB_USERNAME=$DB_USER" >> "$CREDS_FILE"
echo "DB_PASSWORD=$DB_PASSWORD" >> "$CREDS_FILE"

echo ""
echo "════════════════════════════════════════════"
echo "✓ Database created successfully!"
echo "════════════════════════════════════════════"
echo "Database:   $DB_NAME"
echo "User:       $DB_USER"
echo "Password:   $DB_PASSWORD"
echo ""
echo "Host:       dployr-mariadb (in Docker network)"
echo "            $SERVER_IP:$MARIADB_PORT (external)"
echo "Port:       3306"
echo ""
echo "Credentials saved in:"
echo "$CREDS_FILE"
echo ""
echo "Add these values to your project's .env file:"
echo "  DB_DATABASE=$DB_NAME"
echo "  DB_USERNAME=$DB_USER"
echo "  DB_PASSWORD=$DB_PASSWORD"
echo "════════════════════════════════════════════"
