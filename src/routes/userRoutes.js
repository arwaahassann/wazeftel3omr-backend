const express = require('express');
const router = express.Router();
const {
  getUserProfile,
  updateUserProfile,
  changePassword,
  toggleSaveJob,
  getSavedJobs,
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { validateUpdateProfile } = require('../middleware/validationMiddleware');

// جميع مسارات المستخدم محمية وتتطلب تسجيل الدخول (Bearer Token)
router.use(protect);

// الملف الشخصي (يدعم / و /profile) + Validation على البيانات المُرسلة
router.get('/', getUserProfile);
router.get('/profile', getUserProfile);
router.put('/', validateUpdateProfile, updateUserProfile);
router.put('/profile', validateUpdateProfile, updateUserProfile);
router.put('/change-password', changePassword);

// 🔖 مسارات المفضلة
router.get('/saved', getSavedJobs);
router.post('/saved/:jobId', toggleSaveJob);

module.exports = router;
