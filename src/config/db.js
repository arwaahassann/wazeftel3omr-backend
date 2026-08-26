const mongoose = require('mongoose');

let cachedPromise = null;

// دالة الاتصال بقاعدة البيانات MongoDB المتوافقة 100% مع Vercel Serverless
const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) {
    return mongoose.connection;
  }

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  if (!cachedPromise) {
    const opts = {
      bufferCommands: false, // إيقاف الانتظار الطويل في حال عدم استجابة السيرفر
      serverSelectionTimeoutMS: 5000,
    };
    cachedPromise = mongoose.connect(process.env.MONGO_URI, opts).then((m) => {
      console.log('✅ MongoDB Connected to Atlas');
      return m;
    });
  }

  try {
    await cachedPromise;
  } catch (e) {
    cachedPromise = null;
    throw e;
  }
};

module.exports = connectDB;
