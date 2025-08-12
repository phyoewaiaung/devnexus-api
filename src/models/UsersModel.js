const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50,
  },
  username: {
    type: String,
    unique: true,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: [/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens'],
  },
  email: {
    type: String,
    unique: true,
    required: true,
    lowercase: true,
    trim: true,
    match: [/.+\@.+\..+/, 'Please enter a valid email address'],
  },
  passwordHash: {
    type: String,
    required: true,
  },
  bio: {
    type: String,
    maxlength: 300,
  },
  skills: {
    type: [String],
    default: [],
  },
  avatarUrl: {
    type: String,
    default: '',  // Can add default avatar URL here if desired
  },
  socialLinks: {
    github: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    twitter: { type: String, default: '' },
  },
  roles: {
    type: [String],
    default: ['user'], // e.g., 'user', 'admin'
  }
}, { timestamps: true });

// Hash password before saving if modified
UserSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  try {
    const hashed = await bcrypt.hash(this.passwordHash, SALT_ROUNDS);
    this.passwordHash = hashed;
    next();
  } catch (err) {
    next(err);
  }
});

// Compare password method for authentication
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

module.exports = mongoose.model('User', UserSchema);
