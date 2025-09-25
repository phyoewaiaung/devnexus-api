// ChatController.js - Key changes for socket rooms
const mongoose = require('mongoose');
const path = require('path');
const Conversation = require('../models/ConversationModel');
const Message = require('../models/MessageModel');
const Notification = require('../models/NotificationModel');
const { getIO, userRoom, conversationRoom, emitUnreadCount } = require('../socket'); // Import conversationRoom

const asObjectId = (v) => new mongoose.Types.ObjectId(String(v));

/** persist + emit a notification with a consistent payload */
async function createNotifAndEmit({ recipientId, actorId, type, conversationId, messageId = null, postId = null, meta = {} }) {
    const notif = await Notification.create({
        recipient: recipientId,
        actor: actorId,
        type,
        conversation: conversationId || undefined,
        message: messageId || undefined,
        post: postId || undefined,
        meta,
        read: false,
    });

    await notif.populate({ path: 'actor', select: 'name username avatarUrl' });

    const io = getIO?.();
    if (io) {
        io.to(userRoom(String(recipientId))).emit('notification:new', {
            id: String(notif._id),
            _id: String(notif._id),
            type: notif.type,
            read: !!notif.read,
            createdAt: notif.createdAt,
            actor: notif.actor,
            conversationId: conversationId ? String(conversationId) : undefined,
            messageId: messageId ? String(messageId) : undefined,
            postId: postId ? String(postId) : undefined,
            meta: meta || {},
        });

        await emitUnreadCount(String(recipientId)).catch(() => { });
    }

    return notif;
}

// ... keep all other existing methods unchanged until sendMessage ...
const publicUrl = (req, relPath) => {
    const cleaned = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
    const proto = req.protocol;
    const host = req.get('host');
    return `${proto}://${host}/${cleaned}`;
};

exports.uploadAttachments = async (req, res, next) => {
    try {
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ message: 'No files uploaded' });

        const attachments = files.map((f) => {
            // ALWAYS forward slashes; URL should be under /uploads/chat/...
            const rel = path.join('uploads', 'chat', f.filename).replace(/\\/g, '/');
            return {
                url: publicUrl(req, rel),
                type: 'image',
                name: f.originalname,
                size: f.size,
            };
        });

        res.status(201).json({ attachments });
    } catch (e) { next(e); }
};

// (Optional) single file (legacy)
exports.uploadAttachment = async (req, res, next) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
        const rel = path.join('uploads', 'chat', req.file.filename).replace(/\\/g, '/');
        const url = publicUrl(req, rel);
        return res.status(201).json({
            attachment: { url, type: 'image', name: req.file.originalname, size: req.file.size },
        });
    } catch (e) { next(e); }
};
/** --------- POST /api/chats/conversations/:id/messages */
exports.sendMessage = async (req, res, next) => {
    try {
        const { text = '', attachments = [], clientMsgId = null } = req.body;
        const me = asObjectId(req.user.id);
        const convo = await Conversation.findById(req.params.id);
        if (!convo) return res.status(404).json({ message: 'Not found' });

        const mePart = (convo.participants || []).find((p) => String(p.user) === String(me));
        if (!mePart) return res.status(403).json({ message: 'Forbidden' });
        if ((mePart.status || 'member') !== 'member') return res.status(403).json({ message: 'Accept the invite before sending messages' });

        const trimmed = String(text || '').trim();
        const msg = await Message.create({
            conversation: convo._id,
            sender: me,
            text: trimmed,
            attachments,
            clientMsgId: clientMsgId || undefined,
        });

        convo.lastMessageAt = new Date();
        await convo.save();

        const others = (convo.participants || [])
            .filter((p) => String(p.user) !== String(me) && (p.status || 'member') !== 'invited')
            .map((p) => p.user);

        await Promise.all(
            others.map((uid) =>
                createNotifAndEmit({
                    recipientId: uid,
                    actorId: me,
                    type: 'chat:message',
                    conversationId: convo._id,
                    messageId: msg._id,
                    meta: {
                        preview: trimmed ? trimmed.slice(0, 200) : '',
                        title: convo.isGroup ? (convo.title || 'Group') : null,
                        kind: convo.isGroup ? 'group' : 'dm',
                    },
                })
            )
        );

        // FIXED: Emit to conversation room instead of convo._id
        const io = getIO?.();
        if (io) {
            const roomName = conversationRoom(String(convo._id));
            io.to(roomName).emit('message:new', {
                conversationId: String(convo._id),
                message: { ...msg.toObject(), sender: { _id: String(me) } },
            });
        }

        res.status(201).json({ message: msg });
    } catch (e) {
        next(e);
    }
};

