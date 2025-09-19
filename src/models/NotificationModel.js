// models/NotificationModel.js
const { Schema, model, Types } = require('mongoose');

const NOTIF_TYPES = [
    'like',
    'comment',
    'chat:invite',
    'chat:message',
    'chat:added',
    'chat:removed',
    'chat:accept',
    'chat:decline',
];

const NotificationSchema = new Schema(
    {
        recipient: { type: Types.ObjectId, ref: 'User', index: true, required: true },
        actor: { type: Types.ObjectId, ref: 'User', required: true },

        type: { type: String, enum: NOTIF_TYPES, required: true, index: true },

        // Post graph (only for post notifs)
        post: {
            type: Types.ObjectId,
            ref: 'Post',
            required: function () {
                return this.type === 'like' || this.type === 'comment';
            },
        },
        comment: { type: Types.ObjectId, ref: 'Comment' },

        // Chat graph
        conversation: { type: Types.ObjectId, ref: 'Conversation' },
        message: { type: Types.ObjectId, ref: 'Message' },

        read: { type: Boolean, default: false },
        meta: { type: Object },
    },
    { timestamps: true }
);

// Ensure only one like-notif per (recipient, actor, post)
NotificationSchema.index(
    { recipient: 1, actor: 1, post: 1, type: 1 },
    { unique: true, partialFilterExpression: { type: 'like' } }
);

// Common inbox query
NotificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

module.exports = model('Notification', NotificationSchema);
