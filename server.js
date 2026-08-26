const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const hpp = require('hpp');
const connectDB = require('./src/config/db');
const errorHandler = require('./src/middleware/errorMiddleware');

// 1. تحميل متغيرات البيئة من .env
dotenv.config();

// 2. الاتصال بقاعدة البيانات MongoDB
connectDB();

// 🔒 دالة تطهير مدخلات NoSQL المخصصة والمتوافقة مع Express 5
const sanitizeNoSQL = (obj) => {
  if (obj && typeof obj === 'object') {
    for (const key in obj) {
      if (/^\$/.test(key)) {
        delete obj[key];
      } else {
        sanitizeNoSQL(obj[key]);
      }
    }
  }
};

const mongoSanitizer = (req, res, next) => {
  if (req.body) sanitizeNoSQL(req.body);
  if (req.params) sanitizeNoSQL(req.params);
  next();
};

const app = express();

// 🔒 3. طبقات الحماية وتأمين الـ HTTP Headers
app.use(helmet()); // حماية الـ HTTP Headers
app.use(hpp()); // حماية ضد HTTP Parameter Pollution

// 🔒 4. ضبط CORS لمنع وصول المواقع الخبيثة ودعم دومينات Vercel تلقائياً
app.use(
  cors({
    origin: (origin, callback) => {
      // السماح بالطلبات التي ليس لها origin (مثل أدوات الفحص) أو أي نطاق vercel أو localhost
      if (!origin || origin.includes('localhost') || origin.includes('vercel.app') || origin === process.env.CLIENT_URL) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
  })
);

// ضمان الاتصال بقاعدة البيانات قبل معالجة أي مسار (خاص بـ Serverless)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

// 5. Body Parsers & Sanitization (زيادة السعة إلى 20MB لدعم رفع ملفات السيرة الذاتية والصور)
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(mongoSanitizer); // حماية ضد NoSQL Injection

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// 6. استيراد المسارات الرئيسية
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const jobRoutes = require('./src/routes/jobRoutes');
const applicationRoutes = require('./src/routes/applicationRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');

// 📌 SHARED & LEGACY PUBLIC ROUTES
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/notifications', notificationRoutes);

// 👤 JOB SEEKER NAMESPACED ROUTES
app.use('/api/seeker/profile', userRoutes);
app.use('/api/seeker/applications', applicationRoutes);
app.use('/api/seeker/notifications', notificationRoutes);

// 🏢 EMPLOYER NAMESPACED ROUTES
app.use('/api/employer/jobs', jobRoutes);
app.use('/api/employer/applicants', applicationRoutes);

// 🤖 AI SERVICE ROUTES
app.use('/api/ai', require('./src/routes/aiRoutes'));

// 💬 DIRECT MESSAGING ROUTES
app.use('/api/messages', require('./src/routes/messageRoutes'));

// 7. المسار الرئيسي لاختبار السيرفر
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🚀 Wazeft El3omr Backend API is running securely on Vercel...',
    timestamp: new Date().toISOString(),
  });
});

// 🔒 8. معالج الأخطاء المركزي (يجب أن يكون في النهاية بعد كل المسارات)
app.use(errorHandler);

// تصدير التطبيق لدعم Vercel Serverless Functions
module.exports = app;

// تشغيل السيرفر المحلي في حال عدم العمل على Vercel
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });
}
