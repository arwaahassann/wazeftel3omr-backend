const jwt = require('jsonwebtoken');
const User = require('../models/User');

// 🔒 1. التحقق من التذكرة الأمنية (JWT Bearer Token)
const protect = async (req, res, next) => {
  let token;

  // التحقق من وجود Header باسم Authorization يبدأ بـ Bearer
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // فصل كلمة Bearer والحصول على التذكرة المشفرة الصافية
      token = req.headers.authorization.split(' ')[1];

      // فك تشفير التذكرة والتحقق من صحتها باستخدام المفتاح السري
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // جلب بيانات المستخدم وتمريرها للـ Controllers القادمة (مع استبعاد كلمة المرور)
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'المستخدم صاحب هذه التذكرة لم يعد موجوداً في النظام',
        });
      }

      next(); // التذكرة أصلية وسليمة -> السماح بالمرور
    } catch (error) {
      console.error('JWT Verification Error:', error.message);
      return res.status(401).json({
        success: false,
        message: 'التذكرة غير صالحة أو انتهت صلاحيتها، يرجى تسجيل الدخول مجدداً',
      });
    }
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'غير مصرح، يرجى تسجيل الدخول وإرسال تذكرة الدخول (Token)',
    });
  }
};

// 🔒 2. التحقق من الصلاحيات والـ Roles (مثل admin أو employer)
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `الرتبة (${req.user.role}) غير مصرح لها بالوصول لهذا المسار`,
      });
    }
    next();
  };
};

module.exports = {
  protect,
  authorize,
};
