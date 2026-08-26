const express = require('express');
const router = express.Router();
const { registerUser, loginUser, googleLogin, sendOtp, verifyOtp, resetPasswordWithOtp, getMe, logoutUser } = require('../controllers/authController');
const {
  validateRegister,
  validateLogin,
  validateResetPassword,
} = require('../middleware/validationMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');
const { protect } = require('../middleware/authMiddleware');

// 1. مسار تسجيل حساب جديد مع حد محاولات التخمين والفالديشن الصارم
router.post('/register', authLimiter, validateRegister, registerUser);

// 2. مسار تسجيل الدخول مع حد محاولات التخمين والفالديشن
router.post('/login', authLimiter, validateLogin, loginUser);

// 3. مسار الدخول بحساب Google
router.post('/google', authLimiter, googleLogin);

// 4. مسارات الـ OTP وتغيير كلمة المرور
router.post('/send-otp', authLimiter, sendOtp);
router.post('/verify-otp', authLimiter, verifyOtp);
router.post('/reset-password-otp', authLimiter, validateResetPassword, resetPasswordWithOtp);

// 5. مسار جلب بيانات المستخدم الحالي (محمي بـ Bearer Token)
router.get('/me', protect, getMe);

// 6. مسار تسجيل الخروج
router.post('/logout', logoutUser);

module.exports = router;
