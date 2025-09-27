// server.js
require('dotenv-flow').config();

const http = require('http');
const mongoose = require('mongoose');
const app = require('./app');
const { initSocket } = require('./socket');

const { parseOrigins } = require('./config/cors-origins');

const {
  PORT = 5000,
  MONGO_URI,
  NODE_ENV = 'development',
} = process.env;

if (!MONGO_URI) {
  console.error('❌ Missing MONGO_URI in environment');
  process.exit(1);
}

mongoose.set('strictQuery', true);

const mongoOpts = {
  autoIndex: NODE_ENV !== 'production',
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 15000,
};

(async () => {
  try {
    await mongoose.connect(MONGO_URI, mongoOpts);
    console.log('✅ Connected to MongoDB');

    const server = http.createServer(app);

    // Initialize Socket.IO; share the same allowlist
    const io = initSocket(server, {
      cors: {
        origin: parseOrigins(process.env.CORS_ORIGINS),
        credentials: true,
      },
    });
    app.set('io', io);

    server.listen(PORT, () =>
      console.log(`🚀 ${NODE_ENV} server listening on port ${PORT}`)
    );

    // Graceful shutdown
    const shutdown = async (sig) => {
      console.log(`\n⚠️  Received ${sig}, shutting down gracefully...`);
      try {
        await mongoose.connection.close();
        server.close(() => {
          console.log('✅ HTTP server closed');
          process.exit(0);
        });
        setTimeout(() => {
          console.warn('⏳ Forcing shutdown');
          process.exit(1);
        }, 10000).unref();
      } catch (err) {
        console.error('❌ Error during shutdown', err);
        process.exit(1);
      }
    };
    ['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));
  } catch (err) {
    console.error('❌ MongoDB connection error:', err?.message || err);
    process.exit(1);
  }
})();
