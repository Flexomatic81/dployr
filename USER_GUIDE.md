# Dployr - Benutzerhandbuch

Dieses Handbuch richtet sich an Benutzer des Dployr Web-Dashboards.

## Inhaltsverzeichnis

1. [Erste Schritte](#erste-schritte)
2. [Projekte](#projekte)
3. [Datenbanken](#datenbanken)
4. [Git-Integration](#git-integration)
5. [Einstellungen](#einstellungen)
6. [FAQ](#faq)

---

## Erste Schritte

### Registrierung

1. Öffne das Dashboard unter `http://<SERVER-IP>:3000`
2. Klicke auf **"Registrieren"**
3. Fülle das Formular aus:
   - **Benutzername**: Dein Login-Name
   - **System-Benutzername**: Wird für Ordner und Container verwendet (nur Kleinbuchstaben, Zahlen, Bindestriche)
   - **Passwort**: Mindestens 6 Zeichen
4. Nach der Registrierung musst du warten, bis ein Administrator dein Konto freischaltet

### Login

Nach der Freischaltung durch einen Admin:
1. Gehe zur Login-Seite
2. Gib Benutzername und Passwort ein
3. Du wirst zum Dashboard weitergeleitet

### Dashboard-Übersicht

Nach dem Login siehst du:
- **Projektanzahl**: Wie viele Projekte du hast
- **Laufende Container**: Aktive Projekte
- **Datenbanken**: Anzahl deiner Datenbanken
- **Letzte Projekte**: Schnellzugriff auf deine Projekte

---

## Projekte

### Neues Projekt erstellen

Es gibt drei Möglichkeiten:

#### Option A: Von Git-Repository (Empfohlen für Versionierung)

1. Klicke auf **"Neues Projekt"**
2. Wähle Tab **"Von Git-Repository"** (Standard)
3. Fülle aus:
   - **Projektname**: z.B. `mein-repo`
   - **Repository-URL**: `https://github.com/user/repo.git`
   - **Access Token**: Nur für private Repositories nötig
   - **Port**: Wird automatisch vorgeschlagen
4. Der Projekttyp wird automatisch erkannt
5. Klicke **"Projekt von Git erstellen"**

#### Option B: Per ZIP-Upload (Schnell & einfach)

1. Klicke auf **"Neues Projekt"**
2. Wähle Tab **"ZIP-Upload"**
3. Fülle aus:
   - **Projektname**: z.B. `meine-website`
   - **ZIP-Datei**: Wähle deine ZIP-Datei (max. 100 MB)
   - **Port**: Wird automatisch vorgeschlagen
4. Der Projekttyp wird automatisch erkannt
5. Klicke **"Projekt hochladen"**

> **Tipp**: Falls deine ZIP einen einzelnen Ordner enthält (z.B. `projekt-main/`), wird der Inhalt automatisch korrekt extrahiert.

#### Option C: Von Template (Leeres Projekt)

1. Klicke auf **"Neues Projekt"**
2. Wähle Tab **"Von Template"**
3. Fülle aus:
   - **Projektname**: z.B. `meine-website`
   - **Projekttyp**: Static, PHP oder Node.js
   - **Port**: Wird automatisch vorgeschlagen
4. Klicke **"Projekt erstellen"**

### Projekttypen

| Typ | Beschreibung | Verwendung |
|-----|--------------|------------|
| **Static** | HTML, CSS, JavaScript | Einfache Webseiten ohne Backend |
| **PHP** | PHP 8 mit Apache | WordPress, eigene PHP-Apps |
| **Node.js** | Node.js mit Express | API-Server, Backend-Apps |
| **Laravel/Symfony** | PHP mit Composer | Laravel, Symfony Frameworks |
| **React/Vue (Build)** | Node.js für Build, Nginx für Hosting | React, Vue, Vite Apps |
| **Next.js (SSR)** | Node.js mit Next.js | Server-Side Rendering |

### Automatische Projekttyp-Erkennung

Bei Git- und ZIP-Projekten wird der Typ automatisch erkannt:

| Erkannte Datei | Projekttyp |
|----------------|------------|
| `next.config.js` | Next.js (SSR) |
| `package.json` mit Build-Script | React/Vue (Build) |
| `package.json` | Node.js App |
| `artisan` / `symfony.lock` | Laravel/Symfony |
| `composer.json` / `*.php` | PHP Website |
| `index.html` | Statische Website |

### Projekt verwalten

Auf der Projekt-Detailseite kannst du:

- **Starten**: Container hochfahren
- **Stoppen**: Container anhalten
- **Neustarten**: Container neu starten
- **Logs**: Container-Ausgabe anzeigen
- **Löschen**: Projekt komplett entfernen

### Projekt-Typ ändern

Falls du den Projekttyp nachträglich ändern musst:

1. Öffne die Projekt-Detailseite
2. Scrolle zu **"Projekteinstellungen"**
3. Wähle den neuen Typ
4. Klicke **"Typ ändern"**

> **Hinweis**: Der Container wird neu erstellt. Deine Dateien bleiben erhalten.

### Projekttyp-Empfehlung

Wenn der erkannte Projekttyp nicht mit dem konfigurierten übereinstimmt, zeigt das Dashboard eine **gelbe Warnung** an:

- Du siehst den aktuellen und empfohlenen Typ
- Mit **"Typ anpassen"** kannst du den Typ mit einem Klick korrigieren
- Bei Übereinstimmung siehst du ein grünes Häkchen

### Projekt aufrufen

- Klicke auf den **Port-Link** in der Projektübersicht
- Oder öffne manuell: `http://<SERVER-IP>:<PORT>`

### Umgebungsvariablen (.env)

Auf der Projekt-Detailseite findest du einen Editor für Umgebungsvariablen:

1. Scrolle zu **"Umgebungsvariablen (.env)"**
2. Bearbeite die Variablen im Textfeld
3. Klicke **"Speichern"**
4. **Starte den Container neu**, damit die Änderungen wirksam werden

#### .env.example übernehmen

Wenn dein Projekt eine `.env.example` (oder `.env.sample`, `.env.dist`) enthält:

1. Das Dashboard zeigt automatisch einen Hinweis
2. Klicke auf den Button mit dem Dateinamen (z.B. **".env.example"**)
3. Die Vorlage wird kopiert und mit bestehenden Werten gemerged

#### Datenbank-Credentials einfügen

Wenn du Datenbanken erstellt hast:

1. Klicke auf **"DB einfügen"** im Header der Umgebungsvariablen-Sektion
2. Wähle die gewünschte Datenbank aus dem Dropdown
3. Die Credentials werden automatisch am Ende der `.env` eingefügt:

```env
# === Dployr Datenbank-Credentials ===
DB_CONNECTION=mysql
DB_HOST=dployr-mariadb
DB_PORT=3306
DB_DATABASE=dein_datenbankname
DB_USERNAME=dein_benutzername
DB_PASSWORD=dein_passwort
```

---

## Datenbanken

### Neue Datenbank erstellen

1. Gehe zu **"Datenbanken"** im Menü
2. Klicke **"Neue Datenbank"**
3. Gib einen Namen ein (wird automatisch mit deinem Username prefixed)
4. Wähle den **Datenbanktyp**:
   - **MariaDB**: MySQL-kompatibel, ideal für WordPress, Laravel, PHP-Projekte
   - **PostgreSQL**: Fortschrittliche Features, ideal für komplexe Anwendungen
5. Klicke **"Erstellen"**

### Verbindungsdaten

Für jede Datenbank siehst du:
- **Datenbankname**: z.B. `<username>_meinprojekt`
- **Typ**: MariaDB oder PostgreSQL (als Badge)
- **Benutzername**: z.B. `<username>_meinprojekt`
- **Passwort**: Klicke auf das Auge-Symbol zum Anzeigen
- **Host**: Je nach Typ unterschiedlich

### Datenbank in deiner App nutzen

**Für MariaDB:**
```env
DB_TYPE=mariadb
DB_HOST=dployr-mariadb
DB_PORT=3306
DB_DATABASE=<dein_datenbankname>
DB_USERNAME=<dein_benutzername>
DB_PASSWORD=<dein_passwort>
```

**Für PostgreSQL:**
```env
DB_TYPE=postgresql
DB_HOST=dployr-postgresql
DB_PORT=5432
DB_DATABASE=<dein_datenbankname>
DB_USERNAME=<dein_benutzername>
DB_PASSWORD=<dein_passwort>
```

### Datenbank-Verwaltung

**phpMyAdmin (MariaDB):**
1. Öffne `http://<SERVER-IP>:8080`
2. Melde dich mit deinen MariaDB-Credentials an

**pgAdmin (PostgreSQL):**
1. Öffne `http://<SERVER-IP>:5050`
2. Melde dich mit dem pgAdmin-Passwort an
3. Füge deinen PostgreSQL-Server hinzu:
   - Host: `dployr-postgresql`
   - Port: `5432`
   - Username: Dein DB-Benutzername
   - Password: Dein DB-Passwort

### Datenbank löschen

1. Gehe zu **"Datenbanken"**
2. Klicke auf das Papierkorb-Symbol
3. Bestätige die Löschung

> **Achtung**: Alle Daten werden unwiderruflich gelöscht!

---

## Git-Integration

### Projekt von GitHub/GitLab erstellen

Siehe [Neues Projekt erstellen](#option-b-von-git-repository).

### Private Repositories

Für private Repos brauchst du einen **Personal Access Token**:

#### GitHub
1. Gehe zu GitHub → Settings → Developer settings → Personal access tokens
2. Erstelle einen Token mit `repo` Berechtigung
3. Kopiere den Token ins Dashboard

#### GitLab
1. Gehe zu GitLab → Preferences → Access Tokens
2. Erstelle einen Token mit `read_repository` Scope
3. Kopiere den Token ins Dashboard

### Git Pull (Updates holen)

Wenn dein Projekt mit Git verbunden ist:

1. Öffne die Projekt-Detailseite
2. Im Bereich **"Git"** klicke auf **"Pull"**
3. Die neuesten Änderungen werden heruntergeladen

### Git-Verbindung trennen

1. Öffne die Projekt-Detailseite
2. Klicke auf **"Git trennen"**
3. Das Projekt wird zu einem normalen Template-Projekt

---

## Einstellungen

### Dark/Light Theme

Klicke auf das **Sonnen-/Mond-Symbol** in der Navigationsleiste, um zwischen hellem und dunklem Design zu wechseln. Deine Präferenz wird gespeichert.

### Passwort ändern

1. Klicke auf deinen Benutzernamen oben rechts
2. Wähle **"Profil"** oder **"Passwort ändern"**
3. Gib das alte und neue Passwort ein
4. Speichern

---

## FAQ

### Warum kann ich mich nicht einloggen?

- **Neuer Account?** Du musst von einem Admin freigeschaltet werden.
- **Passwort vergessen?** Kontaktiere einen Administrator.

### Mein Projekt zeigt 502 Bad Gateway

- Der Container ist möglicherweise nicht gestartet
- Klicke auf **"Starten"** auf der Projekt-Detailseite
- Prüfe die **Logs** auf Fehler

### Mein Projekt kann sich nicht mit der Datenbank verbinden

1. Prüfe die `.env` Datei in deinem Projekt
2. Stelle sicher, dass der richtige Host gesetzt ist:
   - MariaDB: `DB_HOST=dployr-mariadb`
   - PostgreSQL: `DB_HOST=dployr-postgresql`
3. Prüfe den richtigen Port:
   - MariaDB: `DB_PORT=3306`
   - PostgreSQL: `DB_PORT=5432`
4. Prüfe Benutzername und Passwort

### Wie kann ich Dateien bearbeiten?

**Option A: VS Code Remote SSH**
1. Installiere die Extension "Remote - SSH" in VS Code
2. Verbinde dich mit `<USER>@<SERVER-IP>`
3. Öffne den Ordner `/opt/dployr/users/<DEIN-USER>/<PROJEKT>/html`

**Option B: SFTP/SCP**
- Nutze einen SFTP-Client wie FileZilla
- Verbinde dich mit deinen SSH-Zugangsdaten

### Welche Ports werden verwendet?

| Service | Port |
|---------|------|
| Dashboard | 3000 |
| phpMyAdmin | 8080 |
| pgAdmin | 5050 |
| MariaDB | 3306 (nur lokal) |
| PostgreSQL | 5432 (nur lokal) |
| Projekte | 8001, 8002, 8003, ... |

### Wie groß dürfen meine Projekte sein?

Es gibt keine harten Limits, aber beachte:
- Speicherplatz wird mit anderen Usern geteilt
- Große Uploads können länger dauern

---

## Support

Bei Problemen wende dich an den Server-Administrator.
