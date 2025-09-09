// socket.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;
const connectedUsers = new Map();

/**
 * Parse cookie string into a key-value map
 */
function getCookieMap(cookieStr = '') {
    return cookieStr.split(';').reduce((map, part) => {
        const [key, value] = part.split('=');
        if (key && value) {
            map[key.trim()] = decodeURIComponent(value.trim());
        }
        return map;
    }, {});
}

/**
 * Extract JWT token from various sources (auth, header, cookie)
 */
function extractToken(socket) {
    const handshake = socket.handshake || {};

    // Priority order: auth > header > cookie
    const fromAuth = handshake.auth?.token;
    const fromHeader = handshake.headers?.authorization;
    const cookies = getCookieMap(handshake.headers?.cookie || '');
    const fromCookie = cookies.token || cookies.accessToken || cookies.jwt;

    const rawToken = fromAuth || fromHeader || fromCookie;
    if (!rawToken) return null;

    // Handle "Bearer <token>" format
    return rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;
}

/**
 * Authenticate socket connection using JWT
 */
function authenticateSocket(socket, next) {
    try {
        const token = extractToken(socket);

        if (!token) {
            console.warn('[socket] No token provided for authentication');
            return next(new Error('Authentication token required'));
        }

        // Verify JWT token
        const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        const userId = String(payload.id || payload._id || payload.sub || '');

        if (!userId) {
            console.warn('[socket] Invalid token payload - missing user ID');
            return next(new Error('Invalid token payload'));
        }

        // Attach user info to socket
        socket.userId = userId;
        socket.userEmail = payload.email;
        socket.userRole = payload.role;

        return next();
    } catch (err) {
        console.error('[socket] JWT verification failed:', {
            error: err.message,
            socketId: socket.id,
            ip: socket.handshake.address
        });

        if (err.name === 'TokenExpiredError') {
            return next(new Error('Token expired'));
        } else if (err.name === 'JsonWebTokenError') {
            return next(new Error('Invalid token'));
        }

        return next(new Error('Authentication failed'));
    }
}

/**
 * Handle user connection
 */
