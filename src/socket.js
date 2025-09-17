// socket.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Conversation = require('./models/ConversationModel'); // ensure path
const Message = require('./models/MessageModel');           // ensure path

/* =========================
   Globals / Presence State
========================= */
let io;

// userId -> { sockets:Set<string>, email, firstConnectedAt:Date, lastActivity:Date }
const connectedUsers = new Map();
// userId -> Timeout
const offlineTimers = new Map();
const PRESENCE_GRACE_MS = 4000;

/* =========================
   Cookie & Token helpers
========================= */
function getCookieMap(cookieStr = '') {
    return cookieStr.split(';').reduce((map, part) => {
        const [k, ...rest] = part.split('=');
        if (!k || !rest.length) return map;
        map[k.trim()] = decodeURIComponent(rest.join('=').trim());
        return map;
    }, {});
}

function extractToken(socket) {
    const hs = socket.handshake || {};
    const fromAuth = hs.auth?.token;
    const fromHeader = hs.headers?.authorization;
    const cookies = getCookieMap(hs.headers?.cookie || '');
    const fromCookie = cookies.token || cookies.accessToken || cookies.jwt || cookies['access_token'];
    const raw = fromAuth || fromHeader || fromCookie;
    if (!raw) return null;
    return raw.startsWith('Bearer ') ? raw.slice(7) : raw;
}

/* =========================
   Auth middleware
========================= */
function authenticateSocket(socket, next) {
    try {
        const token = extractToken(socket);
        if (!token) return next(new Error('Authentication token required'));

        const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        const userId = String(payload.id || payload._id || payload.sub || '');
        if (!userId) return next(new Error('Invalid token payload'));

        socket.user = {
            id: userId,
            email: payload.email || '',
            username: payload.username || '',
            roles: payload.roles || [],
        };
        return next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') return next(new Error('Token expired'));
        if (err.name === 'JsonWebTokenError') return next(new Error('Invalid token'));
        return next(new Error('Authentication failed'));
    }
}

/* =========================
   Room / Membership utils
========================= */
const asId = (v) => new mongoose.Types.ObjectId(String(v));

async function userIsInConversation(userId, conversationId) {
    if (!mongoose.isValidObjectId(conversationId)) return false;
    const c = await Conversation.exists({
        _id: conversationId,
        'participants.user': asId(userId),
    });
    return !!c;
}

async function joinAllUserConversations(socket) {
    const convs = await Conversation.find({ 'participants.user': socket.user.id }).select('_id');
    convs.forEach((c) => socket.join(String(c._id)));
}

/* =========================
   Simple rate limiter
========================= */
// token bucket: 1 msg / 500ms, burst 5
const rateState = new Map();
const MSG_INTERVAL_MS = 500;
const MSG_BURST = 5;

function canSendMessage(userId) {
    const now = Date.now();
    const s = rateState.get(userId) || { tokens: MSG_BURST, last: now };
    const delta = now - s.last;
    const refill = Math.floor(delta / MSG_INTERVAL_MS);
    if (refill > 0) {
        s.tokens = Math.min(MSG_BURST, s.tokens + refill);
        s.last = now;
    }
    if (s.tokens <= 0) {
        rateState.set(userId, s);
        return false;
    }
    s.tokens -= 1;
    rateState.set(userId, s);
    return true;
}

