const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const cors = require('cors'); // ✅ import cors

const app = express();

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://devnexus-ui-1hrz.vercel.app',
  ],
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/users', require('./routes/UserRoutes'));
app.use('/api/posts', require('./routes/PostRoutes'));
app.use('/api/notifications', require('./routes/NotificationRoutes'));

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

module.exports = app;
