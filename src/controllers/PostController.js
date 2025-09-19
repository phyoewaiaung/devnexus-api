const path = require('path');
const Post = require('../models/PostModel');
const User = require('../models/UsersModel');
const { getIO, userRoom, emitUnreadCount } = require('../socket');
const Notification = require('../models/NotificationModel');

/** Map common aliases to our allowed names */
const LANG_ALIAS = {
  js: 'javascript',
  ts: 'typescript',
  cplusplus: 'cpp',
  shell: 'bash',
  sh: 'bash',
  md: 'markdown',
  yml: 'yaml'
};

function extractLanguages(markdown = '') {
  const langs = new Set();
  const re = /```(\w+)[^\n]*\n[\s\S]*?```/g; // capture ```lang ... ```
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const raw = (m[1] || '').toLowerCase();
    const normalized = LANG_ALIAS[raw] || raw;
    if (Post.ALLOWED_LANGS.includes(normalized)) langs.add(normalized);
  }
  return [...langs];
}

function normalizeTags(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map(s => String(s).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

// -----------------------------
// POST /api/posts   (multipart: text + optional image + optional tags)
// -----------------------------
exports.create = async (req, res, next) => {
  try {
    const { text = '', tags } = req.body;
    const trimmed = text.trim();

    if (!trimmed && !req.file) {
      return res.status(400).json({ message: 'Text or image required' });
    }
    if (trimmed.length > 5000) {
      return res.status(400).json({ message: 'Text exceeds 5,000 characters' });
    }

    // Build image (if uploaded by multer)
    let image = null;
    if (req.file) {
      const relPath = path.join('uploads', 'posts', req.file.filename).replace(/\\/g, '/');
      const url = `${req.protocol}://${req.get('host')}/${relPath}`;
      image = { url, mimeType: req.file.mimetype, size: req.file.size };
    }

    // Tags & languages
    const normalizedTags = normalizeTags(tags);
    const languages = extractLanguages(trimmed);

    // if user tagged a known language, include it in languages as well
    for (const t of normalizedTags) {
      if (Post.ALLOWED_LANGS.includes(t) && !languages.includes(t)) languages.push(t);
    }

    const post = await Post.create({
      author: req.user.id,
      text: trimmed || '',
      image,
      tags: normalizedTags,
      languages
    });

    res.status(201).json({ post });
  } catch (e) {
    if (e && e.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Image must be less than 5MB.' });
    }
    if (e && e.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ message: 'Please select an image file.' });
    }
    next(e);
  }
};

