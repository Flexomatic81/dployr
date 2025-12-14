const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Database Connection Pool
let pool;
if (process.env.DB_DATABASE && process.env.DB_USERNAME) {
    pool = mysql.createPool({
        host: process.env.DB_HOST || 'deployr-mariadb',
        port: process.env.DB_PORT || 3306,
        database: process.env.DB_DATABASE,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
}

// Routes
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="de">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Node.js App Template</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    padding: 2rem;
                }
                .container {
                    background: rgba(255, 255, 255, 0.1);
                    padding: 2rem;
                    border-radius: 12px;
                    backdrop-filter: blur(10px);
                    max-width: 600px;
                }
                h1 { margin-bottom: 1rem; }
                .info {
                    background: rgba(255, 255, 255, 0.1);
                    padding: 1rem;
                    margin: 1rem 0;
                    border-radius: 8px;
                }
                .success { background: rgba(0, 255, 0, 0.2); }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Node.js App Template</h1>
                <div class="info success">
                    <p>✓ Server läuft auf Port ${PORT}</p>
                    <p>✓ Node.js ${process.version}</p>
                    <p>✓ Environment: ${process.env.NODE_ENV || 'development'}</p>
                </div>
                <div class="info">
                    <h2>API Endpoints</h2>
                    <p>GET <a href="/api/health" style="color: white;">/api/health</a> - Health Check</p>
                    <p>GET <a href="/api/db-test" style="color: white;">/api/db-test</a> - Datenbank Test</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Database Test
app.get('/api/db-test', async (req, res) => {
    if (!pool) {
        return res.status(500).json({
            error: 'Datenbank nicht konfiguriert',
            message: 'Setze DB_* Umgebungsvariablen'
        });
    }

    try {
        const [rows] = await pool.query('SELECT 1 + 1 AS result');
        res.json({
            status: 'ok',
            message: 'Datenbankverbindung erfolgreich',
            result: rows[0]
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server läuft auf Port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    if (pool) {
        console.log('Datenbank-Pool konfiguriert');
    }
});
