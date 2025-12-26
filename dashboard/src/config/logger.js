const winston = require('winston');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || '/app/logs';

// Custom format for readable logs
const customFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
        metaStr = ' ' + JSON.stringify(meta);
    }
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
});

// Logger configuration
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true })
    ),
    defaultMeta: { service: 'dployr-dashboard' },
    transports: [
        // Console transport - always active
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                customFormat
            )
        })
    ]
});

// File transports only when LOG_DIR is writable
try {
    const fs = require('fs');
    fs.mkdirSync(LOG_DIR, { recursive: true });

    // Error log
    logger.add(new winston.transports.File({
        filename: path.join(LOG_DIR, 'error.log'),
        level: 'error',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        maxsize: 5242880, // 5MB
        maxFiles: 5
    }));

    // Combined log
    logger.add(new winston.transports.File({
        filename: path.join(LOG_DIR, 'combined.log'),
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        maxsize: 5242880, // 5MB
        maxFiles: 5
    }));

    logger.info('File logging enabled', { logDir: LOG_DIR });
} catch (error) {
    logger.warn('File logging disabled - cannot write to log directory', { logDir: LOG_DIR });
}

// Request logger middleware
function requestLogger(req, res, next) {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip || req.connection.remoteAddress
        };

        // Skip logging for source maps and other unimportant 404s
        const ignoredPatterns = ['.map', '.ico', '/favicon'];
        const shouldIgnore = res.statusCode === 404 &&
            ignoredPatterns.some(pattern => req.originalUrl.includes(pattern));

        if (shouldIgnore) {
            return; // Don't log
        }

        if (res.statusCode >= 500) {
            logger.error('Request failed', logData);
        } else if (res.statusCode >= 400) {
            logger.warn('Request error', logData);
        } else {
            logger.debug('Request completed', logData);
        }
    });

    next();
}

module.exports = {
    logger,
    requestLogger
};
