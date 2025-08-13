require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/UsersModel');

async function seedDefaultUser() {
  const { DATABASE_USER, DATABASE_PASSWORD, MONGO_URI } = process.env;
  let mongoUri;

  if (MONGO_URI) {
    mongoUri = MONGO_URI;
  } else if (DATABASE_USER && DATABASE_PASSWORD) {
    mongoUri = `mongodb+srv://${encodeURIComponent(DATABASE_USER)}:${encodeURIComponent(DATABASE_PASSWORD)}@cluster0.f7hhyvb.mongodb.net/?retryWrites=true&w=majority`;
  } else {
    console.error('\u274c MongoDB connection info is missing from environment variables.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
  });

  try {
    const email = 'admin@example.com';
    const existing = await User.findOne({ email });

    if (existing) {
      console.log('Default user already exists');
    } else {
      const user = new User({
        name: 'Admin User',
        username: 'admin',
        email,
        passwordHash: 'password123',
        roles: ['admin'],
      });
      await user.save();
      console.log('Default user created');
    }
  } catch (err) {
    console.error('Seed error:', err);
  } finally {
    await mongoose.connection.close();
  }
}

seedDefaultUser();
