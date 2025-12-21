# Dployr

**Docker-basierte Multi-User Hosting-Plattform für Webprojekte.**

Dployr ermöglicht mehreren Usern, isolierte Web-Projekte auf einem gemeinsamen Linux-Server zu betreiben. Mit Web-Dashboard, automatischer Datenbank-Erstellung und GitHub-Integration.

<p align="center">
  <img src="docs/images/dashboard.png" alt="Dployr Dashboard" width="800">
</p>

## Voraussetzungen

| Komponente | Mindestversion | Hinweis |
|------------|----------------|---------|
| **Linux** | Beliebige Distribution | Debian, Ubuntu, CentOS, Fedora, Arch, etc. |
| **Docker** | 20.10+ | `curl -fsSL https://get.docker.com \| sh` |
| **Docker Compose** | v2.0+ | Als Plugin: `docker compose` |
| **Git** | 2.0+ | Optional, für GitHub-Integration |

## Features

- 🚀 **Interaktives Projekt-Setup** - Keine Parameter nötig, alles wird abgefragt
- 🖥️ **Web-Dashboard** - Browser-basierte Verwaltungsoberfläche
- 🌙 **Dark/Light Theme** - Umschaltbar mit Speicherung der Präferenz
- 🗄️ **Automatische Datenbank-Erstellung** - Optional beim Projekt-Setup
- 🔐 **Sichere Credentials** - Automatisch generiert und in .env gespeichert
- 📦 **GitHub Integration** - Repository direkt beim Setup klonen
- 📁 **ZIP-Upload** - Projekte per ZIP-Datei hochladen (bis 100 MB)
- 🎯 **Auto Port-Erkennung** - Findet automatisch freie Ports
- 🔍 **Automatische Projekttyp-Erkennung** - Erkennt Static/PHP/Node.js/Laravel/Next.js automatisch
- 📝 **Umgebungsvariablen-Editor** - .env im Browser bearbeiten mit DB-Credential-Injection
- 🐳 **Docker-basierte Isolation** - Jedes Projekt läuft isoliert
- 🗃️ **MariaDB + PostgreSQL** - Beide Datenbanken verfügbar mit phpMyAdmin & pgAdmin
- 📋 **Fertige Templates** - Static, PHP, Node.js sofort einsatzbereit
- 👥 **Multi-User mit Admin-Freischaltung** - Neue User müssen durch Admin genehmigt werden
- 🔄 **Projekt-Typ änderbar** - Nachträglicher Wechsel mit Empfehlungs-Warnung

## Schnellstart

### Option A: Docker Compose (Empfohlen)

Ein Befehl - alles läuft:

```bash
# 1. Repository klonen
git clone https://github.com/dein-username/dployr.git /opt/dployr
cd /opt/dployr

# 2. Konfiguration erstellen
cp .env.example .env
nano .env  # Passwörter setzen!

# 3. Alles starten
docker compose up -d

# 4. Browser öffnen → Setup-Wizard
# http://<SERVER_IP>:3000/setup
```

**Was wird gestartet:**
- MariaDB (Port 3306)
- PostgreSQL (Port 5432)
- phpMyAdmin (Port 8080)
- pgAdmin (Port 5050)
- Web-Dashboard (Port 3000)

Nach dem Setup-Wizard kannst du direkt loslegen!

## Verzeichnisstruktur

```
dployr/
├── docker-compose.yml         # ⭐ Haupt-Datei - startet alles
├── .env                       # Konfiguration (aus .env.example)
├── .env.example               # Template für Konfiguration
│
├── infrastructure/            # MariaDB/phpMyAdmin Config
│   └── mariadb/              # DB-Konfiguration
│
├── users/                     # User-Projekte
│   └── <username>/
│       ├── .db-credentials           # Auto-generierte DB-Zugänge
│       └── <projektname>/
│           ├── docker-compose.yml
│           ├── .env                  # Projekt-Config + DB-Credentials
│           ├── html/                 # Website-Dateien (Git-Repo)
│           └── nginx/               # Nginx-Config
│
├── templates/                 # Projekt-Vorlagen
│   ├── static-website/       # HTML/CSS/JS
│   ├── php-website/          # PHP + Nginx
│   └── nodejs-app/           # Node.js Express
│
├── scripts/                   # Verwaltungs-Scripts
│   ├── create-project.sh     # Neues Projekt erstellen (interaktiv!)
│   ├── create-database.sh    # Datenbank manuell erstellen
│   ├── delete-project.sh     # Projekt löschen
│   ├── delete-user.sh        # User mit allen Projekten löschen
│   └── list-projects.sh      # Alle Projekte anzeigen
│
├── dashboard/                # Web-Dashboard (Node.js)
│   ├── Dockerfile
│   └── src/                  # Dashboard Quellcode
│
└── README.md                # Diese Datei
```

