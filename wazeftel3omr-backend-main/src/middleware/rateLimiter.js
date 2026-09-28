const rateLimit = require('express-rate-limit');

const isLocal = () => !process.env.VERCEL;

const skipLocalAndAdmin = (req) => {
  if (isLocal()) return true;
  const path = req.path || '';
  return path.startsWith('/admin');
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: {
    success: false,
    message: 'لقد تجاوزت عدد المحاولات المسموح بها! يرجى المحاولة بعد 15 دقيقة.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isLocal,
});

// حد لكل مستخدم/IP على القراءة — يكفي تصفح المنصة بدون ما يوقف الناس
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  message: {
    success: false,
    message: 'عدد الطلبات كبير جداً، يرجى المحاولة لاحقاً.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipLocalAndAdmin,
});

// حد أضيق على الكتابة فقط (نشر وظيفة، تقديم، تعليق حساب...)
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 250,
  message: {
    success: false,
    message: 'عدد العمليات كبير حالياً، يرجى المحاولة بعد قليل.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => skipLocalAndAdmin(req) || ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
});

module.exports = {
  authLimiter,
  apiLimiter,
  writeLimiter,
};
