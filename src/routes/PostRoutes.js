const express = require('express');
const router = express.Router();
const auth = require('../middleware/authenticate');
const ctrl = require('../controllers/PostController');
const { uploadPostImage } = require('../middleware/uploadPostImage');

router.get('/feed', ctrl.feed);
router.get('/user/:username', ctrl.byUser);
router.post('/', auth, uploadPostImage.single('image'), ctrl.create);

router.delete('/:id', auth, ctrl.remove);
router.post('/:id/like', auth, ctrl.toggleLike);

router.post('/:id/comments', auth, ctrl.addComment);
router.get('/:id/comments', ctrl.listComments);

router.get('/:id', ctrl.getById);

module.exports = router;
