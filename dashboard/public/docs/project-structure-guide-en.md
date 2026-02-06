# Project Structure Guide for Dployr

This guide explains how your project needs to be structured so it can be properly deployed and started in Dployr.

---

## Table of Contents

1. [Basic Concept](#basic-concept)
2. [Standard Templates](#standard-templates)
3. [Custom Docker-Compose Projects](#custom-docker-compose-projects)
4. [Application Services vs. Infrastructure Services](#application-services-vs-infrastructure-services)
5. [Creating a Dockerfile](#creating-a-dockerfile)
6. [Examples](#examples)
7. [Environment Variables](#environment-variables)
8. [Port Mapping](#port-mapping)
9. [Database Integration](#database-integration)
10. [Common Mistakes](#common-mistakes)

---

## Basic Concept

Dployr deploys projects as Docker containers. Each project requires either:

- **A standard template** (Static, PHP, Node.js, Python) - Dployr generates the Docker configuration automatically
- **A custom `docker-compose.yml`** - You define the container configuration yourself

### Directory Structure

```
projectname/
├── docker-compose.yml    # Docker config (automatic or custom)
├── .env                  # System variables (managed by Dployr)
└── html/                 # Your project files
    ├── Dockerfile        # If using custom containers
    ├── .env              # App environment variables
    └── ...               # Your source code
```

The `docker-compose.yml` can also be located in a subdirectory (e.g., `html/docker/docker-compose.yml`). Dployr detects this automatically.

---

## Standard Templates

For simple projects, you can use a template:

| Template | Description | Detected by |
|----------|-------------|-------------|
| Static Website | Nginx web server | `index.html` |
| PHP Website | Nginx + PHP 8.3 FPM | `index.php` or `composer.json` |
| Node.js App | Node.js 20 | `package.json` |
| Python Flask | Python + Flask | `requirements.txt` + Flask |
| Python Django | Python + Django | `requirements.txt` + Django |

With templates, you don't need to create a Dockerfile - Dployr handles it for you.

---

## Custom Docker-Compose Projects

If your project includes a `docker-compose.yml`, it will be detected as a **custom project**. This gives you full control but requires proper configuration.

### Important: Application services must be included

Your `docker-compose.yml` must contain at least one **application service** - a service that runs your actual app. Infrastructure services (databases, caches, etc.) alone are not sufficient.

### Minimal Structure

```yaml
version: "3.8"

services:
  # Application service (with build: directive)
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"

  # Infrastructure service (optional)
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### Detection Rules

A service is classified as an **application service** if:
- It has a `build:` directive (builds from a Dockerfile), OR
- It uses an unknown image (e.g., `myapp:latest`)

A service is classified as an **infrastructure service** if:
- It uses a known infrastructure image (e.g., `postgres`, `redis`, `nginx`, `keycloak`)
- AND has no `build:` directive

---

## Application Services vs. Infrastructure Services

### Infrastructure Services (detected automatically)

Databases, caches, search engines, auth servers, message brokers, reverse proxies, monitoring, and admin tools:

`mysql`, `mariadb`, `postgres`, `mongo`, `redis`, `memcached`, `elasticsearch`, `meilisearch`, `keycloak`, `rabbitmq`, `kafka`, `nginx`, `traefik`, `prometheus`, `grafana`, `adminer`, `phpmyadmin`, `minio`, and more.

### Application Services (your app)

Everything that runs your application logic:
- API servers (Express, NestJS, FastAPI, Laravel, Django)
- Frontend servers (Next.js, Nuxt.js, SvelteKit)
- Workers / background jobs
- Custom microservices

---

## Creating a Dockerfile

Each application service needs a Dockerfile. Here are examples for common technologies:

### Node.js / Express / NestJS

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
```

### Next.js (SSR with Standalone Output)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

Important: You must set `output: 'standalone'` in `next.config.js`.

### PHP / Laravel

```dockerfile
FROM php:8.3-fpm

RUN docker-php-ext-install pdo pdo_mysql

WORKDIR /var/www/html

COPY . .
RUN composer install --no-dev --optimize-autoloader

EXPOSE 9000
CMD ["php-fpm"]
```

### Python / Flask

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]
```

---

## Examples

### Node.js API + PostgreSQL

```yaml
version: "3.8"

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://user:pass@db:5432/mydb
    depends_on:
      - db

  db:
    image: postgres:16
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: mydb
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### Next.js Frontend + NestJS API + Redis

```yaml
version: "3.8"

services:
  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    ports:
      - "3000:3000"
    depends_on:
      - api

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "4000:4000"
    environment:
      REDIS_URL: redis://cache:6379
    depends_on:
      - cache

  cache:
    image: redis:7-alpine

volumes: {}
```

### PHP + MariaDB + Adminer

```yaml
version: "3.8"

services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "80:80"
    depends_on:
      - db

  db:
    image: mariadb:11
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: myapp
    volumes:
      - dbdata:/var/lib/mysql

  adminer:
    image: adminer
    ports:
      - "8080:8080"

volumes:
  dbdata:
```

---

## Environment Variables

### Two .env Files

1. **Project root `.env`** - Managed by Dployr (PORT, container name, etc.)
2. **`html/.env`** - Your app environment variables (DB credentials, API keys, etc.)

You can edit `html/.env` through the Dployr dashboard (under "Environment Variables").

### Referencing in docker-compose.yml

```yaml
services:
  app:
    build: .
    env_file:
      - .env
    environment:
      NODE_ENV: production
```

---

## Port Mapping

Dployr automatically assigns an external port to each project and remaps internal ports. This means:

- The ports in your `docker-compose.yml` are automatically adjusted
- Your services are accessible via the port shown in the dashboard
- Internally, your containers can still communicate using their original ports

You don't need to worry about port conflicts - Dployr resolves them automatically.

---

## Database Integration

### Option 1: Database in docker-compose.yml (recommended for custom projects)

Define the database as a service in your `docker-compose.yml`. Use named volumes for data persistence:

```yaml
services:
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data    # Named volume - persists

volumes:
  pgdata:
```

### Option 2: Dployr-managed database (for template projects)

For standard template projects, Dployr can automatically create a MariaDB or PostgreSQL database. Credentials are configured in the `.env` file.

---

## Common Mistakes

### 1. Only infrastructure services defined

**Problem:** The `docker-compose.yml` only contains databases, caches, etc., but no application services.

**Solution:** Add at least one service with a `build:` directive that runs your application.

### 2. Missing Dockerfile

**Problem:** A service has `build: .`, but there is no `Dockerfile` in the specified directory.

**Solution:** Create an appropriate Dockerfile for your technology (see examples above).

### 3. Monorepo without containers

**Problem:** In monorepos (Turborepo, Nx, Lerna), apps are often not containerized.

**Solution:** Create a separate Dockerfile for each app. Use multi-stage builds to build from the root directory:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm install
RUN npx turbo build --filter=my-app

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/apps/my-app/dist ./
CMD ["node", "index.js"]
```

### 4. docker-compose.yml in a subdirectory

**Not a problem:** Dployr automatically detects when the `docker-compose.yml` is in a subdirectory like `docker/` and adjusts build contexts and volume paths accordingly.

### 5. Host volumes instead of named volumes

**Problem:** Relative paths like `./data` are rewritten by Dployr to container paths.

**Solution:** Use named volumes for data that Docker should manage:

```yaml
# Correct: Named volume
volumes:
  - pgdata:/var/lib/postgresql/data

# Gets rewritten: Relative volume
volumes:
  - ./data:/var/lib/postgresql/data
```
