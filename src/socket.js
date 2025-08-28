// socket.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

function getCookieMap(cookieStr = '') {
    return cookieStr.split(';').reduce((m, part) => {
        const [k, v] = part.split('=');
        if (k && v) m[k.trim()] = decodeURIComponent(v.trim());
        return m;
    }, {});
}

function extractToken(socket) {
    const h = socket.handshake || {};
    const fromAuth = h.auth?.token;                           // client: io(url, { auth:{token} })
    const fromHeader = h.headers?.authorization;              // "Bearer <jwt>" or "<jwt>"
    const cookies = getCookieMap(h.headers?.cookie || '');
    const fromCookie = cookies.token || cookies.accessToken || cookies.jwt;

    const raw = fromAuth || fromHeader || fromCookie;
    if (!raw) return null;
    return raw.startsWith('Bearer ') ? raw.slice(7) : raw;     // strip 'Bearer '
}

function initSocket(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: ['http://localhost:5173', process.env.WEB_ORIGIN].filter(Boolean),
            credentials: true,
        },
        pingTimeout: 20000,
        pingInterval: 25000,
    });

    io.use((socket, next) => {
        try {
            const token = extractToken(socket);
            if (!token) return next(new Error('unauthorized'));

            const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
            const userId = String(payload.id || payload._id || payload.sub || '');
            if (!userId) return next(new Error('unauthorized'));

            socket.userId = userId;
            return next();
        } catch (err) {
            console.error('[socket] jwt verify failed:', err.message);
            return next(new Error('unauthorized'));
        }
    });

    io.on('connection', (socket) => {
        socket.join(socket.userId);
        console.log('[socket] connected', socket.userId);
        socket.on('disconnect', () => console.log('[socket] disconnected', socket.userId));
    });

    return io;
}

function getIO() {
    if (!io) throw new Error('Socket.io not initialized');
    return io;
}

module.exports = { initSocket, getIO };
