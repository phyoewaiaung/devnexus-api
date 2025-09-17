// controllers/ChatsController.js
const Conversation = require('../models/ConversationModel');
const Message = require('../models/MessageModel');
const Notification = require('../models/NotificationModel'); // reuse for push/badge
const mongoose = require('mongoose');

const asObjectId = (v) => new mongoose.Types.ObjectId(String(v));

exports.createConversation = async (req, res, next) => {
    try {
        const { participantIds = [], title = '', isGroup = false } = req.body;
        const me = asObjectId(req.user.id);

        const unique = [...new Set([me.toString(), ...participantIds.map(String)])].map(asObjectId);
        if (unique.length < 2) return res.status(400).json({ message: 'Need at least 2 participants' });

        // prevent duplicate 1:1 threads
        if (!isGroup && unique.length === 2) {
            const existing = await Conversation.findOne({
                isGroup: false,
                'participants.user': { $all: unique },
                $expr: { $eq: [{ $size: '$participants' }, 2] }
            });
            if (existing) return res.json({ conversation: existing });
        }

        const conversation = await Conversation.create({
            isGroup,
            title: isGroup ? title : '',
            participants: unique.map(u => ({ user: u })),
        });
        res.status(201).json({ conversation });
    } catch (e) { next(e); }
};

exports.listMyConversations = async (req, res, next) => {
    try {
        const items = await Conversation.find({ 'participants.user': req.user.id })
            .sort({ lastMessageAt: -1 })
            .limit(100)
            .populate('participants.user', 'name username avatarUrl')
            .lean();

        // compute unread counts
        const convIds = items.map(i => i._id);
        const lastReads = Object.fromEntries(items.map(i => {
            const p = i.participants.find(p => String(p.user._id) === String(req.user.id));
            return [String(i._id), p?.lastReadAt || new Date(0)];
        }));
        const counts = await Message.aggregate([
            { $match: { conversation: { $in: convIds }, createdAt: { $exists: true } } },
            { $group: { _id: '$conversation', last: { $max: '$createdAt' }, total: { $sum: 1 } } }
        ]);

        const unreadMap = {};
        for (const c of counts) {
            const lastRead = lastReads[String(c._id)] || new Date(0);
            const unread = await Message.countDocuments({
                conversation: c._id,
                createdAt: { $gt: lastRead },
                deletedFor: { $ne: asObjectId(req.user.id) }
            });
            unreadMap[String(c._id)] = unread;
        }

        res.json({ conversations: items.map(i => ({ ...i, unread: unreadMap[String(i._id)] || 0 })) });
    } catch (e) { next(e); }
};

exports.getConversation = async (req, res, next) => {
    try {
        const c = await Conversation.findById(req.params.id)
            .populate('participants.user', 'name username avatarUrl');
        if (!c || !c.participants.some(p => String(p.user._id) === String(req.user.id)))
            return res.status(404).json({ message: 'Not found' });
        res.json({ conversation: c });
    } catch (e) { next(e); }
};

exports.listMessages = async (req, res, next) => {
    try {
        const { cursor, limit = 30 } = req.query; // descending by createdAt
        const convo = await Conversation.findById(req.params.id).select('_id participants');
        if (!convo || !convo.participants.some(p => String(p.user) === String(req.user.id)))
            return res.status(404).json({ message: 'Not found' });

        const q = { conversation: convo._id, deletedFor: { $ne: asObjectId(req.user.id) } };
        if (cursor) q.createdAt = { $lt: new Date(cursor) };

        const items = await Message.find(q)
            .sort({ createdAt: -1 })
            .limit(Math.min(100, Number(limit)))
            .populate('sender', 'name username avatarUrl')
            .lean();

        res.json({
            messages: items,
            nextCursor: items.length ? items[items.length - 1].createdAt : null
        });
    } catch (e) { next(e); }
};

exports.sendMessage = async (req, res, next) => {
    try {
        const { text = '', attachments = [] } = req.body;
        const convo = await Conversation.findById(req.params.id);
        if (!convo || !convo.participants.some(p => String(p.user) === String(req.user.id)))
            return res.status(404).json({ message: 'Not found' });

        const msg = await Message.create({
            conversation: convo._id,
            sender: req.user.id,
            text: text.trim(),
            attachments
        });

        convo.lastMessageAt = new Date();
        await convo.save();

        // optional: create notifications for other participants (badge counts / email)
        const others = convo.participants.filter(p => String(p.user) !== String(req.user.id)).map(p => p.user);
        await Notification.insertMany(others.map(u => ({
            recipient: u,
            actor: req.user.id,
            type: 'message',
            message: 'New message',
            meta: { conversationId: convo._id, messageId: msg._id },
        })));

        // emit via socket (see section 3)
        req.app.get('io')?.to(String(convo._id)).emit('message:new', {
            conversationId: String(convo._id),
            message: { ...msg.toObject(), sender: { _id: req.user.id } }
        });

        res.status(201).json({ message: msg });
    } catch (e) { next(e); }
};

exports.markRead = async (req, res, next) => {
    try {
        const convo = await Conversation.findById(req.params.id);
        if (!convo || !convo.participants.some(p => String(p.user) === String(req.user.id)))
            return res.status(404).json({ message: 'Not found' });

        // update lastReadAt and readBy on messages
        const now = new Date();
        await Conversation.updateOne(
            { _id: convo._id, 'participants.user': req.user.id },
            { $set: { 'participants.$.lastReadAt': now } }
        );
        await Message.updateMany(
            { conversation: convo._id, readBy: { $ne: req.user.id } },
            { $addToSet: { readBy: req.user.id } }
        );

        // socket signal
        req.app.get('io')?.to(String(convo._id)).emit('message:read', {
            conversationId: String(convo._id),
            userId: String(req.user.id),
            at: now
        });

        res.json({ ok: true });
    } catch (e) { next(e); }
};

exports.softDeleteMessage = async (req, res, next) => {
    try {
        const msg = await Message.findById(req.params.id);
        if (!msg) return res.status(404).json({ message: 'Not found' });

        // only participants of the conversation can mark delete
        const convo = await Conversation.findById(msg.conversation).select('participants');
        if (!convo.participants.some(p => String(p.user) === String(req.user.id)))
            return res.status(403).json({ message: 'Forbidden' });

        await Message.updateOne({ _id: msg._id }, { $addToSet: { deletedFor: req.user.id } });
        res.json({ ok: true });
    } catch (e) { next(e); }
};
