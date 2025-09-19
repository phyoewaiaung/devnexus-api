// socket.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Notification = require('./models/NotificationModel'); // <- add
let io = null;

/* Track online sockets per user */
const userSockets = new Map(); // userId -> Set<socketId>

/* -----------------------------
   Token helpers (cookie/header)
-------------------------------- */
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
        cookies.token || cookies.accessToken || cookies.jwt || cookies['access_token'];

    let raw = fromAuth || fromHeader || fromCookie;
    if (!raw) return null;
    if (typeof raw === 'string' && raw.startsWith('Bearer ')) raw = raw.slice(7);
    return typeof raw === 'string' && raw.length ? raw : null;
}

/* -----------------------------
   Auth middleware (JWT verify)
-------------------------------- */
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

        return next();
    } catch (err) {
        const msg =
            err.name === 'TokenExpiredError'
                ? 'Token expired'
                : err.name === 'JsonWebTokenError'
                    ? 'Invalid token'
                    : 'Authentication failed';
        return next(new Error(msg));
    }
}

/* -----------------------------
   Helpers
-------------------------------- */
function userRoom(userId) {
    return `user:${userId}`;
}

async function emitUnreadCount(userId) {
    try {
        const unread = await Notification.countDocuments({ recipient: userId, read: false });
        io.to(userRoom(userId)).emit('notification:count', { unread });
    } catch (e) {
        console.error('[socket] failed to emit unread count:', e?.message || e);
    }
}

/* Manage userSockets map */
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

/* Public helpers to inspect/emit */
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
    // rooms already group all sockets for that user
    io.to(userRoom(String(userId))).emit(event, payload);
}

function emitToUsers(userIds = [], event, payload) {
    const rooms = userIds.map((id) => userRoom(String(id)));
    if (rooms.length) io.to(rooms).emit(event, payload);
}

/* -----------------------------
   Init & basic lifecycle logs
-------------------------------- */
function initSocket(httpServer) {
    const allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:4173',
        process.env.WEB_ORIGIN,
        process.env.FRONTEND_URL,
        process.env.CLIENT_URL,
    ].filter(Boolean);

    io = new Server(httpServer, {
        cors: { origin: allowedOrigins, credentials: true, methods: ['GET', 'POST'] },
        path: '/socket.io/',
        serveClient: false,
    });

    io.use(authenticateSocket);

    io.on('connection', async (socket) => {
        const userId = socket.user?.id;
        if (userId) {
            socket.join(userRoom(userId));
            addUserSocket(userId, socket.id);
            console.log(`[socket] user ${userId} connected (socket ${socket.id}) — sockets:`, getUserSocketIds(userId).length);

            // initial unread count
            await emitUnreadCount(userId);

            // (optional) let clients know who is online
            io.emit('online:users', { users: getOnlineUserIds() });
        } else {
            console.warn('[socket] connected socket missing user');
        }

        socket.on('disconnect', (reason) => {
            if (userId) {
                removeUserSocket(userId, socket.id);
                console.log(`[socket] user ${userId} disconnected (${reason}) — remaining sockets:`, getUserSocketIds(userId).length);
                // (optional) broadcast online users update
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
    // new exports for online tracking / emitting
    getOnlineUserIds,
    getOnlineUserCount,
    getUserSocketIds,
    emitToUser,
    emitToUsers,
};
