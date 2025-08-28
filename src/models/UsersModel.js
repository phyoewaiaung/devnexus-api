const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true }, // will hold hashed password
    roles: { type: [String], default: ['user'] },
    bio: { type: String, default: '' },
    skills: { type: [String], default: [] },
    avatarUrl: { type: String, default: '' },
    coverUrl: { type: String, default: null },
    socialLinks: { type: Object, default: {} },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    followersCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },

  },
  { timestamps: true }
);

// hash passwordHash if modified
UserSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
  next();
});

UserSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('User', UserSchema);
