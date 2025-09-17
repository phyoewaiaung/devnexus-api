// routes/chats.js
const router = require('express').Router();
const Chats = require('../controllers/ChatsController');
const auth = require('../middleware/authenticate');

router.post('/conversations', auth, Chats.createConversation);
router.get('/conversations', auth, Chats.listMyConversations);
router.get('/conversations/:id', auth, Chats.getConversation);
router.get('/conversations/:id/messages', auth, Chats.listMessages);
router.post('/conversations/:id/messages', auth, Chats.sendMessage);
router.post('/conversations/:id/read', auth, Chats.markRead);

module.exports = router;
