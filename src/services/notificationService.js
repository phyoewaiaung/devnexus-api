// services/notificationService.js
const Notification = require('../models/NotificationModel');

function isSelf(a, b) { return String(a) === String(b); }

async function upsertLike({ recipientId, actorId, postId }) {
    if (isSelf(recipientId, actorId)) return;
    await Notification.updateOne(
        { recipient: recipientId, actor: actorId, post: postId, type: 'like' },
        { $setOnInsert: { read: false }, $set: { meta: {} } },
        { upsert: true }
    );
}

async function removeLike({ recipientId, actorId, postId }) {
    await Notification.deleteOne({ recipient: recipientId, actor: actorId, post: postId, type: 'like' });
}

async function createComment({ recipientId, actorId, postId, commentId }) {
    if (isSelf(recipientId, actorId)) return;
    await Notification.create({
        recipient: recipientId,
        actor: actorId,
        type: 'comment',
        post: postId,
        comment: commentId,
    });
}

module.exports = { upsertLike, removeLike, createComment };