// -----------------------------
// DELETE /api/posts/:id
// -----------------------------
exports.remove = async (req, res, next) => {
  try {
    const p = await Post.findOneAndDelete({ _id: req.params.id, author: req.user.id });
    if (!p) return res.status(404).json({ message: 'Post not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

// -----------------------------
// GET /api/posts/feed?page=1&limit=10&lang=js,python&tag=react
// -----------------------------
exports.feed = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 50);

    const q = {};
    if (req.query.lang) {
      q.languages = { $in: String(req.query.lang).toLowerCase().split(',').filter(Boolean) };
    }
    if (req.query.tag) {
      q.tags = { $in: String(req.query.tag).toLowerCase().split(',').filter(Boolean) };
    }

    const posts = await Post.find(q)
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

exports.followingFeed = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 50);

    // 1) Load who the user follows
    const me = await User.findById(req.user.id).select('following');
    const followingIds = (me?.following || []).map(String);

    // If not following anyone, short-circuit
    if (!followingIds.length) {
      return res.json({ posts: [], page, limit });
    }

    // 2) Build query (reuse your lang/tag filters)
    const q = { author: { $in: followingIds } };

    if (req.query.lang) {
      q.languages = {
        $in: String(req.query.lang).toLowerCase().split(',').filter(Boolean)
      };
    }
    if (req.query.tag) {
      q.tags = {
        $in: String(req.query.tag).toLowerCase().split(',').filter(Boolean)
      };
    }

    // 3) Fetch posts
    const posts = await Post.find(q)
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

// -----------------------------
// GET /api/posts/user/:username
// -----------------------------
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

// -----------------------------
// POST /api/posts/:id/like  (toggle)
// -----------------------------
exports.toggleLike = async (req, res, next) => {
  try {
    const id = req.params.id;
    const uid = req.user.id;

    const has = await Post.exists({ _id: id, likes: uid });
    const update = has
      ? { $pull: { likes: uid }, $inc: { likesCount: -1 } }
      : { $addToSet: { likes: uid }, $inc: { likesCount: 1 } };

    const post = await Post.findByIdAndUpdate(id, update, {
      new: true,
      select: 'likesCount author',
    });
    if (!post) return res.status(404).json({ message: 'Post not found' });

    res.json({ likesCount: post.likesCount, liked: !has });

    // Background notif handling
    setImmediate(async () => {
      try {
        const recipientId = String(post.author);
        if (recipientId === String(uid)) return;

        const io = getIO(); // will throw if not initialized
        if (has) {
          await Notification.deleteOne({
            recipient: recipientId,
            actor: uid,
            post: id,
            type: 'like',
          });

          io.to(userRoom(recipientId)).emit('notification:remove', {
            type: 'like',
            postId: String(id),
            actorId: String(uid),
          });
        } else {
          const notif = await Notification.findOneAndUpdate(
            { recipient: recipientId, actor: uid, post: id, type: 'like' },
            { $setOnInsert: { read: false, createdAt: new Date() } },
            { new: true, upsert: true }
          ).populate({ path: 'actor', select: 'name username avatarUrl' });

          io.to(userRoom(recipientId)).emit('notification:new', {
            id: String(notif._id),
            type: 'like',
            postId: String(id),
            read: notif.read,
            createdAt: notif.createdAt,
            actor: notif.actor,
          });
        }

        // keep the badge in sync
        await emitUnreadCount(recipientId);
      } catch (e) {
        console.error('Error handling like notification:', e);
      }
    });
  } catch (e) { next(e); }
};

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
      .select('author comments');

    if (!post) return res.status(404).json({ message: 'Post not found' });

    const newComment = post.comments[post.comments.length - 1];
    res.status(201).json({ comments: post.comments });

    setImmediate(async () => {
      try {
        const recipientId = String(post.author);
        const actorId = String(req.user.id);
        if (recipientId === actorId) return;

        const notif = await Notification.create({
          recipient: recipientId,
          actor: actorId,
          type: 'comment',
          post: post._id,
          comment: newComment?._id,
          read: false,
          createdAt: new Date(),
        });

        await notif.populate({ path: 'actor', select: 'name username avatarUrl' });

        const io = getIO();
        io.to(userRoom(recipientId)).emit('notification:new', {
          id: String(notif._id),
          type: 'comment',
          postId: String(post._id),
          commentId: String(newComment?._id),
          comment_desc: String(newComment?.text || '').substring(0, 100),
          read: notif.read,
          createdAt: notif.createdAt,
          actor: notif.actor,
        });

        await emitUnreadCount(recipientId);
      } catch (e) {
        console.error('Error handling comment notification:', e);
      }
    });
  } catch (e) { next(e); }
};


// -----------------------------
// GET /api/posts/:id/comments
// -----------------------------
exports.listComments = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id)
      .select('comments')
      .populate({ path: 'comments.author', select: 'name username avatarUrl' });
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json({ comments: post.comments });
  } catch (e) { next(e); }
};

exports.getById = async (req, res, next) => {
  try {
    const id = req.params.id;

    const post = await Post.findById(id)
      .populate([
        { path: 'author', select: 'name username avatarUrl' },
        { path: 'comments.author', select: 'name username avatarUrl' },
      ]);

    if (!post) return res.status(404).json({ message: 'Post not found' });

    const obj = post.toObject();
    obj.likesCount = typeof post.likesCount === 'number'
      ? post.likesCount
      : Array.isArray(post.likes) ? post.likes.length : 0;

    obj.commentsCount = Array.isArray(post.comments) ? post.comments.length : 0;

    obj.liked = false;
    if (req.user?.id) {
      obj.liked = !!(await Post.exists({ _id: id, likes: req.user.id }));
    }

    obj.canDelete = String(post.author?._id) === String(req.user?.id);

    res.json({ post: obj });
  } catch (e) {
    if (e?.name === 'CastError') {
      return res.status(404).json({ message: 'Post not found' });
    }
    next(e);
  }
};