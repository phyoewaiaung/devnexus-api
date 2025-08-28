const multer = require('multer');
const path = require('path');
const fs = require('fs');

const AVATAR_DIR = path.join(__dirname, '..', '..', 'uploads', 'covers');

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        fs.mkdirSync(AVATAR_DIR, { recursive: true });
        cb(null, AVATAR_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = `${Date.now()}-${req.user.id}${ext}`;
        cb(null, name);
    },
});

const fileFilter = (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPG/PNG/WEBP images are allowed'), ok);
};

module.exports = multer({
    storage,
    fileFilter,
    limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
});
