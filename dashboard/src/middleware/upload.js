const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { logger } = require('../config/logger');
const { BLOCKED_PROJECT_FILES } = require('../config/constants');

// Create upload directory if not exists
const uploadDir = process.env.UPLOAD_TEMP_PATH || '/tmp/dployr-uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ZIP Magic Bytes: PK (0x50, 0x4B) followed by 0x03, 0x04 (local file header)
// or 0x05, 0x06 (end of central directory) or 0x07, 0x08 (spanned archive)
const ZIP_MAGIC_BYTES = [
    [0x50, 0x4B, 0x03, 0x04], // Normal ZIP header
    [0x50, 0x4B, 0x05, 0x06], // Empty ZIP file
    [0x50, 0x4B, 0x07, 0x08]  // Spanned archive
];

/**
 * Checks if a file is a valid ZIP file based on magic bytes
 */
function isValidZipFile(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(4);
        fs.readSync(fd, buffer, 0, 4, 0);
        fs.closeSync(fd);

        // Check against all valid ZIP headers
        return ZIP_MAGIC_BYTES.some(magic =>
            buffer[0] === magic[0] &&
            buffer[1] === magic[1] &&
            buffer[2] === magic[2] &&
            buffer[3] === magic[3]
        );
    } catch (error) {
        logger.warn('Error checking ZIP magic bytes', { error: error.message });
        return false;
    }
}

/**
 * Validates ZIP file contents for dangerous content
 */
function validateZipContents(filePath) {
    const AdmZip = require('adm-zip');
    const errors = [];

    try {
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();

        // Dangerous file extensions
        const dangerousExtensions = [
            '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
            '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf', '.wsc', '.wsh',
            '.ps1', '.psm1', '.psd1'
        ];

        // Check for Zip-Slip (path traversal)
        for (const entry of entries) {
            const entryName = entry.entryName;

            // Check for path traversal
            if (entryName.includes('..') || entryName.startsWith('/') || entryName.startsWith('\\')) {
                errors.push(`Suspicious path found: ${entryName}`);
                continue;
            }

            // Check for dangerous files (warn only, don't block)
            const ext = path.extname(entryName).toLowerCase();
            if (dangerousExtensions.includes(ext)) {
                logger.warn('Potentially dangerous file in ZIP', {
                    file: entryName,
                    extension: ext
                });
            }

            // Check for blocked Docker files (warn, will be removed after extraction)
            const fileName = path.basename(entryName);
            if (BLOCKED_PROJECT_FILES.includes(fileName)) {
                logger.warn('Blocked Docker file found in ZIP (will be removed)', {
                    file: entryName
                });
            }

            // Check for very large files (> 500MB uncompressed)
            if (entry.header.size > 500 * 1024 * 1024) {
                errors.push(`File too large: ${entryName} (${Math.round(entry.header.size / 1024 / 1024)}MB)`);
            }
        }

        // Zip-bomb detection: Check compression ratio
        const stats = fs.statSync(filePath);
        const compressedSize = stats.size;
        let uncompressedSize = 0;

        for (const entry of entries) {
            uncompressedSize += entry.header.size;
        }

        // Warning if compression ratio > 100:1 (typical for zip bombs)
        if (compressedSize > 0 && uncompressedSize / compressedSize > 100) {
            errors.push(`Suspicious compression ratio: ${Math.round(uncompressedSize / compressedSize)}:1`);
        }

        // Maximum uncompressed size: 1GB
        if (uncompressedSize > 1024 * 1024 * 1024) {
            errors.push(`Uncompressed size too large: ${Math.round(uncompressedSize / 1024 / 1024)}MB (max 1GB)`);
        }

    } catch (error) {
        errors.push(`ZIP file could not be read: ${error.message}`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Unique filename with timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100 MB
    },
    fileFilter: (req, file, cb) => {
        // Only allow ZIP files (MIME type and extension)
        const isZip = file.mimetype === 'application/zip' ||
                      file.mimetype === 'application/x-zip-compressed' ||
                      file.originalname.toLowerCase().endsWith('.zip');

        if (isZip) {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files are allowed'));
        }
    }
});

/**
 * Middleware that validates ZIP file after upload
 */
function validateZipMiddleware(req, res, next) {
    if (!req.file) {
        return next();
    }

    const filePath = req.file.path;

    // 1. Check magic bytes
    if (!isValidZipFile(filePath)) {
        // Delete file
        try { fs.unlinkSync(filePath); } catch {}

        logger.warn('Invalid ZIP file uploaded (magic bytes)', {
            originalName: req.file.originalname,
            ip: req.ip
        });

        req.flash('error', req.t('projects:errors.zipInvalid'));
        return res.redirect('back');
    }

    // 2. Validate ZIP contents
    const validation = validateZipContents(filePath);
    if (!validation.valid) {
        // Delete file
        try { fs.unlinkSync(filePath); } catch {}

        logger.warn('ZIP validation failed', {
            originalName: req.file.originalname,
            errors: validation.errors,
            ip: req.ip
        });

        req.flash('error', `Invalid ZIP file: ${validation.errors.join(', ')}`);
        return res.redirect('back');
    }

    next();
}

module.exports = upload;
module.exports.validateZipMiddleware = validateZipMiddleware;
module.exports.isValidZipFile = isValidZipFile;
module.exports.validateZipContents = validateZipContents;
