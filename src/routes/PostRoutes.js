// src/routes/PostRoutes.js
const express = require('express');
const router = express.Router();

const auth = require('../middleware/authenticate');
const ctrl = require('../controllers/PostController');
const { uploadPostImage } = require('../middleware/uploadPostImage');

// Feeds
router.get('/feed', auth, ctrl.feed);
router.get('/feed/following', auth, ctrl.followingFeed);

// User timeline
router.get('/user/:username', ctrl.byUser);

// Create
router.post('/', auth, uploadPostImage.single('image'), ctrl.create);

// Like / Delete
router.post('/:id/like', auth, ctrl.toggleLike);
router.delete('/:id', auth, ctrl.remove);

// Comments
router.post('/:id/comments', auth, ctrl.addComment);
router.get('/:id/comments', ctrl.listComments);

// Detail
router.get('/:id', ctrl.getById);

router.post('/:id/repost', auth, ctrl.repost);   // <<— entry point for "share as repost"

module.exports = router;
