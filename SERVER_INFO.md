# Server Installation

**Installationsdatum**: (Datum eintragen)
**Installiert von**: (Admin eintragen)

> **Hinweis**: Die Server-IP ist in `config.sh` konfiguriert und wird von allen Skripten verwendet.

## Server-Details

- **Hostname**: (Hostname eintragen)
- **IP**: Siehe `config.sh`
- **OS**: (Betriebssystem eintragen)
- **Docker**: (Version eintragen)
- **Docker Compose**: (Version eintragen)
- **Installation Pfad**: /opt/dployr

## Wichtige Zugangsdaten

### MySQL/MariaDB

```
Host: <SERVER_IP>:3306 (oder webserver-mariadb im Docker Network)
Root User: root
Root Passwort: (siehe infrastructure/.env)
```

**Speicherort**: `/opt/dployr/infrastructure/.env`

### phpMyAdmin

```
URL: http://<SERVER_IP>:8080
Server: webserver-mariadb
User: root
Passwort: (siehe infrastructure/.env)
```

**Hinweis**: Nur lokal erreichbar (127.0.0.1). Für externen Zugriff über NPM exposen.

## Laufende Services

### Infrastruktur (permanent)

- **dployr-mariadb**: MariaDB 11, Port 3306 (localhost)
- **dployr-phpmyadmin**: phpMyAdmin, Port 8080 (localhost)

### User-Projekte

(Projekte hier dokumentieren)

## Verzeichnisstruktur

```
/opt/dployr/
├── infrastructure/       # MariaDB + phpMyAdmin
│   ├── .env             # MySQL Root-Passwort HIER!
│   └── docker-compose.yml
├── users/               # User-Projekte
│   └── <username>/
│       └── <projektname>/
├── templates/           # Projekt-Vorlagen
├── scripts/             # Verwaltungs-Scripts
├── config.sh           # Server-IP Konfiguration
├── README.md           # Projekt-Dokumentation
├── SETUP.md            # Installations-Anleitung
└── SERVER_INFO.md      # Diese Datei
```

## Wichtige Befehle

### Infrastruktur verwalten

```bash
cd /opt/dployr

# Status aller Container
docker ps

# Infrastruktur starten
./scripts/start-infrastructure.sh

# Infrastruktur stoppen
./scripts/stop-infrastructure.sh
```

### Neues Projekt erstellen

```bash
cd /opt/dployr

# Projekt erstellen
./scripts/create-project.sh <username> <projektname> <template>

# Templates: static-website, php-website, nodejs-app

# Datenbank erstellen (optional)
./scripts/create-database.sh <username> <db-name>

# Projekt starten
cd users/<username>/<projektname>
docker compose up -d
```

### Projekte auflisten

```bash
cd /opt/dployr
./scripts/list-projects.sh
```

## Port-Vergabe

**Reservierte Ports**:
- 3306: MariaDB (localhost)
- 8080: phpMyAdmin (localhost)

**Verfügbar für Projekte**: 8001, 8002, 8003, ...

**Wichtig**: Jedes Projekt braucht einen eigenen Port in der `.env` Datei!

## NPM Integration

Dieser Server steht hinter:
- Firewall
- Nginx Proxy Manager (NPM)

**NPM konfigurieren für Projekt**:
1. Proxy Host hinzufügen
2. Domain: projekt.deine-domain.de
3. Forward to: `<SERVER_IP>:PORT`
4. SSL aktivieren

## Bekannte Probleme & Lösungen

### Problem: 403 Forbidden bei neuen Projekten

**Ursache**: Falsche Datei-Permissions  
**Lösung**: 
```bash
cd /opt/dployr/users/<user>/<projekt>
chmod 755 html/
chmod 644 html/*
```

**Hinweis**: Templates wurden bereits korrigiert, sollte bei neuen Projekten nicht mehr auftreten.

### Problem: MariaDB startet nicht

**Ursache**: Config-Dateien nicht lesbar  
**Lösung**:
```bash
chmod 755 /opt/dployr/infrastructure/mariadb/conf
chmod 644 /opt/dployr/infrastructure/mariadb/conf/*
```

### Problem: docker-compose Befehl nicht gefunden

**Lösung**: Verwende `docker compose` statt `docker-compose` (neuer Syntax)

## Backup-Empfehlungen

### Datenbank-Backup

```bash
# Alle Datenbanken
docker exec dployr-mariadb mysqldump -uroot -p<PASSWORD> --all-databases > backup.sql

# Einzelne Datenbank
docker exec dployr-mariadb mysqldump -u<USER> -p<PASSWORD> <DB> > db_backup.sql
```

### Projekt-Dateien

```bash
# Komplettes Backup
tar -czf dployr-backup-$(date +%Y%m%d).tar.gz /opt/dployr
```

## SSH-Zugang

**User**: Siehe `config.sh` (DEFAULT_USER)
**Host**: Siehe `config.sh` (SERVER_IP)
**Auth**: SSH-Key

```bash
ssh <USER>@<SERVER_IP>
```

## Updates

### Docker Images aktualisieren

```bash
cd /opt/dployr/infrastructure
docker compose pull
docker compose up -d
```

### System-Updates

```bash
sudo apt update
sudo apt upgrade
```

## Support & Dokumentation

- **Projekt-README**: `/opt/dployr/README.md`
- **Setup-Guide**: `/opt/dployr/SETUP.md`
- **Templates**: `/opt/dployr/templates/README.md`
- **User-Guide**: `/opt/dployr/USER_GUIDE.md`

## Änderungshistorie

- **2025-12-15**: Dark Mode, Admin-Freischaltung & Verbesserungen
  - Dark/Light Theme Toggle mit localStorage-Speicherung
  - Registrierungs-Freischaltung durch Admin
    - Neue User müssen von Admin genehmigt werden
    - Admin-Panel zeigt ausstehende Registrierungen
    - Info-Hinweis auf Registrierungsseite
  - Projekt-Typ nachträglich änderbar (Static/PHP/Node.js)
  - Datenbanknamen mit Username-Prefix für bessere Isolation
  - Server-IP aus Setup-Wizard in Port-Links verwendet
  - Git Integration
    - Projekt von Git-Repository erstellen (im Dashboard)
    - Automatische Projekttyp-Erkennung (Static/PHP/Node.js)
    - Pull-Funktion für Git-verbundene Projekte
    - Unterstützung für private Repositories (Access Token)
  - PDO MySQL-Erweiterung für PHP-Container

- **2025-12-14**: Admin Panel & Service-Architektur
  - Admin-Bereich für Benutzerverwaltung
  - Refactoring zu Service-Layer Architektur
  - Passwort-Reset Funktion

- **2025-12-13**: Initiale Installation
  - MariaDB + phpMyAdmin setup
  - Demo-Projekt erstellt
  - Permissions-Probleme behoben
  - Templates korrigiert
