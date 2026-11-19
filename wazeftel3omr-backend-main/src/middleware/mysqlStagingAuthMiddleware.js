const jwt = require('jsonwebtoken');

const createMysqlStagingAuthMiddleware = (users) => {
  const protect = async (req, res, next) => {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'غير مصرح، يرجى تسجيل الدخول وإرسال تذكرة الدخول (Token)',
      });
    }

    try {
      const token = authorization.slice('Bearer '.length);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await users.findById(decoded.id);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'المستخدم صاحب هذه التذكرة لم يعد موجوداً في النظام',
        });
      }
      if (user.accountStatus === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'تم تعليق هذا الحساب من إدارة المنصة.',
        });
      }
      req.user = user;
      return next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'التذكرة غير صالحة أو انتهت صلاحيتها، يرجى تسجيل الدخول مجدداً',
        });
      }
      return next(error);
    }
  };

  const authorize = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `الرتبة (${req.user.role}) غير مصرح لها بالوصول لهذا المسار`,
      });
    }
    return next();
  };

  return { protect, authorize };
};

module.exports = { createMysqlStagingAuthMiddleware };
