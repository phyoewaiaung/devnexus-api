const Post = require('../models/PostModel');
const User = require('../models/UsersModel');
const { getIO } = require('../socket');
const Notification = require('../models/NotificationModel');


// POST /api/posts
exports.create = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ message: 'Text required' });
    const post = await Post.create({ author: req.user.id, text: text.trim() });
    res.status(201).json({ post });
  } catch (e) { next(e); }
};

// DELETE /api/posts/:id
exports.remove = async (req, res, next) => {
  try {
    const p = await Post.findOneAndDelete({ _id: req.params.id, author: req.user.id });
    if (!p) return res.status(404).json({ message: 'Post not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

// GET /api/posts/feed?page=1&limit=10
exports.feed = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 50);

    const posts = await Post.find({})
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate([
        { path: 'author', select: 'name username avatarUrl' },
        { path: 'comments.author', select: 'name username avatarUrl' },
      ]);

    res.json({ posts, page, limit });
  } catch (e) { next(e); }
};

// GET /api/posts/user/:username
exports.byUser = async (req, res, next) => {
  try {
    const username = String(req.params.username || '').toLowerCase();
    const user = await User.findOne({ username }).select('_id');
    if (!user) return res.json({ posts: [] });

    const posts = await Post.find({ author: user._id })
      .sort({ createdAt: -1 })
      .populate([
        { path: 'author', select: 'name username avatarUrl' },
        { path: 'comments.author', select: 'name username avatarUrl' },
      ]);

    res.json({ posts });
  } catch (e) { next(e); }
};

// POST /api/posts/:id/like  (toggle)
exports.toggleLike = async (req, res, next) => {
  try {
    const id = req.params.id;
    const uid = req.user.id;

    const has = await Post.exists({ _id: id, likes: uid });
    const update = has
      ? { $pull: { likes: uid }, $inc: { likesCount: -1 } }
      : { $addToSet: { likes: uid }, $inc: { likesCount: 1 } };

    // fetch author so we can notify
    const post = await Post.findByIdAndUpdate(id, update, {
      new: true,
      select: 'likesCount author',
    });
    if (!post) return res.status(404).json({ message: 'Post not found' });

    // respond immediately
    res.json({ likesCount: post.likesCount, liked: !has });

    // fire-and-forget side effects (notification + realtime)
    (async () => {
      try {
        const recipientId = String(post.author);
        if (recipientId === String(uid)) return; // no self-notifs

        const io = getIO();

        if (has) {
          // UNLIKE → remove like notification + tell client to remove
          await Notification.deleteOne({
            recipient: recipientId,
            actor: uid,
            post: id,
            type: 'like',
          });

          io.to(recipientId).emit('notification:remove', {
            type: 'like',
            postId: String(id),
            actorId: String(uid),
          });
        } else {
          // LIKE → upsert like notification + emit the new notif
          const notif = await Notification.findOneAndUpdate(
            { recipient: recipientId, actor: uid, post: id, type: 'like' },
            { $setOnInsert: { read: false } },
            { new: true, upsert: true }
          ).populate({ path: 'actor', select: 'name username avatarUrl' });

          io.to(recipientId).emit('notification:new', {
            id: String(notif._id),
            type: 'like',
            postId: String(id),
            read: notif.read,
            createdAt: notif.createdAt,
            actor: notif.actor, // { _id, name, username, avatarUrl }
          });
        }

        // OPTIONAL: also emit updated unread count
        // const unread = await Notification.countDocuments({ recipient: recipientId, read: false });
        // io.to(recipientId).emit('notification:count', { unread });

      } catch (e) { console.log(e) }
    })();

  } catch (e) { next(e); }
};


// POST /api/posts/:id/comments
// POST /api/posts/:id/comments
exports.addComment = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ message: 'Text required' });

    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: { author: req.user.id, text: text.trim() } } },
      { new: true }
    )
      .populate({ path: 'comments.author', select: 'name username avatarUrl' })
      .select('author comments'); // include author to notify

    if (!post) return res.status(404).json({ message: 'Post not found' });

    const newComment = post.comments[post.comments.length - 1];

    // respond immediately
    res.status(201).json({ comments: post.comments });

    // fire-and-forget side effects (notification + realtime)
    (async () => {
      try {
        const recipientId = String(post.author);
        const actorId = String(req.user.id);
        if (recipientId === actorId) return; // no self-notifs

        const notif = await Notification.create({
          recipient: recipientId,
          actor: actorId,
          type: 'comment',
          post: post._id,
          comment: newComment?._id,
        });
        await notif.populate({ path: 'actor', select: 'name username avatarUrl' });

        const io = getIO();
        io.to(recipientId).emit('notification:new', {
          id: String(notif._id),
          type: 'comment',
          postId: String(post._id),
          commentId: String(newComment?._id),
          comment_desc: String(newComment?.text),
          read: notif.read,
          createdAt: notif.createdAt,
          actor: notif.actor,
        });

        // OPTIONAL unread count
        // const unread = await Notification.countDocuments({ recipient: recipientId, read: false });
        // io.to(recipientId).emit('notification:count', { unread });

      } catch { }
    })();

  } catch (e) { next(e); }
};


// GET /api/posts/:id/comments
exports.listComments = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id)
      .select('comments')
      .populate({ path: 'comments.author', select: 'name username avatarUrl' });
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json({ comments: post.comments });
  } catch (e) { next(e); }
};
