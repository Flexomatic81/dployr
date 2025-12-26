#!/bin/bash

# Interactive script to create a new user project

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"

# Load common functions
source "$SCRIPT_DIR/common.sh"

# Check Docker
check_docker

# Load central configuration
load_config "$SCRIPT_DIR"

echo ""
echo "═══════════════════════════════════════════="
echo "   Create New Webserver Project"
echo "═══════════════════════════════════════════="
echo ""

# 1. Ask for username
echo -e "${BLUE}1. Username:${NC}"
echo -n "Enter username (default: $DEFAULT_USER): "
read USERNAME
USERNAME=${USERNAME:-$DEFAULT_USER}
echo -e "${GREEN}✓${NC} Username: $USERNAME"
echo ""

# 2. Ask for project name
echo -e "${BLUE}2. Project name:${NC}"
echo -n "Enter project name: "
read PROJECT_NAME

while [ -z "$PROJECT_NAME" ]; do
    echo -e "${YELLOW}⚠${NC} Project name cannot be empty!"
    echo -n "Enter project name: "
    read PROJECT_NAME
done

# Check if project already exists
PROJECT_DIR="$BASE_DIR/users/$USERNAME/$PROJECT_NAME"
if [ -d "$PROJECT_DIR" ]; then
    echo -e "${YELLOW}⚠${NC} Error: Project $PROJECT_NAME for user $USERNAME already exists!"
    exit 1
fi

echo -e "${GREEN}✓${NC} Project name: $PROJECT_NAME"
echo ""

# 3. Select template
echo -e "${BLUE}3. Project template:${NC}"
echo "1) Static Website (HTML/CSS/JS)"
echo "2) PHP Website (PHP + Nginx + Database)"
echo "3) Node.js App (Express + Database)"
echo -n "Select template (1-3, default: 1): "
read TEMPLATE_CHOICE
TEMPLATE_CHOICE=${TEMPLATE_CHOICE:-1}

case $TEMPLATE_CHOICE in
    1)
        TEMPLATE="static-website"
        TEMPLATE_NAME="Static Website"
        NEEDS_DB_DEFAULT="n"
        ;;
    2)
        TEMPLATE="php-website"
        TEMPLATE_NAME="PHP Website"
        NEEDS_DB_DEFAULT="y"
        ;;
    3)
        TEMPLATE="nodejs-app"
        TEMPLATE_NAME="Node.js App"
        NEEDS_DB_DEFAULT="y"
        ;;
    *)
        echo -e "${YELLOW}⚠${NC} Invalid selection, using default: Static Website"
        TEMPLATE="static-website"
        TEMPLATE_NAME="Static Website"
        NEEDS_DB_DEFAULT="n"
        ;;
esac

TEMPLATE_PATH="$BASE_DIR/templates/$TEMPLATE"
if [ ! -d "$TEMPLATE_PATH" ]; then
    echo -e "${YELLOW}⚠${NC} Error: Template '$TEMPLATE' does not exist!"
    exit 1
fi

echo -e "${GREEN}✓${NC} Template: $TEMPLATE_NAME"
echo ""

# 4. Select port
echo -e "${BLUE}4. Port configuration:${NC}"

# Find next available port
NEXT_PORT=8001
while docker ps --format '{{.Ports}}' | grep -q "0.0.0.0:$NEXT_PORT"; do
    NEXT_PORT=$((NEXT_PORT + 1))
done

echo "Next available port: $NEXT_PORT"
echo -n "Use port (Enter for $NEXT_PORT, or enter custom port): "
read EXPOSED_PORT
EXPOSED_PORT=${EXPOSED_PORT:-$NEXT_PORT}

echo -e "${GREEN}✓${NC} Port: $EXPOSED_PORT"
echo ""

# 5. GitHub Repository (optional)
echo -e "${BLUE}5. GitHub Integration (optional):${NC}"
echo -n "GitHub repository URL (leave empty for later): "
read GITHUB_REPO

if [ -n "$GITHUB_REPO" ]; then
    echo -e "${GREEN}✓${NC} GitHub: $GITHUB_REPO"
fi
echo ""

