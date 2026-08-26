const rateLimit = require('express-rate-limit');

// 🛡️ حماية عمليات الدخول والتسجيل من هجمات التخمين (Brute Force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // نافذة زمنية مدتها 15 دقيقة
  max: 5, // الحد الأقصى 5 محاولات من نفس العنوان (IP) خلال النافذة
  message: {
    success: false,
    message: 'لقد تجاوزت عدد المحاولات المسموح بها! يرجى المحاولة بعد 15 دقيقة.',
  },
  standardHeaders: true, // إرجاع معلومات الحدود في الـ Headers
  legacyHeaders: false,
});

// 🛡️ محدد عام لجميع الـ APIs لحماية السيرفر من هجمات الإغراق (DDoS)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // 100 طلب كحد أقصى لكل IP خلال 15 دقيقة
  message: {
    success: false,
    message: 'عدد الطلبات كبير جداً، يرجى المحاولة لاحقاً.',
  },
});

module.exports = {
  authLimiter,
  apiLimiter,
};
