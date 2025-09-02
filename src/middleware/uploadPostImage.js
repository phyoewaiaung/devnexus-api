const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'posts');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '');
        const name = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        cb(null, `${name}${ext}`);
    }
});

const uploadPostImage = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
        cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
    }
});

module.exports = { uploadPostImage, UPLOAD_DIR };