## Wichtige Befehle

### Projekt-Verwaltung

```bash
# Neues Projekt erstellen (INTERAKTIV - empfohlen!)
./scripts/create-project.sh

# Alte Methode (funktioniert noch):
./scripts/create-project.sh <username> <projektname> <template>

# Verfügbare Templates: static-website, php-website, nodejs-app

# Datenbank manuell erstellen (nur falls nötig)
./scripts/create-database.sh <username> <db-name>

# Alle Projekte auflisten
./scripts/list-projects.sh
```

### Projekt löschen

```bash
# Mit Script (empfohlen - fragt auch nach Datenbank-Löschung)
./scripts/delete-project.sh <username> <projektname>

# Manuell
cd /opt/dployr/users/<USER>/PROJEKTNAME
docker compose down
cd ..
rm -rf PROJEKTNAME
```

### User löschen

```bash
# Löscht alle Projekte, Container und Datenbanken des Users
./scripts/delete-user.sh <username>
```

### Web-Dashboard

Das Dashboard ist unter `http://<SERVER_IP>:3000` erreichbar und bietet:
- **Projekte erstellen** (drei Methoden):
  - Von Git-Repository (GitHub, GitLab, Bitbucket)
  - Per ZIP-Upload (bis 100 MB, automatisches Entpacken)
  - Von Template (Static, PHP, Node.js)
- **Automatische Projekttyp-Erkennung**: Static, PHP, Node.js, Laravel, Next.js
- **Projekttyp-Empfehlung**: Warnung bei Typ-Mismatch mit One-Click-Korrektur
- **Umgebungsvariablen-Editor**: .env direkt im Browser bearbeiten
  - `.env.example` automatisch erkennen und übernehmen
  - Datenbank-Credentials per Klick einfügen
- Container starten, stoppen, neustarten, löschen
- Container-Status und Logs anzeigen
- Git Pull für verbundene Repositories
- Datenbanken verwalten (MariaDB & PostgreSQL)
- Multi-User Login mit Admin-Freischaltung
- Dark/Light Theme Toggle
- Admin-Panel für Benutzerverwaltung

### Infrastruktur

```bash
# Starten
docker compose up -d

# Stoppen
docker compose down

# Status
docker ps --filter network=dployr-network
```

### Einzelnes Projekt

```bash
cd users/username/projektname

# Starten
docker compose up -d

# Logs
docker compose logs -f

# Stoppen
docker compose down

# Git-Updates holen (falls GitHub-Projekt)
cd html
git pull
```

## Services

Nach dem Start verfügbar:

| Service | Externer Zugriff | Docker Network |
|---------|-----------------|----------------|
| **MariaDB** | `<SERVER_IP>:3306` | `dployr-mariadb:3306` |
| **PostgreSQL** | `<SERVER_IP>:5432` | `dployr-postgresql:5432` |
| **phpMyAdmin** | `http://<SERVER_IP>:8080` | - |
| **pgAdmin** | `http://<SERVER_IP>:5050` | - |
| **Dashboard** | `http://<SERVER_IP>:3000` | - |

### Datenbank-Auswahl

Bei der Erstellung einer neuen Datenbank im Dashboard kannst du zwischen **MariaDB** und **PostgreSQL** wählen:

- **MariaDB**: MySQL-kompatibel, ideal für WordPress, Laravel, PHP-Projekte
- **PostgreSQL**: Fortschrittliche Features, ideal für komplexe Anwendungen, Django, Rails

Die Verbindungsdaten werden automatisch generiert und in `.db-credentials` gespeichert.

## VS Code Remote SSH

Die beste Methode um auf dem Server zu arbeiten:

```bash
# 1. Extension Remote - SSH installieren
# 2. Ctrl+Shift+P → Remote-SSH: Connect to Host
# 3. <USER>@<SERVER_IP>
# 4. Open Folder → /opt/dployr/users/<USER>/PROJEKTNAME/html
# 5. Dateien bearbeiten → Speichern = LIVE!
```

## Workflow: Projekt deployen

