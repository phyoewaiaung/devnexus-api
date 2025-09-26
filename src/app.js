// app.js
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

const app = express();

const {
  NODE_ENV = 'development',
  TRUST_PROXY = '0',
  CORS_ORIGINS,                 // comma-separated list
  UPLOADS_DIR = 'uploads',
  FRONTEND_DIST,                // optional path to built SPA (e.g., ./client/dist)
} = process.env;

// Trust proxy in production (Render/Railway/Nginx etc.)
app.set('trust proxy', TRUST_PROXY === '1');

if (NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// CORS — allow list from env (comma separated)
const allowList = parseOrigins(CORS_ORIGINS);
app.use(
  cors({
    origin: allowList || true, // if no env set, allow all (dev)
    credentials: true,
  })
);

// Basic rate limit for /api
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Static: /uploads (long cache)
app.use(
  '/uploads',
  express.static(path.resolve(__dirname, '..', UPLOADS_DIR), {
    maxAge: '1y',
    etag: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  })
);

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true, env: NODE_ENV }));

// API routes
app.use('/api/', require('./routes/index'));
app.use('/api/users', require('./routes/UserRoutes'));
app.use('/api/posts', require('./routes/PostRoutes'));
app.use('/api/notifications', require('./routes/NotificationRoutes'));
app.use('/api/chats', require('./routes/ChatRoutes'));

// OPTIONAL: Serve built SPA if FRONTEND_DIST is set
if (FRONTEND_DIST) {
  const distPath = path.resolve(FRONTEND_DIST);
  app.use(express.static(distPath));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Centralized error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || 'Server error',
    ...(NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

module.exports = app;

function parseOrigins(csv) {
  if (!csv) return null;
  const list = csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return null;

  // Return function for dynamic check per request Origin
  return function originFn(origin, cb) {
    if (!origin) return cb(null, true); // same-origin or non-browser
    if (list.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  };
}