# 6. Database (only for PHP and Node.js)
CREATE_DATABASE="n"
if [ "$TEMPLATE" != "static-website" ]; then
    echo -e "${BLUE}6. Database:${NC}"
    echo -n "Create database? (y/n, default: $NEEDS_DB_DEFAULT): "
    read CREATE_DATABASE
    CREATE_DATABASE=${CREATE_DATABASE:-$NEEDS_DB_DEFAULT}

    if [ "$CREATE_DATABASE" = "y" ] || [ "$CREATE_DATABASE" = "Y" ]; then
        CREATE_DATABASE="y"

        # Suggest database name
        DEFAULT_DB_NAME="${PROJECT_NAME}_db"
        echo -n "Database name (default: $DEFAULT_DB_NAME): "
        read DB_NAME
        DB_NAME=${DB_NAME:-$DEFAULT_DB_NAME}

        # Sanitize database name (only alphanumeric and underscores)
        DB_NAME=$(echo "$DB_NAME" | sed 's/[^a-zA-Z0-9_]/_/g')

        echo -e "${GREEN}✓${NC} Database: $DB_NAME"
    fi
    echo ""
fi

# Summary
echo ""
echo "═══════════════════════════════════════════="
echo "   Summary"
echo "═══════════════════════════════════════════="
echo "Username:  $USERNAME"
echo "Project:   $PROJECT_NAME"
echo "Template:  $TEMPLATE_NAME"
echo "Port:      $EXPOSED_PORT"
if [ -n "$GITHUB_REPO" ]; then
    echo "GitHub:    $GITHUB_REPO"
fi
if [ "$CREATE_DATABASE" = "y" ]; then
    echo "Database:  $DB_NAME"
fi
echo "Path:      $PROJECT_DIR"
echo "═══════════════════════════════════════════="
echo ""
echo -n "Create project? (y/n, default: y): "
read CONFIRM
CONFIRM=${CONFIRM:-y}

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Creating project..."
echo ""

# Create user directory (if not exists)
if [ ! -d "$BASE_DIR/users/$USERNAME" ]; then
    echo "→ Creating user directory: $BASE_DIR/users/$USERNAME"
    mkdir -p "$BASE_DIR/users/$USERNAME"
fi

# Create project from template
echo "→ Copying template to $PROJECT_DIR"
cp -r "$TEMPLATE_PATH" "$PROJECT_DIR"

# Set permissions (for Docker compatibility)
echo "→ Setting permissions..."
find "$PROJECT_DIR" -type d -exec chmod 755 {} \;
find "$PROJECT_DIR" -type f -exec chmod 644 {} \;

# Create and configure .env file
if [ -f "$PROJECT_DIR/.env.example" ]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"

    # Set port in .env
    sed -i "s/EXPOSED_PORT=.*/EXPOSED_PORT=$EXPOSED_PORT/" "$PROJECT_DIR/.env"

    # Set project name in .env
    SAFE_PROJECT_NAME=$(echo "$PROJECT_NAME" | sed 's/[^a-zA-Z0-9]/-/g')
    sed -i "s/PROJECT_NAME=.*/PROJECT_NAME=$SAFE_PROJECT_NAME/" "$PROJECT_DIR/.env"

    echo -e "${GREEN}✓${NC} .env file created and configured"
fi

# Clone GitHub repository (if provided)
if [ -n "$GITHUB_REPO" ]; then
    echo "→ Cloning GitHub repository..."
    rm -rf "$PROJECT_DIR/html"

    if git clone "$GITHUB_REPO" "$PROJECT_DIR/html" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Repository cloned successfully"

        # Set permissions after git clone
        find "$PROJECT_DIR/html" -type d -exec chmod 755 {} \;
        find "$PROJECT_DIR/html" -type f -exec chmod 644 {} \;
    else
        echo -e "${YELLOW}⚠${NC} Warning: Git clone failed. Using template HTML."
        echo "   Make sure your SSH key is added to GitHub."
    fi
fi

