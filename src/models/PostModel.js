const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});

const ImageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  width: { type: Number },
  height: { type: Number }
}, { _id: false });

// match the UI's language list (lowercase)
const ALLOWED_LANGS = [
  'javascript', 'typescript', 'python', 'java', 'kotlin', 'swift', 'go', 'rust', 'cpp', 'c', 'csharp', 'php', 'ruby', 'dart',
  'scala', 'clojure', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'sql', 'bash', 'powershell', 'dockerfile', 'markdown',
  'latex', 'r', 'matlab', 'haskell', 'elixir'
];

const PostSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text: { type: String, required: true, trim: true, maxlength: 5000 },
  image: { type: ImageSchema, default: null },
  tags: [{ type: String, trim: true, lowercase: true, index: true }],
  languages: [{ type: String, enum: ALLOWED_LANGS, index: true }],
  visibility: { type: String, enum: ['public', 'followers'], default: 'public', index: true }, // NEW
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likesCount: { type: Number, default: 0 },
  comments: [CommentSchema]
}, { timestamps: true });

// keep likesCount & arrays normalized
PostSchema.pre('save', function (next) {
  if (Array.isArray(this.likes)) this.likesCount = this.likes.length;
  if (Array.isArray(this.tags)) this.tags = [...new Set(this.tags.map(t => t.toLowerCase()))];
  if (Array.isArray(this.languages)) this.languages = [...new Set(this.languages)];
  next();
});

module.exports = mongoose.model('Post', PostSchema);
module.exports.ALLOWED_LANGS = ALLOWED_LANGS;
