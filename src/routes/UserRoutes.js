// routes/users.js
const express = require('express');
const router = express.Router();

const auth = require('../middleware/authenticate');
const ctrl = require('../controllers/UsersController');
const profile = require('../controllers/ProfileController');
const uploadAvatar = require('../middleware/uploadAvatar');
const uploadCover = require('../middleware/uploadCover');

// Small async wrapper to avoid try/catch in every route (optional)
const asyncWrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Auth
router.post('/register', asyncWrap(ctrl.register));
router.post('/login', asyncWrap(ctrl.login));
router.post('/refresh', asyncWrap(ctrl.refresh));
router.post('/logout', asyncWrap(ctrl.logout));

// Me
router.get('/me', auth, asyncWrap(ctrl.me));
router.patch('/me/theme', auth, asyncWrap(ctrl.updateTheme));

// Avatars / covers
router.post('/me/avatar', auth, uploadAvatar.single('avatar'), asyncWrap(profile.uploadAvatar));
router.post('/me/cover', auth, uploadCover.single('cover'), asyncWrap(profile.uploadCover));

// Public profile
router.get('/profile/:username', asyncWrap(profile.getPublic));

// Update my profile
router.patch('/me', auth, asyncWrap(profile.updateMe));

// Follow graph
router.post('/follow/:username', auth, asyncWrap(profile.follow));
router.post('/unfollow/:username', auth, asyncWrap(profile.unfollow));
router.get('/followers/:username', asyncWrap(profile.listFollowers));
router.get('/following/:username', asyncWrap(profile.listFollowing));

// User search
router.get('/search', auth, asyncWrap(ctrl.search)); // /api/users/search?q=term

module.exports = router;
