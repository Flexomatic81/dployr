# Deployr

**Docker-basierte Multi-User Hosting-Plattform für Webprojekte.**

Deployr ermöglicht mehreren Usern, isolierte Web-Projekte auf einem gemeinsamen Linux-Server zu betreiben. Mit Web-Dashboard, automatischer Datenbank-Erstellung und GitHub-Integration.

> **Server-IP konfigurierbar**: Die IP-Adresse wird in `config.sh` zentral konfiguriert.
> Bei der Ersteinrichtung mit `./quick-start.sh` oder `./web-setup.sh` wird die IP automatisch abgefragt.

## Voraussetzungen

| Komponente | Mindestversion | Hinweis |
|------------|----------------|---------|
| **Linux** | Beliebige Distribution | Debian, Ubuntu, CentOS, Fedora, Arch, etc. |
| **Docker** | 20.10+ | `curl -fsSL https://get.docker.com \| sh` |
| **Docker Compose** | v2.0+ | Als Plugin: `docker compose` |
| **Git** | 2.0+ | Optional, für GitHub-Integration |
| **SSH-Zugang** | - | Für Remote-Verwaltung |

> Das `quick-start.sh` Script prüft automatisch ob Docker installiert ist und zeigt Installationsanleitungen.

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

### Option A: Web-Setup (Empfohlen)

Setup komplett über den Browser - kein SSH nötig:

```bash
# 1. Web-Setup starten
chmod +x web-setup.sh
./web-setup.sh

# 2. Browser öffnen
# http://<SERVER_IP>:3000

# 3. Setup-Wizard durchlaufen:
#    - Server-IP konfigurieren
#    - MySQL Passwort festlegen
#    - Admin-Account erstellen
#    - Fertig!
```

### Option B: Kommandozeilen-Setup

Klassisches Setup über Terminal:

```bash
# 1. Setup ausführen (einmalig)
chmod +x quick-start.sh
./quick-start.sh

# 2. Neues Projekt erstellen
cd /opt/webserver
./scripts/create-project.sh

# Das Script fragt dich:
# - Username (Standard: mehmed)
# - Projektname
# - Template (Static/PHP/Node.js)
# - Port (automatisch vorgeschlagen)
# - GitHub Repository (optional)
# - Datenbank erstellen? (bei PHP/Node.js)
# - Container direkt starten?

# 3. Fertig! Website ist live
# http://<SERVER_IP>:PORT
```

### Mit GitHub-Projekt

```bash
./scripts/create-project.sh

# Bei GitHub-Frage:
# git@github.com:username/repo.git eingeben
# → Repository wird automatisch geklont
# → Berechtigungen werden gesetzt
# → Projekt ist sofort einsatzbereit
```

Siehe **SETUP.md** für detaillierte Anleitung.

## Verzeichnisstruktur

```
webserver/
├── infrastructure/             # Zentrale Services
│   ├── docker-compose.yml     # MariaDB + phpMyAdmin
│   ├── .env                  # Konfiguration (Root-Passwort!)
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
│   ├── list-projects.sh      # Alle Projekte anzeigen
│   ├── setup-dashboard.sh    # Dashboard installieren
│   └── start-infrastructure.sh
│
├── dashboard/                # ⭐ Web-Dashboard (Node.js)
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── src/                  # Dashboard Quellcode
│
├── config.sh.example        # Template für Server-Konfiguration
├── config.sh                # Server-Konfiguration (IP, User, Ports)
├── README.md                # Diese Datei
├── SETUP.md                 # Detaillierte Setup-Anleitung
└── quick-start.sh           # Automatisches Setup-Script
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
cd /opt/webserver/users/<USER>/PROJEKTNAME
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

```bash
# Dashboard installieren und starten
./scripts/setup-dashboard.sh

# Dashboard öffnen: http://<SERVER_IP>:3000
```

Das Dashboard bietet:
- Projekte erstellen, starten, stoppen, löschen
- Container-Status und Logs anzeigen
- Datenbanken verwalten
- Multi-User Login

### Infrastruktur

```bash
# Starten
./scripts/start-infrastructure.sh

# Stoppen
./scripts/stop-infrastructure.sh

# Status
docker ps --filter network=webserver-network
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

Nach dem Start verfügbar (IP aus `config.sh`):

- **MariaDB**: `<SERVER_IP>:3306` (oder `webserver-mariadb:3306` im Docker Network)
- **phpMyAdmin**: `http://<SERVER_IP>:8080`

## VS Code Remote SSH

Die beste Methode um auf dem Server zu arbeiten:

```bash
# 1. Extension Remote - SSH installieren
# 2. Ctrl+Shift+P → Remote-SSH: Connect to Host
# 3. <USER>@<SERVER_IP> (z.B. mehmed@192.168.2.125)
# 4. Open Folder → /opt/webserver/users/mehmed/PROJEKTNAME/html
# 5. Dateien bearbeiten → Speichern = LIVE!
```

Siehe **VSCODE_REMOTE_SSH.md** für Details.

## Workflow: Von GitHub bis Live

```
1. Lokal entwickeln in VS Code
   ↓
2. git push zu GitHub
   ↓
3. Auf Server deployen:
   
   VARIANTE A (Neues Projekt):
   ./scripts/create-project.sh
   → GitHub-URL eingeben
   → Projekt ist live!
   
   VARIANTE B (Update bestehendes Projekt):
   ssh <USER>@<SERVER_IP>
   cd /opt/webserver/users/mehmed/PROJEKT/html
   git pull
   
   VARIANTE C (VS Code Remote SSH):
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
- Repository wird automatisch geklont
- Berechtigungen werden gesetzt
- Git-Ready für Updates

## Dokumentation

- **SETUP.md**: Vollständige Setup-Anleitung
- **VSCODE_REMOTE_SSH.md**: VS Code Remote SSH Guide
- **GIT_WORKFLOW.md**: Git & Deployment Workflow
- **templates/README.md**: Template-Dokumentation

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

## Support & Troubleshooting

Siehe SETUP.md Abschnitt Troubleshooting für häufige Probleme.

## Sicherheit

- MySQL Root Passwort in `infrastructure/.env` ändern
- Jeder DB-User hat nur Zugriff auf seine eigenen Datenbanken
- Container sind netzwerk-isoliert
- SSL/TLS über NPM verwenden
- Automatisch generierte sichere Passwörter für DB-User
