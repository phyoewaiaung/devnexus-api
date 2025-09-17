const jwt = require('jsonwebtoken');
const User = require('../models/UsersModel');

const signAccess = (user) =>
  jwt.sign(
    { id: user._id, username: user.username, roles: user.roles, email: user.email },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '15m' }
  );

const signRefresh = (user) =>
  jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d' }
  );

// POST /register
exports.register = async (req, res, next) => {
  try {
    let { name, username, email, password, bio, skills, avatarUrl, socialLinks } = req.body;
    if (!name || !username || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    username = String(username).toLowerCase().trim();
    email = String(email).toLowerCase().trim();

    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(409).json({ message: 'User already exists' });

    const parseSkills = (v) =>
      Array.isArray(v) ? v : String(v || '').split(',').map(s => s.trim()).filter(Boolean);
    const parseLinks = (v) => {
      const o = v || {};
      return {
        website: o.website || '',
        github: o.github || '',
        twitter: o.twitter || '',
        linkedin: o.linkedin || ''
      };
    };
    const user = new User({
      name, username, email,
      passwordHash: password,
      bio: bio || '',
      skills: parseSkills(skills),
      avatarUrl: avatarUrl || '',
      socialLinks: parseLinks(socialLinks),
      roles: ['user'],
      theme: ['light', 'dark'].includes(theme) ? theme : 'light',
    })
    await user.save();

    return res.status(201).json({ message: 'Registered' });
  } catch (e) {
    next(e);
  }
};

//theme
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

// POST /login
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

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/users',
    });

    return res.json({ accessToken });
  } catch (e) {
    next(e);
  }
};

// POST /refresh
exports.refresh = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ message: 'Refresh token missing' });

    jwt.verify(token, process.env.JWT_REFRESH_SECRET, async (err, decoded) => {
      if (err) return res.status(403).json({ message: 'Invalid refresh token' });
      const user = await User.findById(decoded.id).select('_id username roles');
      if (!user) return res.status(401).json({ message: 'User not found' });

      const accessToken = signAccess(user);
      return res.json({ accessToken });
    });
  } catch (e) {
    next(e);
  }
};

// POST /logout
exports.logout = (_req, res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/users',
  });
  res.json({ message: 'Logged out' });
};

// GET /me
exports.me = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash -__v');
    if (!user) return res.status(404).json({ message: 'Not found' });
    res.json({ user });
  } catch (e) {
    next(e);
  }
};
