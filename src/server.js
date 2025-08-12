// src/server.js
require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app'); // your Express app setup (routes, middleware, etc.)

const PORT = process.env.PORT || 5000;

const {
  DATABASE_USER,
  DATABASE_PASSWORD,
  MONGO_URI,
} = process.env;

// Build MongoDB URI dynamically if not directly provided
let mongoUri;

if (MONGO_URI) {
  mongoUri = MONGO_URI;
} else if (DATABASE_USER && DATABASE_PASSWORD) {
  // Example assuming you want to connect to your default cluster and DB name
  mongoUri = `mongodb+srv://${encodeURIComponent(DATABASE_USER)}:${encodeURIComponent(DATABASE_PASSWORD)}@cluster0.f7hhyvb.mongodb.net/?retryWrites=true&w=majority`;
} else {
  console.error('❌ MongoDB connection info is missing from environment variables.');
  process.exit(1);
}

mongoose.set('strictQuery', true); // Avoid deprecation warnings

mongoose
  .connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔻 Shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled Promise Rejection:', err);
  process.exit(1);
});
