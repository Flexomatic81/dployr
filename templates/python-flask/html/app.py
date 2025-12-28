from flask import Flask
import os

app = Flask(__name__)

@app.route('/')
def index():
    return '''
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Flask App Template</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                background: linear-gradient(135deg, #3776ab 0%, #ffd43b 100%);
                color: white;
            }
            .container {
                text-align: center;
                padding: 2rem;
                background: rgba(0, 0, 0, 0.3);
                border-radius: 12px;
            }
            h1 { font-size: 2.5rem; margin-bottom: 1rem; }
            p { font-size: 1.1rem; opacity: 0.9; }
            .status {
                margin-top: 1.5rem;
                padding: 1rem;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 8px;
            }
            code { background: rgba(0, 0, 0, 0.3); padding: 0.2rem 0.5rem; border-radius: 4px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Flask App Template</h1>
            <p>Your Flask application is running!</p>
            <div class="status">
                <p>Replace this file with your own code in <code>html/app.py</code></p>
            </div>
        </div>
    </body>
    </html>
    '''

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8000)))