/** --------- POST /api/chats/conversations/:id/read */
exports.markRead = async (req, res, next) => {
    try {
        const me = asObjectId(req.user.id);
        const convo = await Conversation.findById(req.params.id);
        if (!convo || !(convo.participants || []).some((p) => String(p.user) === String(me)))
            return res.status(404).json({ message: 'Not found' });

        const now = new Date();
        await Conversation.updateOne(
            { _id: convo._id, 'participants.user': me },
            { $set: { 'participants.$.lastReadAt': now } }
        );
        await Message.updateMany(
            { conversation: convo._id, readBy: { $ne: me } },
            { $addToSet: { readBy: me } }
        );

        // FIXED: Emit to conversation room
        const io = getIO?.();
        if (io) {
            const roomName = conversationRoom(String(convo._id));
            io.to(roomName).emit('message:read', {
                conversationId: String(convo._id),
                userId: String(me),
                at: now
            });
        }

        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
};

// Keep all other existing exports unchanged...
exports.startDM = async (req, res, next) => {
    try {
        const { userId, initialMessage = '' } = req.body || {};
        if (!userId) return res.status(400).json({ message: 'userId required' });

        // Reuse createConversation in DM mode
        req.body = { isGroup: false, participantIds: [String(userId)], initialMessage };
        return exports.createConversation(req, res, next);
    } catch (e) {
        next(e);
    }
};

exports.createConversation = async (req, res, next) => {
    try {
        const me = asObjectId(req.user.id);
        const {
            participantIds = [],
            inviteUserIds = [],
            title = '',
            isGroup = false,
            initialMessage = '',
        } = req.body || {};

        if (!isGroup) {
            // DM branch — dedupe exact pair
            const unique = [...new Set([me.toString(), ...participantIds.map(String)])].map(asObjectId);
            if (unique.length !== 2) return res.status(400).json({ message: 'DM requires exactly 2 participants' });

            const existing = await Conversation.findOne({
                isGroup: false,
                'participants.user': { $all: unique },
                $expr: { $eq: [{ $size: '$participants' }, 2] },
            });

            let convo = existing;
            if (!convo) {
                convo = await Conversation.create({
                    isGroup: false,
                    title: '',
                    participants: unique.map((u) => ({
                        user: u,
                        role: String(u) === String(me) ? 'owner' : 'member',
                        status: 'member',
                        lastReadAt: new Date(),
                        acceptedAt: new Date(),
                    })),
                    lastMessageAt: new Date(),
                });
            }

            // Optional initial message
            const other = unique.find((id) => String(id) !== String(me));
            const trimmed = String(initialMessage || '').trim();
            if (trimmed) {
                const msg = await Message.create({
                    conversation: convo._id,
                    sender: me,
                    text: trimmed,
                    deliveredTo: [other],
                });
                await Conversation.updateOne({ _id: convo._id }, { $set: { lastMessageAt: new Date() } });

                await createNotifAndEmit({
                    recipientId: other,
                    actorId: me,
                    type: 'chat:message',
                    conversationId: convo._id,
                    messageId: msg._id,
                    meta: { preview: trimmed.slice(0, 200), kind: 'dm', title: null },
                });

                // FIXED: Emit to conversation room
                const io = getIO?.();
                if (io) {
                    const roomName = conversationRoom(String(convo._id));
                    io.to(roomName).emit('message:new', {
                        conversationId: String(convo._id),
                        message: { ...msg.toObject(), sender: { _id: String(me) } },
                    });
                }
            }

            return res.status(200).json({ conversation: convo });
        }

        // Group branch
        const convo = await Conversation.create({
            isGroup: true,
            title: title?.trim() || '',
            participants: [
                { user: me, role: 'owner', status: 'member', lastReadAt: new Date(), acceptedAt: new Date() },
            ],
            lastMessageAt: new Date(),
        });

        const toInvite = [...(inviteUserIds || []), ...(participantIds || [])]
            .map(String).filter((id) => id && id !== String(me));

        if (toInvite.length) {
            const now = new Date();
            const uniqueIds = [...new Set(toInvite)];
            for (const uid of uniqueIds) {
                if (convo.participants.some((p) => String(p.user) === uid)) continue;
                convo.participants.push({
                    user: asObjectId(uid),
                    role: 'member',
                    status: 'invited',
                    invitedBy: me,
                    invitedAt: now,
                    lastReadAt: new Date(0),
                });
            }
            await convo.save();

            await Promise.all(
                uniqueIds.map((uid) =>
                    createNotifAndEmit({
                        recipientId: asObjectId(uid),
                        actorId: me,
                        type: 'chat:invite',
                        conversationId: convo._id,
                        meta: { title: convo.title || 'Group', kind: 'group' },
                    })
                )
            );
        }

        return res.status(201).json({ conversation: convo });
    } catch (e) {
        next(e);
    }
};

exports.listMyConversations = async (req, res, next) => {
    try {
        const me = asObjectId(req.user.id);

        const items = await Conversation.find({ "participants.user": me })
            .sort({ lastMessageAt: -1 })
            .limit(100)
            .populate("participants.user", "name username avatarUrl")
            .lean();

        const convIds = items.map((i) => i._id);

        // lastReadAt map (per conversation)
        const lastReads = Object.fromEntries(
            items.map((i) => {
                const p = (i.participants || []).find(
                    (p) => String(p.user?._id || p.user) === String(me)
                );
                return [String(i._id), p?.lastReadAt || new Date(0)];
            })
        );

        // last message per conversation
        const lastAgg = await Message.aggregate([
            { $match: { conversation: { $in: convIds } } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: "$conversation", doc: { $first: "$$ROOT" } } },
        ]);
        const lastMap = Object.fromEntries(
            lastAgg.map((r) => [String(r._id), r.doc])
        );

        // unread counts (0 for invited)
        const unreadMap = {};
        for (const c of items) {
            const mePart = (c.participants || []).find(
                (p) => String(p.user?._id || p.user) === String(me)
            );
            if ((mePart?.status || "member") === "invited") {
                unreadMap[String(c._id)] = 0;
                continue;
            }
            const lastRead = lastReads[String(c._id)] || new Date(0);
            const unread = await Message.countDocuments({
                conversation: c._id,
                createdAt: { $gt: lastRead },
                deletedFor: { $ne: me },
            });
            unreadMap[String(c._id)] = unread;
        }

        // build and filter
        const conversations = items
            .map((i) => {
                const last = lastMap[String(i._id)];
                const lastMessage = last
                    ? {
                        _id: last._id,
                        text: last.text,
                        sender: last.sender,
                        createdAt: last.createdAt,
                    }
                    : null;
                return { ...i, lastMessage, unread: unreadMap[String(i._id)] || 0 };
            })
            .filter((c) => {
                // keep all groups, but only keep DMs if they have lastMessage
                if (c.isGroup) return true;
                return !!c.lastMessage;
            });

        res.json({ conversations });
    } catch (e) {
        next(e);
    }
};


