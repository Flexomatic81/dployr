# Deployr

**Docker-basierte Multi-User Hosting-Plattform für Webprojekte.**

Deployr ermöglicht mehreren Usern, isolierte Web-Projekte auf einem gemeinsamen Linux-Server zu betreiben. Mit Web-Dashboard, automatischer Datenbank-Erstellung und GitHub-Integration.

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
- 🗄️ **Automatische Datenbank-Erstellung** - Optional beim Projekt-Setup
- 🔐 **Sichere Credentials** - Automatisch generiert und in .env gespeichert
- 📦 **GitHub Integration** - Repository direkt beim Setup klonen
- 🎯 **Auto Port-Erkennung** - Findet automatisch freie Ports
- 🐳 **Docker-basierte Isolation** - Jedes Projekt läuft isoliert
- 🗃️ **Zentrale MariaDB** - Mit User-Isolation und phpMyAdmin
- 📋 **Fertige Templates** - Static, PHP, Node.js sofort einsatzbereit

## Schnellstart

### Option A: Docker Compose (Empfohlen)

Ein Befehl - alles läuft:

```bash
# 1. Repository klonen
git clone https://github.com/dein-username/deployr.git /opt/deployr
cd /opt/deployr

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
- phpMyAdmin (Port 8080)
- Web-Dashboard (Port 3000)

Nach dem Setup-Wizard kannst du direkt loslegen!

## Verzeichnisstruktur

```
deployr/
├── docker-compose.yml         # ⭐ Haupt-Datei - startet alles
├── .env                       # Konfiguration (aus .env.example)
├── .env.example               # Template für Konfiguration
│
├── infrastructure/            # MariaDB/phpMyAdmin Config
│   └── mariadb/              # DB-Konfiguration
│
├── users/                     # User-Projekte
│   ├── mehmed/
│   │   ├── .db-credentials           # Auto-generierte DB-Zugänge
│   │   └── mein-projekt/
│   │       ├── docker-compose.yml
│   │       ├── .env                  # Projekt-Config + DB-Credentials
│   │       ├── html/                 # Website-Dateien (Git-Repo)
│   │       └── nginx/               # Nginx-Config
│   └── user2/
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
cd /opt/deployr/users/<USER>/PROJEKTNAME
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
- Projekte erstellen (von Template oder Git-Repository)
- Git-Integration: Projekte direkt von GitHub/GitLab/Bitbucket erstellen
- Container starten, stoppen, neustarten, löschen
- Container-Status und Logs anzeigen
- Git Pull für verbundene Repositories
- Datenbanken verwalten
- Multi-User Login

### Infrastruktur

```bash
# Starten
docker compose up -d

# Stoppen
docker compose down

# Status
docker ps --filter network=deployr-network
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

- **MariaDB**: `<SERVER_IP>:3306` (oder `deployr-mariadb:3306` im Docker Network)
- **phpMyAdmin**: `http://<SERVER_IP>:8080`

## VS Code Remote SSH

Die beste Methode um auf dem Server zu arbeiten:

```bash
# 1. Extension Remote - SSH installieren
# 2. Ctrl+Shift+P → Remote-SSH: Connect to Host
# 3. <USER>@<SERVER_IP> (z.B. mehmed@192.168.2.125)
# 4. Open Folder → /opt/deployr/users/mehmed/PROJEKTNAME/html
# 5. Dateien bearbeiten → Speichern = LIVE!
```

## Workflow: Von GitHub bis Live

```
1. Lokal entwickeln in VS Code
   ↓
2. git push zu GitHub
   ↓
3. Auf Server deployen:

   VARIANTE A (Web-Dashboard - Empfohlen):
   → Dashboard öffnen → Neues Projekt
   → Tab "Von Git-Repository"
   → Repository-URL eingeben (+ Token für private Repos)
   → Projekttyp wird automatisch erkannt
   → Projekt ist live!

   VARIANTE B (CLI Script):
   ./scripts/create-project.sh
   → GitHub-URL eingeben
   → Projekt ist live!

   VARIANTE C (Update bestehendes Git-Projekt):
   Dashboard → Projekt öffnen → "Pull" Button
   ODER: ssh <USER>@<SERVER_IP>
   cd /opt/deployr/users/mehmed/PROJEKT
   git pull

   VARIANTE D (VS Code Remote SSH):
   VS Code → Server → Source Control → Pull
   ↓
4. Fertig! Website ist aktualisiert
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

### GitHub Integration
- **Im Dashboard**: Projekt direkt von Git-Repository erstellen
  - Automatische Projekttyp-Erkennung (Static/PHP/Node.js)
  - Passende Docker-Konfiguration wird generiert
  - Unterstützt private Repos mit Personal Access Token
- **Per Script**: Repository beim Projekt-Setup klonen
- Git Pull direkt im Dashboard ausführen
- Berechtigungen werden automatisch gesetzt

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

- MySQL Root Passwort in `.env` setzen
- Jeder DB-User hat nur Zugriff auf seine eigenen Datenbanken
- Container sind netzwerk-isoliert
- SSL/TLS über Nginx Proxy Manager verwenden
- Automatisch generierte sichere Passwörter für DB-User
