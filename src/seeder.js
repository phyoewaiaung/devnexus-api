require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/UsersModel');

const MONGO_URI = process.env.MONGO_URI;

(async () => {
  if (!MONGO_URI) {
    console.error('Missing MONGO_URI in .env');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
  const username = (process.env.DEFAULT_ADMIN_USERNAME || 'admin').toLowerCase();
  const name = process.env.DEFAULT_ADMIN_NAME || 'Admin';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin1234';

  let user = await User.findOne({ $or: [{ email }, { username }] });

  if (!user) {
    user = new User({
      name,
      email: email.toLowerCase(),
      username,
      passwordHash: password,
      roles: ['admin'],
      bio: 'Admin',
    });
    await user.save();
    console.log('Default admin created.');
  } else {
    user.passwordHash = password; // will be hashed
    await user.save();
    console.log('Default admin password reset.');
  }

  console.log('--- Admin Credentials ---');
  console.log(`Email:    ${email}`);
  console.log(`Username: ${username}`);
  console.log(`Password: ${password}`);
  console.log('-------------------------');

  await mongoose.connection.close();
  console.log('Done.');
})().catch(async (e) => {
  console.error(e);
  await mongoose.connection.close();
  process.exit(1);
});