exports.getConversation = async (req, res, next) => {
    try {
        const convo = await Conversation.findById(req.params.id)
            .populate('participants.user', 'name username avatarUrl')
            .lean();

        if (!convo) return res.status(404).json({ message: 'Not found' });

        const meId = String(req.user.id);
        const mine = (convo.participants || []).find((p) => String(p.user?._id || p.user) === meId);
        if (!mine) return res.status(403).json({ message: 'Forbidden' });

        return res.json({ conversation: convo });
    } catch (e) {
        next(e);
    }
};

exports.invite = async (req, res, next) => {
    try {
        const convo = await Conversation.findById(req.params.id);
        if (!convo) return res.status(404).json({ message: 'Not found' });

        const me = String(req.user.id);
        const meP = (convo.participants || []).find((p) => String(p.user) === me);
        if (!meP || (meP.status || 'member') !== 'member') return res.status(403).json({ message: 'Forbidden' });
        if (!convo.isGroup) return res.status(400).json({ message: 'Cannot invite into a DM' });

        const userIds = (req.body.userIds || []).map(String).filter(Boolean);
        const toAdd = [...new Set(userIds)].filter((uid) => !convo.participants.some((p) => String(p.user) === uid));
        if (!toAdd.length) return res.json({ ok: true });

        const now = new Date();
        convo.participants.push(
            ...toAdd.map((uid) => ({
                user: asObjectId(uid),
                status: 'invited',
                role: 'member',
                invitedBy: asObjectId(me),
                invitedAt: now,
                lastReadAt: new Date(0),
            }))
        );
        await convo.save();

        await Promise.all(
            toAdd.map((uid) =>
                createNotifAndEmit({
                    recipientId: asObjectId(uid),
                    actorId: asObjectId(me),
                    type: 'chat:invite',
                    conversationId: convo._id,
                    meta: { title: convo.title || 'Group', kind: 'group' },
                })
            )
        );

        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
};

exports.acceptInvite = async (req, res, next) => {
    try {
        const convo = await Conversation.findById(req.params.id);
        if (!convo) return res.status(404).json({ message: 'Not found' });

        const me = String(req.user.id);
        const p = (convo.participants || []).find((pp) => String(pp.user) === me);
        if (!p) return res.status(404).json({ message: 'Not invited' });

        if (p.status !== 'member') {
            p.status = 'member';
            p.acceptedAt = new Date();
            p.lastReadAt = new Date();
            await convo.save();

            const targets = new Set();
            if (p.invitedBy) targets.add(String(p.invitedBy));
            else (convo.participants || []).filter((x) => x.role === 'owner' && String(x.user) !== me).forEach((x) => targets.add(String(x.user)));

            await Promise.all(
                [...targets].map((uid) =>
                    createNotifAndEmit({
                        recipientId: asObjectId(uid),
                        actorId: asObjectId(me),
                        type: 'chat:accept',
                        conversationId: convo._id,
                        meta: { title: convo.title || 'Group', kind: 'group' },
                    })
                )
            );
        }

        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
};

exports.declineInvite = async (req, res, next) => {
    try {
        const convo = await Conversation.findById(req.params.id);
        if (!convo) return res.status(404).json({ message: 'Not found' });

        const me = String(req.user.id);
        const idx = (convo.participants || []).findIndex(
            (pp) => String(pp.user) === me && (pp.status || 'member') === 'invited'
        );
        if (idx < 0) return res.status(404).json({ message: 'Not invited' });

        const declined = convo.participants[idx];
        convo.participants.splice(idx, 1);
        await convo.save();

        const targets = new Set();
        if (declined.invitedBy) targets.add(String(declined.invitedBy));
        else (convo.participants || []).filter((x) => x.role === 'owner').forEach((x) => targets.add(String(x.user)));

        await Promise.all(
            [...targets].map((uid) =>
                createNotifAndEmit({
                    recipientId: asObjectId(uid),
                    actorId: asObjectId(me),
                    type: 'chat:decline',
                    conversationId: convo._id,
                    meta: { title: convo.title || 'Group', kind: 'group' },
                })
            )
        );

        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
};

exports.listMessages = async (req, res, next) => {
    try {
        const { cursor, limit = 30 } = req.query;
        const me = asObjectId(req.user.id);

        const convo = await Conversation.findById(req.params.id).select('_id participants');
        if (!convo) return res.status(404).json({ message: 'Not found' });

        const mePart = (convo.participants || []).find((p) => String(p.user) === String(me));
        if (!mePart) return res.status(403).json({ message: 'Forbidden' });
        if ((mePart.status || 'member') !== 'member') return res.status(403).json({ message: 'Accept the invite to view messages' });

        // newest-first in DB; client will render ascending
        const q = { conversation: convo._id, deletedFor: { $ne: me } };
        if (cursor) q.createdAt = { $lt: new Date(cursor) };

        const items = await Message.find(q)
            .sort({ createdAt: -1 })
            .limit(Math.min(100, Number(limit)))
            .populate('sender', 'name username avatarUrl')
            .lean();

        res.json({
            messages: items,
            nextCursor: items.length ? items[items.length - 1].createdAt : null,
        });
    } catch (e) {
        next(e);
    }
};

exports.softDeleteMessage = async (req, res, next) => {
    try {
        const me = asObjectId(req.user.id);
        const msg = await Message.findById(req.params.id);
        if (!msg) return res.status(404).json({ message: 'Not found' });

        const convo = await Conversation.findById(msg.conversation).select('participants');
        if (!convo || !(convo.participants || []).some((p) => String(p.user) === String(me)))
            return res.status(403).json({ message: 'Forbidden' });

        await Message.updateOne({ _id: msg._id }, { $addToSet: { deletedFor: me } });
        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
};