const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cookieParser());

// Serve /uploads/* publicly (e.g. http://localhost:5000/uploads/avatars/xxx.png)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/users', require('./routes/UserRoutes'));
app.use('/api/posts', require('./routes/PostRoutes'));
app.use('/api/notifications', require('./routes/NotificationRoutes'));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

module.exports = app;