/* =========================
   Connection handler
========================= */
function handleConnection(socket) {
    const { id: socketId } = socket;
    const { id: userId, email } = socket.user;

    // Personal room for direct emits (notifications/presence)
    socket.join(userId);

    // Ensure presence entry with Set of sockets
    let entry = connectedUsers.get(userId);
    if (!entry) {
        entry = { sockets: new Set(), email, firstConnectedAt: new Date(), lastActivity: new Date() };
        connectedUsers.set(userId, entry);
    }
    entry.sockets.add(socketId);
    entry.email = email;
    entry.lastActivity = new Date();

    // Cancel any pending offline broadcast for this user
    if (offlineTimers.has(userId)) {
        clearTimeout(offlineTimers.get(userId));
        offlineTimers.delete(userId);
    }

    // Auto-join all conversation rooms for this user
    joinAllUserConversations(socket).catch((e) =>
        console.error('[socket] joinAllUserConversations error:', e.message)
    );

    const firstConnection = entry.sockets.size === 1;
    if (firstConnection) {
        socket.broadcast.emit('presence:update', { userId, online: true });
    }

    console.log('[socket] User connected', { userId, socketId, totalUsers: connectedUsers.size });

    // Ack + presence snapshot to the connecting client
    socket.emit('connected', { message: 'Connected', userId, at: new Date() });
    socket.emit('presence:state', { onlineUserIds: Array.from(connectedUsers.keys()) });

    /* -------- Activity ping -------- */
    socket.on('user_activity', () => {
        const u = connectedUsers.get(userId);
        if (u) u.lastActivity = new Date();
    });

    /* -------- Room join/leave (generic) -------- */
    socket.on('join_room', async (roomId) => {
        try {
            if (!roomId || typeof roomId !== 'string') return;
            if (mongoose.isValidObjectId(roomId)) {
                const ok = await userIsInConversation(userId, roomId);
                if (!ok) return socket.emit('error', { message: 'Forbidden: not a participant' });
            }
            socket.join(roomId);
            socket.emit('room_joined', { roomId });
        } catch (e) {
            console.error('[socket] join_room error:', e);
            socket.emit('error', { message: 'Failed to join room' });
        }
    });

    socket.on('leave_room', (roomId) => {
        if (roomId && typeof roomId === 'string') {
            socket.leave(roomId);
            socket.emit('room_left', { roomId });
        }
    });

    /* -------- Chat events (conversation-scoped) -------- */
    socket.on('chat:send', async (payload, cb) => {
        try {
            const { conversationId, text = '', attachments = [] } = payload || {};
            if (!conversationId || (!text && !attachments?.length)) {
                return cb?.({ ok: false, error: 'Invalid payload' });
            }
            if (!canSendMessage(userId)) {
                return cb?.({ ok: false, error: 'Rate limited. Slow down.' });
            }
            const isMember = await userIsInConversation(userId, conversationId);
            if (!isMember) return cb?.({ ok: false, error: 'Forbidden' });

            const msg = await Message.create({
                conversation: conversationId,
                sender: userId,
                text: String(text).trim(),
                attachments,
            });

            await Conversation.updateOne(
                { _id: conversationId },
                { $set: { lastMessageAt: new Date() } }
            );

            const msgObj = {
                ...msg.toObject(),
                sender: { _id: userId, email }, // light sender
            };

            const payloadOut = { conversationId, message: msgObj };

            // Emit to everyone in room (including sender) to avoid "missing own message"
            io.to(String(conversationId)).emit('message:new', payloadOut);

            cb?.({ ok: true, messageId: String(msg._id) });
        } catch (e) {
            console.error('[socket] chat:send error', e);
            cb?.({ ok: false, error: 'Failed to send' });
        }
    });

    socket.on('chat:typing', async ({ conversationId, isTyping }) => {
        try {
            if (!conversationId) return;
            const isMember = await userIsInConversation(userId, conversationId);
            if (!isMember) return;
            socket.to(String(conversationId)).emit('typing', { conversationId, userId, isTyping: !!isTyping });
        } catch (e) {
            console.error('[socket] chat:typing error', e);
        }
    });

    socket.on('chat:read', async ({ conversationId }) => {
        try {
            if (!conversationId) return;
            const isMember = await userIsInConversation(userId, conversationId);
            if (!isMember) return;

            const now = new Date();
            await Conversation.updateOne(
                { _id: conversationId, 'participants.user': asId(userId) },
                { $set: { 'participants.$.lastReadAt': now } }
            );
            await Message.updateMany(
                { conversation: conversationId, readBy: { $ne: asId(userId) } },
                { $addToSet: { readBy: asId(userId) } }
            );

            socket.to(String(conversationId)).emit('message:read', { conversationId, userId, at: now });
        } catch (e) {
            console.error('[socket] chat:read error', e);
        }
    });

    socket.on('chat:joinAll', async (cb) => {
        try {
            await joinAllUserConversations(socket);
            cb?.({ ok: true });
        } catch (e) {
            cb?.({ ok: false, error: e.message });
        }
    });

    /* -------- Backward-compatible generic messaging -------- */
    socket.on('send_message', (data) => {
        try {
            const { roomId, message, type = 'text' } = data || {};
            if (!roomId || !message) return socket.emit('error', { message: 'Invalid message data' });

            const payload = {
                id: Date.now().toString(),
                userId,
                userEmail: email,
                message,
                type,
                timestamp: new Date(),
                roomId,
            };
            socket.to(roomId).emit('new_message', payload);
            socket.emit('message_sent', { messageId: payload.id, roomId });
        } catch (err) {
            console.error('[socket] send_message error:', err);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });

    /* -------- Presence: disconnect (multi-socket safe with grace) -------- */
    socket.on('disconnect', (reason) => {
        const entry = connectedUsers.get(userId);

        if (entry && entry.sockets instanceof Set) {
            entry.sockets.delete(socketId);
            entry.lastActivity = new Date();

            if (entry.sockets.size === 0) {
                // Delay offline in case of quick reconnect
                const t = setTimeout(() => {
                    const latest = connectedUsers.get(userId);
                    if (!latest || latest.sockets.size === 0) {
                        connectedUsers.delete(userId);
                        socket.broadcast.emit('presence:update', { userId, online: false });
                    }
                    offlineTimers.delete(userId);
                }, PRESENCE_GRACE_MS);
                offlineTimers.set(userId, t);
            }
        }

        console.log('[socket] User disconnected', {
            userId, reason, socketId,
            remainingSockets: entry?.sockets?.size || 0,
            distinctUsers: connectedUsers.size
        });
    });

    socket.on('error', (err) => {
        console.error(`[socket] Socket error for user ${userId}:`, err);
    });
}

/* =========================
   Init & Utilities
========================= */
function initSocket(httpServer) {
    const allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:4173',
        /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
        /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
        /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+:\d+$/,
        process.env.WEB_ORIGIN,
        process.env.FRONTEND_URL,
    ].filter(Boolean);

    io = new Server(httpServer, {
        cors: { origin: allowedOrigins, credentials: true, methods: ['GET', 'POST'] },
        pingTimeout: 60000,
        pingInterval: 25000,
        upgradeTimeout: 30000,
        maxHttpBufferSize: 1e6,
        transports: ['websocket', 'polling'],
        allowEIO3: true,
    });

    io.use(authenticateSocket);
    io.on('connection', handleConnection);
    io.on('error', (err) => console.error('[socket] Server error:', err));

    console.log('[socket] Socket.IO initialized with allowed origins:', allowedOrigins);
    return io;
}

function getIO() {
    if (!io) throw new Error('Socket.io not initialized. Call initSocket() first.');
    return io;
}

function getConnectedUsers() {
    return Array.from(connectedUsers.entries()).map(([userId, info]) => ({
        userId,
        sockets: Array.from(info.sockets || []),
        email: info.email,
        firstConnectedAt: info.firstConnectedAt,
        lastActivity: info.lastActivity,
    }));
}

function isUserOnline(userId) {
    const e = connectedUsers.get(String(userId));
    return !!e && e.sockets && e.sockets.size > 0;
}

function sendNotificationToUser(userId, notification) {
    if (!io) return false;
    const id = String(userId);
    if (isUserOnline(id)) {
        io.to(id).emit('notification', notification);
        return true;
    }
    return false;
}

function broadcastToAll(event, data) {
    if (!io) return;
    io.emit(event, data);
}

function sendToRoom(roomId, event, data) {
    if (!io) return;
    io.to(String(roomId)).emit(event, data);
}

module.exports = {
    initSocket,
    getIO,
    getConnectedUsers,
    isUserOnline,
    sendNotificationToUser,
    broadcastToAll,
    sendToRoom,
};
