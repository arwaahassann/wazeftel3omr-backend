// 🛡️ معالج الأخطاء المركزي المتقدم لتطبيقات Production
const errorHandler = (err, req, res, next) => {
  console.error('❌ Error Logged:', err);

  // 1. Mongoose Bad ObjectId (CastError)
  if (err.name === 'CastError') {
    return res.status(404).json({
      success: false,
      message: 'العنصر المطلوب غير موجود أو المعرف غير صالح',
    });
  }

  // 2. Mongoose Duplicate Key (11000)
  if (err.code === 11000) {
    let field = 'البيانات';
    if (err.keyValue) {
      if (err.keyValue.email) field = 'البريد الإلكتروني';
      else if (err.keyValue.job && err.keyValue.user) field = 'طلب التقديم على هذه الوظيفة';
    }
    return res.status(400).json({
      success: false,
      message: `${field} مسجل وموجود بالفعل في النظام!`,
    });
  }

  // 3. Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((val) => val.message).join(' - ');
    return res.status(400).json({ success: false, message });
  }

  // 4. JWT Errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً',
    });
  }

  // 5. Database Connection / Technical / System Errors
  const isTechnical =
    err.name === 'MongooseError' ||
    err.name === 'MongoServerError' ||
    err.name === 'ReferenceError' ||
    err.name === 'TypeError' ||
    err.name === 'SyntaxError' ||
    /buffering timed out|cannot call|econnrefused|not defined|validation failed|at Timeout/i.test(err.message || '');

  const userMessage = isTechnical
    ? 'حدث خطأ مؤقت أثناء معالجة الطلب، يرجى المحاولة مرة أخرى بعد لحظات'
    : (err.message || 'حدث خطأ غير متوقع، يرجى المحاولة مجدداً');

  res.status(err.statusCode || 500).json({
    success: false,
    message: userMessage,
  });
};

module.exports = errorHandler;
