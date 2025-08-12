const jwt = require('jsonwebtoken');
const User = require('../models/UsersModel'); 
const bcrypt = require('bcrypt');

const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user._id, username: user.username, roles: user.roles },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY }
  );
};

// Register user
exports.register = async (req, res, next) => {
  try {
    const { name, username, email, password, bio, skills, avatarUrl, socialLinks } = req.body;

    if (!name || !username || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) return res.status(409).json({ message: 'User already exists' });

    const passwordHash = password; // Will be hashed by mongoose pre-save middleware

    const newUser = new User({
      name,
      username,
      email,
      passwordHash,
      bio,
      skills,
      avatarUrl,
      socialLinks
    });

    await newUser.save();

    res.status(201).json({ message: 'User registered successfully' });

  } catch (error) {
    next(error);
  }
};

// Login user
exports.login = async (req, res, next) => {
  try {
    const { usernameOrEmail, password } = req.body;
    if (!usernameOrEmail || !password) {
      return res.status(400).json({ message: 'Missing credentials' });
    }

    const user = await User.findOne({
      $or: [{ email: usernameOrEmail.toLowerCase() }, { username: usernameOrEmail }]
    });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const passwordMatch = await user.comparePassword(password);
    if (!passwordMatch) return res.status(401).json({ message: 'Invalid credentials' });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store refresh token in httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ accessToken });

  } catch (error) {
    next(error);
  }
};

// Refresh token endpoint
exports.refresh = (req, res, next) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) return res.status(401).json({ message: 'Refresh token missing' });

    jwt.verify(token, process.env.JWT_REFRESH_SECRET, (err, decoded) => {
      if (err) return res.status(403).json({ message: 'Invalid refresh token' });

      const accessToken = jwt.sign(
        { id: decoded.id },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
      );

      res.json({ accessToken });
    });

  } catch (error) {
    next(error);
  }
};

// Logout user (clear refresh token)
exports.logout = (req, res) => {
  res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'Strict', secure: process.env.NODE_ENV === 'production' });
  res.json({ message: 'Logged out successfully' });
};
