const User = require('../models/UsersModel');
const path = require('path');
const fs = require('fs');

// GET /api/users/profile/:username
exports.getPublic = async (req, res, next) => {
  try {
    const u = await User.findOne({ username: req.params.username.toLowerCase() })
      .select('name username bio skills avatarUrl coverUrl socialLinks roles followersCount followingCount createdAt');
    if (!u) return res.status(404).json({ message: 'User not found' });
    res.json({ user: u });
  } catch (e) { next(e); }
};

// PATCH /api/users/me
exports.updateMe = async (req, res, next) => {
  try {
    const allowed = ['name', 'bio', 'skills', 'avatarUrl', 'coverUrl', 'socialLinks'];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: update },
      { new: true, select: '-passwordHash -__v' }
    );
    res.json({ user });
  } catch (e) { next(e); }
};

// simple follow fields on User: followers[], following[] + counts
exports.follow = async (req, res, next) => {
  try {
    const target = await User.findOne({ username: req.params.username.toLowerCase() }).select('_id');
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (String(target._id) === req.user.id) return res.status(400).json({ message: 'Cannot follow yourself' });

    await User.updateOne(
      { _id: req.user.id, following: { $ne: target._id } },
      { $addToSet: { following: target._id }, $inc: { followingCount: 1 } }
    );
    await User.updateOne(
      { _id: target._id, followers: { $ne: req.user.id } },
      { $addToSet: { followers: req.user.id }, $inc: { followersCount: 1 } }
    );

    res.json({ ok: true });
  } catch (e) { next(e); }
};

exports.unfollow = async (req, res, next) => {
  try {
    const target = await User.findOne({ username: req.params.username.toLowerCase() }).select('_id');
    if (!target) return res.status(404).json({ message: 'User not found' });

    const a = await User.updateOne(
      { _id: req.user.id, following: target._id },
      { $pull: { following: target._id }, $inc: { followingCount: -1 } }
    );
    const b = await User.updateOne(
      { _id: target._id, followers: req.user.id },
      { $pull: { followers: req.user.id }, $inc: { followersCount: -1 } }
    );

    res.json({ ok: true });
  } catch (e) { next(e); }
};

exports.listFollowers = async (req, res, next) => {
  try {
    const u = await User.findOne({ username: req.params.username.toLowerCase() })
      .select('followers')
      .populate({ path: 'followers', select: 'name username avatarUrl' });
    if (!u) return res.status(404).json({ message: 'User not found' });
    res.json({ users: u.followers });
  } catch (e) { next(e); }
};

exports.listFollowing = async (req, res, next) => {
  try {
    const u = await User.findOne({ username: req.params.username.toLowerCase() })
      .select('following')
      .populate({ path: 'following', select: 'name username avatarUrl' });
    if (!u) return res.status(404).json({ message: 'User not found' });
    res.json({ users: u.following });
  } catch (e) { next(e); }
};

exports.uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // Remove old local avatar if present
    const current = await User.findById(req.user.id).select('avatarUrl');
    if (current?.avatarUrl && current.avatarUrl.includes('/uploads/avatars/')) {
      const filename = current.avatarUrl.split('/uploads/avatars/')[1];
      const localPath = path.join(__dirname, '..', '..', 'uploads', 'avatars', filename);
      fs.promises.unlink(localPath).catch(() => { });
    }

    const relPath = `/uploads/avatars/${req.file.filename}`;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const avatarUrl = `${baseUrl}${relPath}`;

    await User.findByIdAndUpdate(req.user.id, { avatarUrl }, { new: true });
    res.json({ avatarUrl });
  } catch (e) {
    next(e);
  }
};

exports.uploadCover = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // Remove old local cover if present
    const current = await User.findById(req.user.id).select('coverUrl');
    if (current?.coverUrl && current.coverUrl.includes('/uploads/covers/')) {
      const filename = current.coverUrl.split('/uploads/covers/')[1];
      const localPath = path.join(__dirname, '..', '..', 'uploads', 'covers', filename);
      fs.promises.unlink(localPath).catch(() => { });
    }

    const relPath = `/uploads/covers/${req.file.filename}`;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const coverUrl = `${baseUrl}${relPath}`;

    await User.findByIdAndUpdate(req.user.id, { coverUrl }, { new: true });
    res.json({ coverUrl });
  } catch (e) {
    next(e);
  }
};