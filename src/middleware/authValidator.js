const { check, validationResult } = require('express-validator');

// 1. دالة معالجة واستخراج الأخطاء وإرجاعها للعميل
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'بيانات الإدخال غير صالحة',
      errors: errors.array().map((err) => ({
        field: err.path,
        message: err.msg,
      })),
    });
  }
  next();
};

// 2. قواعد الفالديشن الخاصة بإنشاء حساب جديد (Register)
const validateRegister = [
  check('name')
    .notEmpty()
    .withMessage('الاسم بالكامل مطلوب')
    .trim()
    .escape(), // 🛡️ تطهير الإدخال من أي أكواد ضارة (XSS)

  check('email')
    .isEmail()
    .withMessage('يرجى إدخال بريد إلكتروني صالح')
    .normalizeEmail(), // 🛡️ تحويل الإيميل للحروف الصغيرة القياسية

  check('password')
    .isLength({ min: 8 })
    .withMessage('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]/)
    .withMessage('كلمة المرور يجب أن تحتوي على: حرف كبير، حرف صغير، رقم، ورمز خاص (@$!%*?&#)'),

  handleValidationErrors,
];

// 3. قواعد الفالديشن الخاصة بتسجيل الدخول (Login)
const validateLogin = [
  check('email')
    .isEmail()
    .withMessage('يرجى إدخال بريد إلكتروني صالح')
    .normalizeEmail(),

  check('password')
    .notEmpty()
    .withMessage('كلمة المرور مطلوبة'),

  handleValidationErrors,
];

module.exports = {
  validateRegister,
  validateLogin,
};
