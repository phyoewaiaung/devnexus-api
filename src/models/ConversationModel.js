// models/ConversationModel.js
const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const participantSchema = new Schema({
    user: { type: Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], default: 'member' },
    lastReadAt: { type: Date, default: new Date(0) },   // for unread counts
}, { _id: false });

const conversationSchema = new Schema({
    isGroup: { type: Boolean, default: false },
    title: { type: String, default: '' },               // group name (optional for 1:1)
    participants: { type: [participantSchema], validate: v => v.length >= 2 },
    lastMessageAt: { type: Date, default: Date.now },
}, { timestamps: true });

conversationSchema.index({ 'participants.user': 1 });
conversationSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
