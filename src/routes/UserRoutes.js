const express = require('express');
const router = express.Router();
const authController = require('./../controllers/UsersController');
const authenticate = require('../middleware/authenticate');

router.post('/register',authenticate, authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

module.exports = router;
