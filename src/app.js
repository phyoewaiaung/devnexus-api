const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const cors = require('cors'); // 

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', 'uploads'), {
    maxAge: '1y',
    etag: true,
    setHeaders(res) {
      // Allow images to be embedded across origins (UI on a different host)
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      // Optional nice-to-haves:
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  })
);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/', require('./routes/index'))
app.use('/api/users', require('./routes/UserRoutes'));
app.use('/api/posts', require('./routes/PostRoutes'));
app.use('/api/notifications', require('./routes/NotificationRoutes'));
app.use('/api/chats', require('./routes/ChatRoutes'));

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

module.exports = app;