function handleConnection(socket) {
    const { userId, userEmail, id: socketId } = socket;

    // Join user to their personal room
    socket.join(userId);

    // Track connected user
    connectedUsers.set(userId, {
        socketId,
        email: userEmail,
        connectedAt: new Date(),
        lastActivity: new Date()
    });

    console.log(`[socket] User connected:`, {
        userId,
        email: userEmail,
        socketId,
        totalUsers: connectedUsers.size
    });

    // Send welcome message
    socket.emit('connected', {
        message: 'Successfully connected to DevNexus',
        userId,
        connectedAt: new Date()
    });

    // Handle user activity tracking
    socket.on('user_activity', () => {
        const user = connectedUsers.get(userId);
        if (user) {
            user.lastActivity = new Date();
        }
    });

    // Handle joining specific rooms (e.g., post comments, groups)
    socket.on('join_room', (roomId) => {
        if (roomId && typeof roomId === 'string') {
            socket.join(roomId);
            console.log(`[socket] User ${userId} joined room: ${roomId}`);
            socket.emit('room_joined', { roomId });
        }
    });

    // Handle leaving specific rooms
    socket.on('leave_room', (roomId) => {
        if (roomId && typeof roomId === 'string') {
            socket.leave(roomId);
            console.log(`[socket] User ${userId} left room: ${roomId}`);
            socket.emit('room_left', { roomId });
        }
    });

    // Handle real-time messaging
    socket.on('send_message', (data) => {
        try {
            const { roomId, message, type = 'text' } = data;

            if (!roomId || !message) {
                return socket.emit('error', { message: 'Invalid message data' });
            }

            const messageData = {
                id: Date.now().toString(),
                userId,
                userEmail,
                message,
                type,
                timestamp: new Date(),
                roomId
            };

            // Send to all users in the room except sender
            socket.to(roomId).emit('new_message', messageData);

            // Confirm to sender
            socket.emit('message_sent', { messageId: messageData.id, roomId });

        } catch (err) {
            console.error('[socket] Message sending error:', err);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });

    // Handle typing indicators
    socket.on('typing_start', (roomId) => {
        if (roomId) {
            socket.to(roomId).emit('user_typing', { userId, userEmail, roomId });
        }
    });

    socket.on('typing_stop', (roomId) => {
        if (roomId) {
            socket.to(roomId).emit('user_stopped_typing', { userId, roomId });
        }
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
        connectedUsers.delete(userId);

        console.log(`[socket] User disconnected:`, {
            userId,
            email: userEmail,
            reason,
            socketId,
            remainingUsers: connectedUsers.size
        });

        // Notify other users if needed (for presence indicators)
        socket.broadcast.emit('user_offline', { userId, userEmail });
    });

    // Handle connection errors
    socket.on('error', (err) => {
        console.error(`[socket] Socket error for user ${userId}:`, err);
    });
}

/**
 * Initialize Socket.IO server
 */
function initSocket(httpServer) {
    const allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:4173',
        // Add mobile/network origins
        /^http:\/\/192\.168\.\d+\.\d+:5173$/,
        /^http:\/\/10\.\d+\.\d+\.\d+:5173$/,
        /^http:\/\/172\.16\.\d+\.\d+:5173$/,
        process.env.WEB_ORIGIN,
        process.env.FRONTEND_URL
    ].filter(Boolean);

    io = new Server(httpServer, {
        cors: {
            origin: allowedOrigins,
            credentials: true,
            methods: ['GET', 'POST']
        },
        // Connection settings
        pingTimeout: 60000,        // How long to wait for pong (60s)
        pingInterval: 25000,       // How often to send ping (25s)
        upgradeTimeout: 30000,     // How long to wait for upgrade (30s)
        maxHttpBufferSize: 1e6,    // 1MB max buffer size
        // Transports (WebSocket preferred, fallback to polling)
        transports: ['websocket', 'polling'],
        // Allow more connections for mobile testing
        allowEIO3: true
    });

    // Apply authentication middleware
    io.use(authenticateSocket);

    // Handle connections
    io.on('connection', handleConnection);

    // Handle server-level errors
    io.on('error', (err) => {
        console.error('[socket] Server error:', err);
    });

    console.log('[socket] Socket.IO server initialized with origins:', allowedOrigins);
    return io;
}

/**
 * Get the Socket.IO instance
 */
function getIO() {
    if (!io) {
        throw new Error('Socket.io not initialized. Call initSocket() first.');
    }
    return io;
}

/**
 * Get connected users info
 */
function getConnectedUsers() {
    return Array.from(connectedUsers.entries()).map(([userId, info]) => ({
        userId,
        ...info
    }));
}

/**
 * Check if user is online
 */
function isUserOnline(userId) {
    return connectedUsers.has(String(userId));
}

/**
 * Send notification to specific user
 */
function sendNotificationToUser(userId, notification) {
    if (!io) {
        console.warn('[socket] Cannot send notification - Socket.io not initialized');
        return false;
    }

    const userIdStr = String(userId);
    if (isUserOnline(userIdStr)) {
        io.to(userIdStr).emit('notification', notification);
        console.log(`[socket] Notification sent to user ${userIdStr}:`, notification.type);
        return true;
    }

    console.log(`[socket] User ${userIdStr} is offline - notification not sent`);
    return false;
}

/**
 * Broadcast to all connected users
 */
function broadcastToAll(event, data) {
    if (!io) {
        console.warn('[socket] Cannot broadcast - Socket.io not initialized');
        return;
    }

    io.emit(event, data);
    console.log(`[socket] Broadcasted ${event} to ${connectedUsers.size} users`);
}

/**
 * Send to specific room
 */
function sendToRoom(roomId, event, data) {
    if (!io) {
        console.warn('[socket] Cannot send to room - Socket.io not initialized');
        return;
    }

    io.to(roomId).emit(event, data);
    console.log(`[socket] Sent ${event} to room ${roomId}`);
}

module.exports = {
    initSocket,
    getIO,
    getConnectedUsers,
    isUserOnline,
    sendNotificationToUser,
    broadcastToAll,
    sendToRoom
};