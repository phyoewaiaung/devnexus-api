// routes/chats.js
const express = require('express');
const router = express.Router();

const auth = require('../middleware/authenticate');
const Chats = require('../controllers/ChatsController');

const isId = (v) => /^[0-9a-fA-F]{24}$/.test(String(v));
router.param('id', (req, res, next, id) => (isId(id) ? next() : res.status(400).json({ message: 'Invalid id' })));
router.param('messageId', (req, res, next, id) => (isId(id) ? next() : res.status(400).json({ message: 'Invalid id' })));

// Async wrapper
const asyncWrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// DMs
router.post('/conversations/dm', auth, asyncWrap(Chats.startDM));

// Conversations
router.post('/conversations', auth, asyncWrap(Chats.createConversation));
router.get('/conversations', auth, asyncWrap(Chats.listMyConversations));
router.get('/conversations/:id', auth, asyncWrap(Chats.getConversation));

// Invitations
router.post('/conversations/:id/invite', auth, asyncWrap(Chats.invite));
router.post('/conversations/:id/accept', auth, asyncWrap(Chats.acceptInvite));
router.post('/conversations/:id/decline', auth, asyncWrap(Chats.declineInvite));

// Messages
router.get('/conversations/:id/messages', auth, asyncWrap(Chats.listMessages));
router.post('/conversations/:id/messages', auth, asyncWrap(Chats.sendMessage));
router.post('/conversations/:id/read', auth, asyncWrap(Chats.markRead));

// Soft delete
router.delete('/messages/:messageId', auth, asyncWrap(Chats.softDeleteMessage));

module.exports = router;