# Create database (if requested)
if [ "$CREATE_DATABASE" = "y" ]; then
    echo ""
    echo "→ Creating database..."

    # Check if MariaDB is running
    MARIADB_CONTAINER="dployr-mariadb"
    if ! docker ps | grep -q "$MARIADB_CONTAINER"; then
        echo -e "${YELLOW}⚠${NC} Warning: MariaDB container is not running!"
        echo "   Start infrastructure first: cd infrastructure && docker compose up -d"
        echo "   Database was NOT created!"
    else
        # Generate DB user and password
        DB_USER="${USERNAME}_$(echo $DB_NAME | sed 's/_db$//')"
        DB_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)

        # Read root password from infrastructure .env
        if [ -f "$BASE_DIR/infrastructure/.env" ]; then
            source "$BASE_DIR/infrastructure/.env"
        fi
        MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-ChangeMeInProduction123!}

        # Execute SQL commands
        docker exec -i "$MARIADB_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<EOF 2>/dev/null
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'%' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'%';
FLUSH PRIVILEGES;
EOF

        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓${NC} Database created successfully"

            # Add credentials to .env
            if [ -f "$PROJECT_DIR/.env" ]; then
                echo "" >> "$PROJECT_DIR/.env"
                echo "# Database credentials (auto-generated)" >> "$PROJECT_DIR/.env"
                echo "DB_HOST=dployr-mariadb" >> "$PROJECT_DIR/.env"
                echo "DB_PORT=3306" >> "$PROJECT_DIR/.env"
                echo "DB_DATABASE=$DB_NAME" >> "$PROJECT_DIR/.env"
                echo "DB_USERNAME=$DB_USER" >> "$PROJECT_DIR/.env"
                echo "DB_PASSWORD=$DB_PASSWORD" >> "$PROJECT_DIR/.env"

                echo -e "${GREEN}✓${NC} Database credentials saved to .env"
            fi

            # Also save credentials in separate file
            CREDS_FILE="$BASE_DIR/users/$USERNAME/.db-credentials"
            echo "" >> "$CREDS_FILE"
            echo "# Database: $DB_NAME (created: $(date))" >> "$CREDS_FILE"
            echo "DB_DATABASE=$DB_NAME" >> "$CREDS_FILE"
            echo "DB_USERNAME=$DB_USER" >> "$CREDS_FILE"
            echo "DB_PASSWORD=$DB_PASSWORD" >> "$CREDS_FILE"

            # Save database info for later display
            DB_INFO="
═══════════════════════════════════════════=
   Database Information
═══════════════════════════════════════════=
Database:   $DB_NAME
User:       $DB_USER
Password:   $DB_PASSWORD
Host:       dployr-mariadb (in Docker network)
            $SERVER_IP:$MARIADB_PORT (external)
Port:       3306

Credentials saved in:
- $PROJECT_DIR/.env
- $CREDS_FILE
═══════════════════════════════════════════="
        else
            echo -e "${YELLOW}⚠${NC} Error creating database"
        fi
    fi
fi

echo ""
echo "═══════════════════════════════════════════="
echo -e "   ${GREEN}✓ Project created successfully!${NC}"
echo "═══════════════════════════════════════════="
echo ""
echo "Next steps:"
echo ""
echo "1. Start container:"
echo "   cd $PROJECT_DIR"
echo "   docker compose up -d"
echo ""
echo "2. Open in browser:"
echo "   http://$SERVER_IP:$EXPOSED_PORT"
echo ""
echo "3. Edit with VS Code Remote SSH:"
echo "   Remote-SSH → $DEFAULT_USER@$SERVER_IP"
echo "   Open Folder → $PROJECT_DIR/html"
echo ""
echo "4. Configure domain in NPM:"
echo "   Domain → $SERVER_IP:$EXPOSED_PORT"
echo ""
echo "═══════════════════════════════════════════="

# Show database info (if created)
if [ -n "$DB_INFO" ]; then
    echo "$DB_INFO"
fi

echo ""

# Start container now?
echo -n "Start container now? (y/n, default: y): "
read START_NOW
START_NOW=${START_NOW:-y}

if [ "$START_NOW" = "y" ] || [ "$START_NOW" = "Y" ]; then
    echo ""
    echo "Starting container..."
    cd "$PROJECT_DIR"
    docker compose up -d
    echo ""
    echo -e "${GREEN}✓ Container started!${NC}"
    echo "Website available at: http://$SERVER_IP:$EXPOSED_PORT"

    if [ "$CREATE_DATABASE" = "y" ]; then
        echo ""
        echo "phpMyAdmin: http://$SERVER_IP:$PHPMYADMIN_PORT"
        echo "→ Login with: $DB_USER / $DB_PASSWORD"
    fi
fi

echo ""
