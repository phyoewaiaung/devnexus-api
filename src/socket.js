// socket.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Notification = require('./models/NotificationModel');
const Conversation = require('./models/ConversationModel');

let io = null;

/* Track online sockets per user */
const userSockets = new Map(); // userId -> Set<socketId>

/* -----------------------------
   Cookie / token helpers
------------------------------ */
function getCookieMap(cookieStr = '') {
    return cookieStr
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean)
        .reduce((acc, part) => {
            const [k, ...rest] = part.split('=');
            if (!k || !rest.length) return acc;
            acc[k] = decodeURIComponent(rest.join('=').trim());
            return acc;
        }, {});
}

function extractToken(socket) {
    const hs = socket.handshake || {};
    const fromAuth = hs.auth?.token;
    const fromHeader = hs.headers?.authorization;
    const cookies = getCookieMap(hs.headers?.cookie || '');
    const fromCookie =
        cookies.token ||
        cookies.accessToken ||
        cookies.jwt ||
        cookies['access_token'];

    let raw = fromAuth || fromHeader || fromCookie;
    if (!raw) return null;
    if (typeof raw === 'string' && raw.startsWith('Bearer ')) raw = raw.slice(7);
    return typeof raw === 'string' && raw.length ? raw : null;
}

/* -----------------------------
   Auth middleware (JWT verify)
------------------------------ */
function authenticateSocket(socket, next) {
    try {
        const token = extractToken(socket);
        if (!token) return next(new Error('Authentication token required'));

        const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
        if (!secret) return next(new Error('Server misconfigured: missing JWT secret'));

        const payload = jwt.verify(token, secret);
        const userId = String(payload.id || payload._id || payload.sub || payload.userId || '');
        if (!userId) return next(new Error('Invalid token payload'));

        socket.user = {
            id: userId,
            email: payload.email || '',
            name: payload.username || payload.name || '',
            roles: payload.roles || [],
        };

        next();
    } catch (err) {
        const msg =
            err.name === 'TokenExpiredError' ? 'Token expired' :
                err.name === 'JsonWebTokenError' ? 'Invalid token' :
                    'Authentication failed';
        next(new Error(msg));
    }
}

/* -----------------------------
   Rooms & helpers
------------------------------ */
function userRoom(userId) {
    return `user:${userId}`;
}

function conversationRoom(conversationId) {
    return `conversation:${conversationId}`;
}

async function emitUnreadCount(userId) {
    try {
        const unread = await Notification.countDocuments({ recipient: userId, read: false });
        io.to(userRoom(userId)).emit('notification:count', { unread });
    } catch (e) {
        console.error('[socket] failed to emit unread count:', e?.message || e);
    }
}

function addUserSocket(userId, socketId) {
    let set = userSockets.get(userId);
    if (!set) {
        set = new Set();
        userSockets.set(userId, set);
    }
    set.add(socketId);
}

function removeUserSocket(userId, socketId) {
    const set = userSockets.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) userSockets.delete(userId);
}

/* Public helpers */
function getOnlineUserIds() {
    return Array.from(userSockets.keys());
}
function getOnlineUserCount() {
    return userSockets.size;
}
function getUserSocketIds(userId) {
    return Array.from(userSockets.get(String(userId)) || []);
}
function emitToUser(userId, event, payload) {
    io.to(userRoom(String(userId))).emit(event, payload);
}
function emitToUsers(userIds = [], event, payload) {
    const rooms = userIds.map((id) => userRoom(String(id)));
    if (rooms.length) io.to(rooms).emit(event, payload);
}

/* Join all conversation rooms for a user */
async function joinUserConversations(socket, userId) {
    try {
        const conversations = await Conversation.find({
            'participants.user': userId,
            'participants.status': 'member',
        }).select('_id').lean();

        for (const conv of conversations) {
            const roomName = conversationRoom(String(conv._id));
            socket.join(roomName);
        }
    } catch (error) {
        console.error('[socket] failed to join user conversations:', error);
    }
}

/* -----------------------------
   Origin allowlist
------------------------------ */
function parseOriginsFromEnv() {
    const csv = process.env.CORS_ORIGINS;
    const envList = csv ? csv.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const legacy = [
        process.env.WEB_ORIGIN,
        process.env.FRONTEND_URL,
        process.env.CLIENT_URL,
        'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:4173',
    ].filter(Boolean);
    const set = new Set([...envList, ...legacy]);
    const arr = Array.from(set);
    return arr.length ? arr : true; // dev fallback
}

/* -----------------------------
   Init
------------------------------ */
function initSocket(httpServer, options = {}) {
    const allowedOrigins = parseOriginsFromEnv();

    io = new Server(httpServer, {
        path: options.path || '/socket.io/',
        serveClient: false,
        cors: {
            origin: options.cors?.origin ?? allowedOrigins,
            credentials: options.cors?.credentials ?? true,
            methods: options.cors?.methods ?? ['GET', 'POST'],
        },
        transports: options.transports || ['websocket', 'polling'],
        pingTimeout: options.pingTimeout || 20000,
        pingInterval: options.pingInterval || 25000,
        connectionStateRecovery: options.connectionStateRecovery ?? {
            maxDisconnectionDuration: 2 * 60 * 1000,
            skipMiddlewares: false,
        },
    });

    io.use(authenticateSocket);

    io.on('connection', async (socket) => {
        const userId = socket.user?.id;

        if (userId) {
            socket.join(userRoom(userId));
            addUserSocket(userId, socket.id);
            console.log(
                `[socket] user ${userId} connected (${socket.id}); sockets: ${getUserSocketIds(userId).length}`
            );

            await joinUserConversations(socket, userId);
            await emitUnreadCount(userId);

            io.emit('online:users', { users: getOnlineUserIds() });

            socket.on('chat:join', ({ conversationId }) => {
                if (!conversationId) return;
                const roomName = conversationRoom(String(conversationId));
                socket.join(roomName);
            });

            socket.on('chat:typing', ({ conversationId, isTyping }) => {
                if (!conversationId) return;
                const roomName = conversationRoom(String(conversationId));
                socket.to(roomName).emit('chat:typing', {
                    conversationId: String(conversationId),
                    userId: String(userId), // app user id (not socket id)
                    isTyping: !!isTyping,
                });
            });
        } else {
            console.warn('[socket] connected socket missing user');
        }

        socket.on('disconnect', (reason) => {
            if (userId) {
                removeUserSocket(userId, socket.id);
                console.log(
                    `[socket] user ${userId} disconnected (${reason}); remaining: ${getUserSocketIds(userId).length}`
                );
                io.emit('online:users', { users: getOnlineUserIds() });
            } else {
                console.log(`[socket] anonymous socket disconnected: ${reason}`);
            }
        });
    });

    io.on('error', (err) => {
        console.error('[socket] server error:', err?.message || err);
    });

    console.log('[socket] Socket.IO initialized');
    return io;
}

function getIO() {
    if (!io) throw new Error('Socket.io not initialized. Call initSocket() first.');
    return io;
}

module.exports = {
    initSocket,
    getIO,
    emitUnreadCount,
    userRoom,
    conversationRoom,
    getOnlineUserIds,
    getOnlineUserCount,
    getUserSocketIds,
    emitToUser,
    emitToUsers,
};
