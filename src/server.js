require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');                // ✅ add
const app = require('./app');
const { initSocket } = require('./socket');  // ✅ add

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('Missing MONGO_URI in .env');
  process.exit(1);
}

mongoose.set('strictQuery', true);

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    const server = http.createServer(app);   // ✅ wrap express
    initSocket(server);                      // ✅ init io
    server.listen(PORT, () => console.log(`Server http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
