const express = require('express');
const router = express.Router();
const auth = require('../middleware/authenticate');
const ctrl = require('../controllers/NotificationsController');

// All notification routes require login
router.use(auth);

// GET /api/notifications
router.get('/', ctrl.list);

// POST /api/notifications/read
router.post('/read', ctrl.markRead);

module.exports = router;
