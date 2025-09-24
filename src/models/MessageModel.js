const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const messageSchema = new Schema({
    conversation: { type: Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    // NEW: client-generated id for optimistic reconciliation on the client
    clientMsgId: { type: String },

    text: { type: String, default: '' },
    attachments: [{
        url: String,
        type: { type: String, enum: ['image', 'file', 'audio', 'video', 'other'], default: 'other' },
        name: String,
        size: Number
    }],
    deliveredTo: [{ type: Types.ObjectId, ref: 'User', index: true }],
    readBy: [{ type: Types.ObjectId, ref: 'User', index: true }],
    deletedFor: [{ type: Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

messageSchema.index({ conversation: 1, createdAt: -1 });
// Helpful for any future reconciliation/queries by clientMsgId
messageSchema.index({ conversation: 1, clientMsgId: 1 });

module.exports = mongoose.model('Message', messageSchema);
