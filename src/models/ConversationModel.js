// models/ConversationModel.js
const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

/**
 * status:
 *  - 'invited'  : user can see the conversation in Invites and must accept
 *  - 'member'   : full participant, sees messages
 */
const participantSchema = new Schema({
    user: { type: Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], default: 'member' },
    status: { type: String, enum: ['invited', 'member'], default: 'member', index: true },

    // invite lifecycle (only set when invited)
    invitedBy: { type: Types.ObjectId, ref: 'User' },
    invitedAt: { type: Date },

    // acceptance lifecycle
    acceptedAt: { type: Date },

    // unread tracking (for members only, but harmless to keep here)
    lastReadAt: { type: Date, default: new Date(0) },
}, { _id: false });

const conversationSchema = new Schema({
    isGroup: { type: Boolean, default: false },
    title: { type: String, default: '' },               // optional for 1:1
    participants: { type: [participantSchema], default: [] },  // no longer require >=2 (creator-only allowed)
    lastMessageAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Indexes
conversationSchema.index({ 'participants.user': 1 });
conversationSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
