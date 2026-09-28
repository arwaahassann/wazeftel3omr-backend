require('dotenv').config();
const mongoose = require('mongoose');

const ensureIndexes = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const indexes = [
    [mongoose.connection.collection('jobs'), { createdAt: -1, _id: -1 }, 'createdAt_-1__id_-1'],
    [mongoose.connection.collection('jobs'), { status: 1, createdAt: -1, _id: -1 }, 'status_1_createdAt_-1__id_-1'],
    [mongoose.connection.collection('users'), { createdAt: -1, _id: -1 }, 'createdAt_-1__id_-1'],
    [mongoose.connection.collection('applications'), { createdAt: -1, _id: -1 }, 'createdAt_-1__id_-1'],
    [mongoose.connection.collection('adminnotificationstates'), { admin: 1, isDeleted: 1, notificationKey: 1 }, 'admin_1_isDeleted_1_notificationKey_1'],
  ];

  await Promise.all(indexes.map(([collection, keys, name]) => (
    collection.createIndex(keys, { name })
  )));
  console.log('Admin production performance indexes are ready.');
};

ensureIndexes()
  .catch((error) => {
    console.error('Failed to create admin performance indexes:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
