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

Es gibt zwei Möglichkeiten:

#### Option A: Von Template

1. Klicke auf **"Neues Projekt"**
2. Wähle Tab **"Von Template"**
3. Fülle aus:
   - **Projektname**: z.B. `meine-website`
   - **Projekttyp**: Static, PHP oder Node.js
   - **Datenbank erstellen**: Optional
4. Klicke **"Projekt erstellen"**

#### Option B: Von Git-Repository

1. Klicke auf **"Neues Projekt"**
2. Wähle Tab **"Von Git-Repository"**
3. Fülle aus:
   - **Projektname**: z.B. `mein-repo`
   - **Repository-URL**: `https://github.com/user/repo.git`
   - **Access Token**: Nur für private Repositories nötig
   - **Datenbank erstellen**: Optional
4. Der Projekttyp wird automatisch erkannt
5. Klicke **"Projekt erstellen"**

### Projekttypen

| Typ | Beschreibung | Verwendung |
|-----|--------------|------------|
| **Static** | HTML, CSS, JavaScript | Einfache Webseiten ohne Backend |
| **PHP** | PHP 8 mit Nginx | WordPress, Laravel, eigene PHP-Apps |
| **Node.js** | Node.js mit Express | React, Vue, Next.js, API-Server |

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

### Projekt aufrufen

- Klicke auf den **Port-Link** in der Projektübersicht
- Oder öffne manuell: `http://<SERVER-IP>:<PORT>`

---

## Datenbanken

### Neue Datenbank erstellen

1. Gehe zu **"Datenbanken"** im Menü
2. Klicke **"Neue Datenbank"**
3. Gib einen Namen ein (wird automatisch mit deinem Username prefixed)
4. Klicke **"Erstellen"**

### Verbindungsdaten

Für jede Datenbank siehst du:
- **Datenbankname**: z.B. `<username>_meinprojekt`
- **Benutzername**: z.B. `<username>_meinprojekt`
- **Passwort**: Klicke auf das Auge-Symbol zum Anzeigen
- **Host**: `dployr-mariadb:3306` (im Docker-Netzwerk)

### Datenbank in deiner App nutzen

Füge diese Umgebungsvariablen in deine `.env` Datei ein:

```env
DB_HOST=dployr-mariadb
DB_PORT=3306
DB_DATABASE=<dein_datenbankname>
DB_USERNAME=<dein_benutzername>
DB_PASSWORD=<dein_passwort>
```

### phpMyAdmin

Für grafische Datenbank-Verwaltung:
1. Öffne `http://<SERVER-IP>:8080`
2. Melde dich mit deinen Datenbank-Credentials an

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

### Mein PHP-Projekt kann sich nicht mit der Datenbank verbinden

1. Prüfe die `.env` Datei in deinem Projekt
2. Stelle sicher, dass `DB_HOST=dployr-mariadb` gesetzt ist
3. Prüfe Benutzername und Passwort

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
| MariaDB | 3306 (nur lokal) |
| Projekte | 8001, 8002, 8003, ... |

### Wie groß dürfen meine Projekte sein?

Es gibt keine harten Limits, aber beachte:
- Speicherplatz wird mit anderen Usern geteilt
- Große Uploads können länger dauern

---

## Support

Bei Problemen wende dich an den Server-Administrator.
