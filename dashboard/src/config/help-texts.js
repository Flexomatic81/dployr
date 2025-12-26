/**
 * Zentrale Hilfe-Texte für Inline-Tooltips und Popovers
 *
 * Format:
 * - tooltip: Kurzer Text (1-2 Sätze) für einfache Tooltips
 * - popover: Längerer Text mit HTML für komplexere Erklärungen
 */

const helpTexts = {
    // Setup Wizard
    setup: {
        serverIp: {
            tooltip: 'Die IP-Adresse oder der Hostname, unter dem der Server von anderen Geräten erreichbar ist.'
        },
        mysqlRootPassword: {
            tooltip: 'Das Master-Passwort für die MariaDB-Datenbank. Wird für administrative Aufgaben benötigt.'
        },
        adminUsername: {
            tooltip: 'Der Benutzername für den ersten Admin-Account im Dashboard.'
        },
        systemUsername: {
            tooltip: 'Der technische Benutzername für das Dateisystem. Projekte werden unter /app/users/{system_username}/ gespeichert.'
        }
    },

    // Projekt erstellen
    project: {
        name: {
            tooltip: 'Der Projektname wird als Ordnername und Container-Präfix verwendet. Nur Kleinbuchstaben, Zahlen und Bindestriche erlaubt.'
        },
        port: {
            tooltip: 'Der HTTP-Port, unter dem das Projekt erreichbar sein wird. Jedes Projekt benötigt einen eindeutigen Port.'
        },
        accessToken: {
            tooltip: 'Personal Access Token für private Repositories. Bei GitHub unter Settings → Developer settings → Personal access tokens erstellen.'
        },
        repoUrl: {
            tooltip: 'Die HTTPS-URL des Git-Repositories. SSH-URLs werden nicht unterstützt.'
        },
        zipFile: {
            tooltip: 'ZIP-Datei mit den Projektdateien. Verschachtelte Ordner (z.B. projekt-main/) werden automatisch entpackt.'
        },
        template: {
            tooltip: 'Wähle eine Vorlage basierend auf der Technologie deines Projekts. Der Typ kann später geändert werden.'
        }
    },

    // Projekt-Detail
    projectDetail: {
        autoDeploy: {
            tooltip: 'Aktiviere Auto-Deploy, um automatisch bei neuen Commits im Repository zu deployen. Der Server prüft regelmäßig auf Änderungen.'
        },
        autoDeployInterval: {
            tooltip: 'Wie oft der Server das Repository auf neue Commits prüft. Kürzere Intervalle bedeuten schnellere Updates, aber mehr Serverauslastung.'
        },
        envEditor: {
            tooltip: 'Bearbeite die .env-Datei des Projekts. Änderungen werden erst nach einem Container-Neustart wirksam.'
        },
        dbSetup: {
            tooltip: 'Fügt Datenbank-Credentials in die .env-Datei ein. Falls eine .env.example existiert, wird diese als Vorlage verwendet und bekannte DB-Variablen werden automatisch ersetzt.'
        },
        projectType: {
            tooltip: 'Der Projekttyp bestimmt die Docker-Konfiguration (Webserver, Runtime, etc.). Bei Änderung wird der Container neu erstellt.'
        },
        typeMismatch: {
            tooltip: 'Die erkannten Projektdateien passen nicht zum konfigurierten Typ. Eine Anpassung kann die Funktionalität verbessern.'
        }
    },

    // Projekt teilen
    sharing: {
        permissionRead: {
            tooltip: 'Kann Projekt-Status, Container-Infos und Logs einsehen, aber keine Änderungen vornehmen.'
        },
        permissionManage: {
            tooltip: 'Kann zusätzlich Container starten/stoppen, Git Pull ausführen und die .env-Datei bearbeiten.'
        },
        permissionFull: {
            tooltip: 'Hat fast alle Rechte wie der Besitzer, außer Löschen und Freigaben verwalten.'
        }
    },

    // Datenbanken
    database: {
        type: {
            tooltip: 'MariaDB für PHP/WordPress-Projekte, PostgreSQL für moderne Anwendungen wie Django oder Rails.'
        },
        name: {
            tooltip: 'Der Datenbankname wird mit deinem System-Benutzernamen als Präfix versehen (z.B. max_blog).'
        }
    },

    // Admin
    admin: {
        userApproval: {
            tooltip: 'Neue Benutzer müssen von einem Admin freigeschaltet werden, bevor sie sich einloggen können.'
        }
    }
};

module.exports = helpTexts;
