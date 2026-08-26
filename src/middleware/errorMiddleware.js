// 🛡️ معالج الأخطاء المركزي المتقدم لتطبيقات Production
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  console.error('❌ Error Logged:', err);

  // 1. Mongoose Bad ObjectId (CastError)
  if (err.name === 'CastError') {
    const message = 'المعرف (ID) المطلوب غير صالح أو غير موجود';
    return res.status(404).json({ success: false, message });
  }

  // 2. Mongoose Duplicate Key (11000)
  if (err.code === 11000) {
    const message = 'البيانات المدخلة مكررة وموجودة بالفعل بالسيستم';
    return res.status(400).json({ success: false, message });
  }

  // 3. Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((val) => val.message).join(' - ');
    return res.status(400).json({ success: false, message });
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'حدث خطأ غير متوقع في الخادم!',
    // إخفاء الـ Stack Trace في بيئة الإنتاج لعدم كشف تفاصيل الأكواد
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};

module.exports = errorHandler;
