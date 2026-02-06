# Projektstruktur-Anleitung für Dployr

Diese Anleitung erklärt, wie dein Projekt aufgebaut sein muss, damit es in Dployr korrekt deployed und gestartet werden kann.

---

## Inhaltsverzeichnis

1. [Grundlegendes Konzept](#grundlegendes-konzept)
2. [Standard-Templates](#standard-templates)
3. [Eigene Docker-Compose Projekte](#eigene-docker-compose-projekte)
4. [Anwendungs-Services vs. Infrastruktur-Services](#anwendungs-services-vs-infrastruktur-services)
5. [Dockerfile erstellen](#dockerfile-erstellen)
6. [Beispiele](#beispiele)
7. [Umgebungsvariablen](#umgebungsvariablen)
8. [Port-Mapping](#port-mapping)
9. [Datenbank-Integration](#datenbank-integration)
10. [Häufige Fehler](#häufige-fehler)

---

## Grundlegendes Konzept

Dployr deployt Projekte als Docker-Container. Jedes Projekt benötigt entweder:

- **Ein Standard-Template** (Static, PHP, Node.js, Python) - Dployr erzeugt die Docker-Konfiguration automatisch
- **Eine eigene `docker-compose.yml`** - Du definierst die Container-Konfiguration selbst

### Verzeichnisstruktur

```
projektname/
├── docker-compose.yml    # Docker-Konfiguration (automatisch oder benutzerdefiniert)
├── .env                  # System-Variablen (von Dployr verwaltet)
└── html/                 # Deine Projektdateien
    ├── Dockerfile        # Falls benutzerdefinierte Container
    ├── .env              # App-Umgebungsvariablen
    └── ...               # Dein Quellcode
```

Die `docker-compose.yml` kann sich auch in einem Unterverzeichnis befinden (z.B. `html/docker/docker-compose.yml`). Dployr erkennt das automatisch.

---

## Standard-Templates

Für einfache Projekte kannst du ein Template verwenden:

| Template | Beschreibung | Erkannt durch |
|----------|-------------|---------------|
| Static Website | Nginx Webserver | `index.html` |
| PHP Website | Nginx + PHP 8.3 FPM | `index.php` oder `composer.json` |
| Node.js App | Node.js 20 | `package.json` |
| Python Flask | Python + Flask | `requirements.txt` + Flask |
| Python Django | Python + Django | `requirements.txt` + Django |

Bei Templates musst du kein Dockerfile erstellen - Dployr übernimmt das.

---

## Eigene Docker-Compose Projekte

Wenn dein Projekt eine `docker-compose.yml` enthält, wird es als **Custom-Projekt** erkannt. Das gibt dir volle Kontrolle, erfordert aber eine korrekte Konfiguration.

### Wichtig: Anwendungs-Services müssen enthalten sein

Deine `docker-compose.yml` muss mindestens einen **Anwendungs-Service** enthalten - also einen Service, der deine eigentliche App ausführt. Reine Infrastruktur-Services (Datenbanken, Caches etc.) allein reichen nicht aus.

### Minimale Struktur

```yaml
version: "3.8"

services:
  # Anwendungs-Service (mit build: Direktive)
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"

  # Infrastruktur-Service (optional)
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### Erkennungsregel

Ein Service wird als **Anwendungs-Service** erkannt, wenn:
- Er eine `build:` Direktive hat (baut aus einem Dockerfile), ODER
- Er ein unbekanntes Image verwendet (z.B. `myapp:latest`)

Ein Service wird als **Infrastruktur-Service** erkannt, wenn:
- Er ein bekanntes Infrastruktur-Image verwendet (z.B. `postgres`, `redis`, `nginx`, `keycloak`)
- UND keine `build:` Direktive hat

---

## Anwendungs-Services vs. Infrastruktur-Services

### Infrastruktur-Services (werden erkannt)

Datenbanken, Caches, Suchmaschinen, Auth-Server, Message Broker, Reverse Proxies, Monitoring und Admin-Tools:

`mysql`, `mariadb`, `postgres`, `mongo`, `redis`, `memcached`, `elasticsearch`, `meilisearch`, `keycloak`, `rabbitmq`, `kafka`, `nginx`, `traefik`, `prometheus`, `grafana`, `adminer`, `phpmyadmin`, `minio` u.v.m.

### Anwendungs-Services (deine App)

Alles, was deine Applikationslogik ausführt:
- API-Server (Express, NestJS, FastAPI, Laravel, Django)
- Frontend-Server (Next.js, Nuxt.js, SvelteKit)
- Worker/Background Jobs
- Eigene Microservices

---

## Dockerfile erstellen

Jeder Anwendungs-Service braucht ein Dockerfile. Hier sind Beispiele für gängige Technologien:

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

### Next.js (SSR mit Standalone Output)

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

Wichtig: In `next.config.js` muss `output: 'standalone'` gesetzt sein.

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

## Beispiele

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

## Umgebungsvariablen

### Zwei .env-Dateien

1. **Projekt-Root `.env`** - Wird von Dployr verwaltet (PORT, Container-Name etc.)
2. **`html/.env`** - Deine App-Umgebungsvariablen (DB-Credentials, API-Keys etc.)

Die `html/.env` kannst du über das Dployr-Dashboard bearbeiten (Abschnitt "Environment Variables").

### In docker-compose.yml referenzieren

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

## Port-Mapping

Dployr weist jedem Projekt automatisch einen externen Port zu und mappt die internen Ports um. Das bedeutet:

- Die Ports in deiner `docker-compose.yml` werden automatisch angepasst
- Deine Services sind über den im Dashboard angezeigten Port erreichbar
- Intern können deine Container weiterhin über die Originale Ports kommunizieren

Du musst dich nicht um Port-Konflikte kümmern - Dployr löst das automatisch.

---

## Datenbank-Integration

### Option 1: Datenbank in docker-compose.yml (empfohlen für Custom-Projekte)

Definiere die Datenbank als Service in deiner `docker-compose.yml`. Verwende Named Volumes für Datenpersistenz:

```yaml
services:
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data    # Named Volume - bleibt erhalten

volumes:
  pgdata:
```

### Option 2: Dployr-Datenbank (für Template-Projekte)

Für Standard-Template-Projekte kann Dployr automatisch eine MariaDB- oder PostgreSQL-Datenbank anlegen. Die Zugangsdaten werden in der `.env` konfiguriert.

---

## Häufige Fehler

### 1. Nur Infrastruktur-Services definiert

**Problem:** Die `docker-compose.yml` enthält nur Datenbanken, Caches etc., aber keine App-Services.

**Lösung:** Füge mindestens einen Service mit `build:` Direktive hinzu, der deine Applikation ausführt.

### 2. Kein Dockerfile vorhanden

**Problem:** Ein Service hat `build: .`, aber kein `Dockerfile` im angegebenen Verzeichnis.

**Lösung:** Erstelle ein passendes Dockerfile für deine Technologie (siehe Beispiele oben).

### 3. Monorepo ohne Container

**Problem:** Bei Monorepos (Turborepo, Nx, Lerna) sind die Apps oft nicht containerisiert.

**Lösung:** Erstelle für jede App ein eigenes Dockerfile. Nutze Multi-Stage Builds, um vom Root-Verzeichnis aus zu bauen:

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

### 4. docker-compose.yml im Unterverzeichnis

**Kein Problem:** Dployr erkennt automatisch, wenn die `docker-compose.yml` in einem Unterverzeichnis wie `docker/` liegt, und passt die Build-Kontexte und Volume-Pfade entsprechend an.

### 5. Host-Volumes statt Named Volumes

**Problem:** Relative Pfade wie `./data` werden von Dployr in Container-Pfade umgeschrieben.

**Lösung:** Verwende Named Volumes für Daten, die Docker verwalten soll:

```yaml
# Richtig: Named Volume
volumes:
  - pgdata:/var/lib/postgresql/data

# Wird umgeschrieben: Relatives Volume
volumes:
  - ./data:/var/lib/postgresql/data
```