```
1. Lokal entwickeln in VS Code
   ↓
2. Deployment-Methode wählen:

   VARIANTE A (Git-Repository - Empfohlen für Versionierung):
   → git push zu GitHub/GitLab
   → Dashboard öffnen → Neues Projekt → Tab "Von Git-Repository"
   → Repository-URL eingeben (+ Token für private Repos)
   → Projekttyp wird automatisch erkannt
   → Projekt ist live!

   VARIANTE B (ZIP-Upload - Schnell & einfach):
   → Projekt als ZIP packen
   → Dashboard → Neues Projekt → Tab "ZIP-Upload"
   → ZIP hochladen (max. 100 MB)
   → Projekttyp wird automatisch erkannt
   → Projekt ist live!

   VARIANTE C (Template - Leeres Projekt):
   → Dashboard → Neues Projekt → Tab "Von Template"
   → Typ auswählen (Static/PHP/Node.js)
   → Dateien per VS Code Remote SSH bearbeiten

   VARIANTE D (Update bestehendes Git-Projekt):
   Dashboard → Projekt öffnen → "Pull" Button
   ODER: ssh <USER>@<SERVER_IP>
   cd /opt/dployr/users/<USER>/PROJEKT
   git pull
   ↓
3. Fertig! Website ist aktualisiert
```

## NPM Integration

Für jedes Projekt in Nginx Proxy Manager:

1. Proxy Host hinzufügen
2. Domain: `projekt.deine-domain.de`
3. Forward to: `<SERVER_IP>:PORT` (Port aus Projekt .env)
4. SSL aktivieren

## Automatische Features

### Port-Verwaltung
- Script findet automatisch nächsten freien Port
- Kein manuelles Nachzählen mehr!

### Datenbank-Credentials
- Automatisch generiert und sicher
- In `.env` und `.db-credentials` gespeichert
- Direkt einsatzbereit in PHP/Node.js

### Berechtigungen
- Automatisch korrekt gesetzt (755/644)
- Kein 403 Forbidden mehr!

### Projekttyp-Erkennung
Beim Erstellen (Git/ZIP) und auf der Projektseite wird der Typ automatisch erkannt:

| Erkannte Datei | Projekttyp |
|----------------|------------|
| `next.config.js` / `next.config.mjs` | Next.js (SSR) |
| `package.json` mit Build-Script | React/Vue (Static Build) |
| `package.json` | Node.js App |
| `artisan` / `symfony.lock` | Laravel/Symfony |
| `composer.json` / `*.php` | PHP Website |
| `index.html` | Statische Website |

Bei Typ-Mismatch zeigt die Projektseite eine Warnung mit One-Click-Korrektur.

### Git & ZIP Integration
- **Git**: Projekte direkt von GitHub/GitLab/Bitbucket erstellen
  - Unterstützt private Repos mit Personal Access Token
  - Git Pull direkt im Dashboard
- **ZIP-Upload**: Projekte per ZIP-Datei hochladen
  - Max. 100 MB Dateigröße
  - Automatisches Entpacken (auch verschachtelte Ordner)
- Projekttyp wird automatisch erkannt
- Passende Docker-Konfiguration wird generiert

## Quick Reference

```bash
# Neues Projekt
./scripts/create-project.sh

# Projekt löschen
./scripts/delete-project.sh <username> <projektname>

# User löschen (inkl. aller Projekte & Datenbanken)
./scripts/delete-user.sh <username>

# Git-Update
cd users/<USER>/PROJEKT/html && git pull

# Container neu starten
cd users/<USER>/PROJEKT && docker compose restart

# Logs anschauen
cd users/<USER>/PROJEKT && docker compose logs -f

# Alle laufenden Projekte
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

## Sicherheit

- MySQL Root Passwort in `.env` setzen (`MYSQL_ROOT_PASSWORD`)
- PostgreSQL Root Passwort in `.env` setzen (`POSTGRES_ROOT_PASSWORD`)
- pgAdmin Passwort in `.env` setzen (`PGADMIN_PASSWORD`)
- Jeder DB-User hat nur Zugriff auf seine eigenen Datenbanken
- Datenbanknamen werden mit Username prefixed (z.B. `<username>_meinprojekt`)
- Container sind netzwerk-isoliert
- SSL/TLS über Nginx Proxy Manager verwenden
- Automatisch generierte sichere Passwörter für DB-User
- Neue Benutzer müssen durch Admin freigeschaltet werden
- Server-IP wird im Setup-Wizard konfiguriert und sicher gespeichert

## Konfiguration (.env)

```bash
# Pflicht
MYSQL_ROOT_PASSWORD=DeinSicheresPasswort123!
POSTGRES_ROOT_PASSWORD=DeinSicheresPostgresPasswort123!
PGADMIN_PASSWORD=DeinPgAdminPasswort123!
SESSION_SECRET=  # openssl rand -base64 32

# Optional (Standardwerte)
DASHBOARD_PORT=3000
PHPMYADMIN_PORT=8080
PGADMIN_PORT=5050
PGADMIN_EMAIL=admin@local.dev
SERVER_IP=  # Wird automatisch erkannt
```
