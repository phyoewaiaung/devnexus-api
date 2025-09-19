// controllers/NotificationController.js
const { Types } = require('mongoose');
const Notification = require('../models/NotificationModel');

const isBoolTrue = (v) => v === true || v === 'true' || v === 1 || v === '1';

/**
 * GET /api/notifications
 * Query:
 *  - limit?: number (default 50, max 100)
 *  - cursor?: ISO date or _id; returns items with createdAt < cursor
 *  - types?: comma-separated list (e.g. "like,comment,chat:message")
 *  - unreadOnly?: boolean
 * Returns:
 *  { notifications, nextCursor, unreadCount }
 */
exports.list = async (req, res, next) => {
    try {
        const { limit = 50, cursor, types, unreadOnly } = req.query;

        const lim = Math.min(100, Math.max(1, Number(limit) || 50));

        const q = { recipient: req.user.id };
        if (isBoolTrue(unreadOnly)) q.read = false;

        if (types) {
            const arr = String(types)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            if (arr.length) q.type = { $in: arr };
        }

        // Cursor by createdAt (ISO) or by id -> translate to createdAt
        if (cursor) {
            let cutoff = null;
            const asDate = new Date(cursor);
            if (!Number.isNaN(asDate.getTime())) {
                cutoff = asDate;
            } else if (Types.ObjectId.isValid(cursor)) {
                const curDoc = await Notification.findOne(
                    { _id: cursor, recipient: req.user.id },
                ).select('createdAt');
                if (curDoc) cutoff = curDoc.createdAt;
            }
            if (cutoff) q.createdAt = { $lt: cutoff };
        }

        const notifications = await Notification.find(q)
            .sort({ createdAt: -1 })
            .limit(lim)
            .populate([
                { path: 'actor', select: 'name username avatarUrl' },
                { path: 'post', select: 'text' },
                { path: 'conversation', select: 'title isGroup participants' },
                { path: 'message', select: 'text createdAt sender' },
            ])
            .lean();

        const nextCursor =
            notifications.length ? notifications[notifications.length - 1].createdAt : null;

        const unreadCount = await Notification.countDocuments({
            recipient: req.user.id,
            read: false,
        });

        res.json({ notifications, nextCursor, unreadCount });
    } catch (e) {
        next(e);
    }
};

/**
 * GET /api/notifications/unread-count
 * Returns { unread: number }
 */
exports.countUnread = async (_req, res, next) => {
    try {
        const unread = await Notification.countDocuments({
            recipient: _req.user.id,
            read: false,
        });
        res.json({ unread });
    } catch (e) {
        next(e);
    }
};

/**
 * POST /api/notifications/mark-read
 * Body: { ids: string[] }
 * Marks specific notifications as read (only for the current recipient)
 * Returns { ok: true, updated: number }
 */
exports.markRead = async (req, res, next) => {
    try {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
        const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
        if (!validIds.length) return res.json({ ok: true, updated: 0 });

        const r = await Notification.updateMany(
            { recipient: req.user.id, _id: { $in: validIds } },
            { $set: { read: true } }
        );

        res.json({ ok: true, updated: r.modifiedCount || 0 });
    } catch (e) {
        next(e);
    }
};

/**
 * POST /api/notifications/mark-all-read
 * Body: { types?: string[] }  // optional filter by types
 * Returns { ok: true, updated: number }
 */
exports.markAllRead = async (req, res, next) => {
    try {
        const { types } = req.body || {};
        const q = { recipient: req.user.id, read: false };
        if (Array.isArray(types) && types.length) q.type = { $in: types };

        const r = await Notification.updateMany(q, { $set: { read: true } });

        res.json({ ok: true, updated: r.modifiedCount || 0 });
    } catch (e) {
        next(e);
    }
};
