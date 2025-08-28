const Notification = require('../models/NotificationModel');

exports.list = async (req, res, next) => {
    try {
        const items = await Notification.find({ recipient: req.user.id })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate([
                { path: 'actor', select: 'name username avatarUrl' },
                { path: 'post', select: 'text' },
            ]);
        res.json({ notifications: items });
    } catch (e) { next(e); }
};

exports.markRead = async (req, res, next) => {
    try {
        await Notification.updateMany(
            { recipient: req.user.id, _id: { $in: req.body.ids || [] } },
            { $set: { read: true } }
        );
        res.json({ ok: true });
    } catch (e) { next(e); }
};
