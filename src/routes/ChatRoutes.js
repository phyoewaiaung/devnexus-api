const express = require('express');
const router = express.Router();

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const auth = require('../middleware/authenticate');
const Chats = require('../controllers/ChatsController');

// ---------------- Param guards ----------------
const isId = (v) => /^[0-9a-fA-F]{24}$/.test(String(v));
router.param('id', (req, res, next, id) => (isId(id) ? next() : res.status(400).json({ message: 'Invalid id' })));
router.param('messageId', (req, res, next, id) => (isId(id) ? next() : res.status(400).json({ message: 'Invalid id' })));

// ---------------- Async wrapper ---------------
const asyncWrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------- Multer (chat attachments) ---
// IMPORTANT: write to <project>/uploads/chat (NOT src/uploads/chat)
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'chat');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        cb(null, name);
    },
});

const limits = { fileSize: 8 * 1024 * 1024 };

const fileFilter = (_req, file, cb) => {
    if (file?.mimetype?.startsWith('image/')) return cb(null, true);
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'files'));
};

const upload = multer({ storage, limits, fileFilter });

// ---------------- DM / Conversations ----------
router.post('/conversations/dm', auth, asyncWrap(Chats.startDM));

router.post('/conversations', auth, asyncWrap(Chats.createConversation));
router.get('/conversations', auth, asyncWrap(Chats.listMyConversations));
router.get('/conversations/:id', auth, asyncWrap(Chats.getConversation));

// NEW: destructive & exit actions
router.post('/conversations/:id/leave', auth, asyncWrap(Chats.leaveConversation));
router.delete('/conversations/:id', auth, asyncWrap(Chats.deleteConversation));

// ---------------- Invitations -----------------
router.post('/conversations/:id/invite', auth, asyncWrap(Chats.invite));
router.post('/conversations/:id/accept', auth, asyncWrap(Chats.acceptInvite));
router.post('/conversations/:id/decline', auth, asyncWrap(Chats.declineInvite));

// ---------------- Messages --------------------
router.get('/conversations/:id/messages', auth, asyncWrap(Chats.listMessages));
router.post('/conversations/:id/messages', auth, asyncWrap(Chats.sendMessage));
router.post('/conversations/:id/read', auth, asyncWrap(Chats.markRead));

// ---------------- Attachments -----------------
// Multi-upload (recommended): field name 'files', up to 8 files
router.post('/attachments', auth, upload.array('files', 8), asyncWrap(Chats.uploadAttachments));
// Optional legacy single-file endpoint (field 'file')
router.post('/attachment', auth, upload.single('file'), asyncWrap(Chats.uploadAttachment));

// ---------------- Soft delete -----------------
router.delete('/messages/:messageId', auth, asyncWrap(Chats.softDeleteMessage));

module.exports = router;
