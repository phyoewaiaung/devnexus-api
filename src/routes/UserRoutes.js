const express = require('express');
const router = express.Router();
const auth = require('../middleware/authenticate');
const ctrl = require('../controllers/UsersController');
const profile = require('../controllers/ProfileController');
const uploadAvatar = require('../middleware/uploadAvatar');
const uploadCover = require('../middleware/uploadCover');

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout', ctrl.logout);
router.get('/me', auth, ctrl.me);
router.post('/me/avatar', auth, uploadAvatar.single('avatar'), profile.uploadAvatar);
router.post('/me/cover', auth, uploadCover.single('cover'), profile.uploadCover);

// profile
router.get('/profile/:username', profile.getPublic);  // public profile by username
router.patch('/me', auth, profile.updateMe);          // update my profile

// follow
router.post('/follow/:username', auth, profile.follow);
router.post('/unfollow/:username', auth, profile.unfollow);
router.get('/followers/:username', profile.listFollowers);
router.get('/following/:username', profile.listFollowing);

module.exports = router;
