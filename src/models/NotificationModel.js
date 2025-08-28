// models/NotificationModel.js
const { Schema, model, Types } = require('mongoose');

const NotificationSchema = new Schema(
    {
        recipient: { type: Types.ObjectId, ref: 'User', index: true, required: true }, // post author
        actor: { type: Types.ObjectId, ref: 'User', required: true },                  // who liked/commented
        type: { type: String, enum: ['like', 'comment'], required: true },
        post: { type: Types.ObjectId, ref: 'Post', required: true },
        comment: { type: Types.ObjectId }, // store comment _id for comment notifs
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

module.exports = model('Notification', NotificationSchema);
