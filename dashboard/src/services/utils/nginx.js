/**
 * Nginx configuration generator
 * Central place for nginx config generation
 */

/**
 * Generates nginx default.conf for static websites
 * @returns {string} Nginx configuration
 */
function generateNginxConfig() {
    return `server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html index.htm;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;
}`;
}

module.exports = {
    generateNginxConfig
};
