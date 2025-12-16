<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PHP Website Template</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.1);
            padding: 2rem;
            border-radius: 12px;
            backdrop-filter: blur(10px);
        }
        h1 {
            margin-bottom: 1rem;
        }
        .info-box {
            background: rgba(255, 255, 255, 0.1);
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 8px;
        }
        .success {
            background: rgba(0, 255, 0, 0.2);
        }
        .error {
            background: rgba(255, 0, 0, 0.2);
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }
        td {
            padding: 0.5rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }
        td:first-child {
            font-weight: bold;
            width: 30%;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>PHP Website Template</h1>

        <div class="info-box">
            <h2>PHP Info</h2>
            <table>
                <tr>
                    <td>PHP Version:</td>
                    <td><?php echo phpversion(); ?></td>
                </tr>
                <tr>
                    <td>Server:</td>
                    <td><?php echo $_SERVER['SERVER_SOFTWARE'] ?? 'Unknown'; ?></td>
                </tr>
                <tr>
                    <td>Document Root:</td>
                    <td><?php echo $_SERVER['DOCUMENT_ROOT']; ?></td>
                </tr>
            </table>
        </div>

        <?php
        // Datenbank-Verbindung testen
        $db_host = getenv('DB_HOST') ?: 'dployr-mariadb';
        $db_database = getenv('DB_DATABASE') ?: '';
        $db_username = getenv('DB_USERNAME') ?: '';
        $db_password = getenv('DB_PASSWORD') ?: '';

        if ($db_database && $db_username) {
            try {
                $dsn = "mysql:host=$db_host;dbname=$db_database;charset=utf8mb4";
                $pdo = new PDO($dsn, $db_username, $db_password, [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
                ]);

                echo '<div class="info-box success">';
                echo '<h2>✓ Datenbankverbindung erfolgreich</h2>';
                echo '<table>';
                echo '<tr><td>Host:</td><td>' . htmlspecialchars($db_host) . '</td></tr>';
                echo '<tr><td>Datenbank:</td><td>' . htmlspecialchars($db_database) . '</td></tr>';
                echo '<tr><td>User:</td><td>' . htmlspecialchars($db_username) . '</td></tr>';
                echo '</table>';
                echo '</div>';
            } catch (PDOException $e) {
                echo '<div class="info-box error">';
                echo '<h2>✗ Datenbankverbindung fehlgeschlagen</h2>';
                echo '<p>' . htmlspecialchars($e->getMessage()) . '</p>';
                echo '</div>';
            }
        } else {
            echo '<div class="info-box">';
            echo '<h2>Datenbank nicht konfiguriert</h2>';
            echo '<p>Setze DB_DATABASE, DB_USERNAME und DB_PASSWORD in der .env Datei</p>';
            echo '</div>';
        }
        ?>

        <div class="info-box">
            <h2>Nächste Schritte</h2>
            <ul>
                <li>Ersetze diese Datei mit deinem eigenen Code</li>
                <li>Konfiguriere die Datenbankverbindung in der .env Datei</li>
                <li>Installiere benötigte PHP Extensions im Dockerfile</li>
            </ul>
        </div>
    </div>
</body>
</html>
