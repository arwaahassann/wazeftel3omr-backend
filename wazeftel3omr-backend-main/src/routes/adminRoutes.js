const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getDashboardStats,
  getAllUsers,
  updateUserStatus,
  getAllCompanies,
  updateCompanyStatus,
  getAdminAllJobs,
  getAdminJobDetails,
  updateAdminJobStatus,
  deleteAdminJob,
  getAdminAllApplications,
  getAdminAllReports,
  updateAdminReportStatus,
  getAdminNotifications,
  getAdminNotificationCount,
  updateAdminNotificationStates,
} = require('../controllers/adminController');

// 🔒 حماية: مسارات الأدمن متاحة حصراً لمستخدمي role = admin
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'غير مصرح لك بالوصول! هذه اللوحة مخصصة لإدارة المنصة فقط.',
    });
  }
  next();
};

router.use(protect, adminOnly);

// 1. إحصائيات الداشبورد الرئيسية
router.get('/stats', getDashboardStats);

// 2. إدارة المستخدمين
router.get('/users', getAllUsers);
router.put('/users/:id/status', updateUserStatus);

// 3. إدارة الشركات
router.get('/companies', getAllCompanies);
router.put('/companies/:id/status', updateCompanyStatus);

// 4. إدارة الوظائف
router.get('/jobs', getAdminAllJobs);
router.get('/jobs/:id', getAdminJobDetails);
router.put('/jobs/:id/status', updateAdminJobStatus);
router.delete('/jobs/:id', deleteAdminJob);

// 5. إدارة طلبات التقديم
router.get('/applications', getAdminAllApplications);

// 6. الشكاوي والمقترحات
router.get('/reports', getAdminAllReports);
router.put('/reports/:id/status', updateAdminReportStatus);

// 7. إشعارات الأدمن
router.get('/notifications/count', getAdminNotificationCount);
router.get('/notifications', getAdminNotifications);
router.put('/notifications/state', updateAdminNotificationStates);

module.exports = router;
