// controllers/usersController.js
// Simple, consistent style. Focused on auth + profile/theme. JWT cookie refresh flow.

const jwt = require('jsonwebtoken');
const User = require('../models/UsersModel');

// --- helpers ---------------------------------------------------------------
const ACCESS_TTL = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_TTL = process.env.REFRESH_TOKEN_EXPIRY || '7d';

const signAccess = (user) =>
  jwt.sign(
    { id: user._id, username: user.username, roles: user.roles, email: user.email },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );

const signRefresh = (user) =>
  jwt.sign(
    { id: user._id, tokenVersion: user.tokenVersion || 0 },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TTL }
  );

const setRefreshCookie = (res, token) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/users',
  });
};

const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/users',
  });
};

// --- controllers -----------------------------------------------------------
// POST /api/users/register
exports.register = async (req, res, next) => {
  try {
    let { name, username, email, password, bio, skills, avatarUrl, socialLinks, theme } = req.body;
    if (!name || !username || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    username = String(username).toLowerCase().trim();
    email = String(email).toLowerCase().trim();

    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(409).json({ message: 'User already exists' });

    const parseSkills = (v) =>
      Array.isArray(v) ? v : String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

    const parseLinks = (v) => {
      const o = v || {};
      return {
        website: o.website || '',
        github: o.github || '',
        twitter: o.twitter || '',
        linkedin: o.linkedin || '',
      };
    };

    const user = new User({
      name,
      username,
      email,
      passwordHash: password, // assume model hashes this
      bio: bio || '',
      skills: parseSkills(skills),
      avatarUrl: avatarUrl || '',
      socialLinks: parseLinks(socialLinks),
      roles: ['user'],
      theme: ['light', 'dark'].includes(theme) ? theme : 'light',
      tokenVersion: 0,
    });
    await user.save();

    return res.status(201).json({ message: 'Registered' });
  } catch (e) {
    next(e);
  }
};

// PATCH /api/users/theme
exports.updateTheme = async (req, res, next) => {
  try {
    const { theme } = req.body;
    if (!['light', 'dark'].includes(theme)) {
      return res.status(400).json({ message: 'Invalid theme' });
    }
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { theme },
      { new: true, select: '_id username theme' }
    );
    if (!user) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Theme updated', theme: user.theme });
  } catch (e) {
    next(e);
  }
};

// POST /api/users/login
exports.login = async (req, res, next) => {
  try {
    const { usernameOrEmail, password } = req.body;
    if (!usernameOrEmail || !password) {
      return res.status(400).json({ message: 'Missing credentials' });
    }
    const key = String(usernameOrEmail).toLowerCase().trim();
    const user = await User.findOne({ $or: [{ email: key }, { username: key }] });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const accessToken = signAccess(user);
    const refreshToken = signRefresh(user);
    setRefreshCookie(res, refreshToken);

    return res.json({ accessToken });
  } catch (e) {
    next(e);
  }
};

// POST /api/users/refresh
exports.refresh = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ message: 'Refresh token missing' });

    jwt.verify(token, process.env.JWT_REFRESH_SECRET, async (err, decoded) => {
      if (err) return res.status(403).json({ message: 'Invalid refresh token' });
      const user = await User.findById(decoded.id).select('_id username roles tokenVersion email');
      if (!user) return res.status(401).json({ message: 'User not found' });
      if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
        return res.status(403).json({ message: 'Token revoked' });
      }
      const accessToken = signAccess(user);
      return res.json({ accessToken });
    });
  } catch (e) {
    next(e);
  }
};

// POST /api/users/logout
exports.logout = (_req, res) => {
  clearRefreshCookie(res);
  res.json({ message: 'Logged out' });
};

// POST /api/users/revoke (optional: force refresh token rotation)
exports.revoke = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { $inc: { tokenVersion: 1 } });
    clearRefreshCookie(res);
    res.json({ message: 'Revoked' });
  } catch (e) { next(e); }
};

// GET /api/users/me
exports.me = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash -__v');
    if (!user) return res.status(404).json({ message: 'Not found' });
    res.json({ user });
  } catch (e) {
    next(e);
  }
};

// GET /api/users/search?q=term
exports.search = async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ users: [] });
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const users = await User.find({ $or: [{ username: rx }, { name: rx }, { email: rx }] })
      .limit(20)
      .select('_id name username avatarUrl bio skills');
    res.json({ users });
  } catch (e) { next(e); }
};

