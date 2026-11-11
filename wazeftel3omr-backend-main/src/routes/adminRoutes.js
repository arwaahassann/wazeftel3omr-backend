const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getDashboardStats,
  searchAdminAccounts,
  getAllCompanies,
  updateCompanyStatus,
  getAdminCompanyDocument,
  getAdminSeekers,
  updateAdminSeekerStatus,
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

// 2. بحث حسابات للقراءة فقط (مطلوب للبحث العام بلوحة الأدمن)
router.get('/account-search', searchAdminAccounts);

// 3. إدارة الشركات
router.get('/companies', getAllCompanies);
router.get('/companies/:id/documents/:documentType', getAdminCompanyDocument);
router.put('/companies/:id/status', updateCompanyStatus);

// 4. إدارة الباحثين عن عمل فقط
router.get('/seekers', getAdminSeekers);
router.put('/seekers/:id/status', updateAdminSeekerStatus);

// 5. إدارة الوظائف
router.get('/jobs', getAdminAllJobs);
router.get('/jobs/:id', getAdminJobDetails);
router.put('/jobs/:id/status', updateAdminJobStatus);
router.delete('/jobs/:id', deleteAdminJob);

// 6. إدارة طلبات التقديم
router.get('/applications', getAdminAllApplications);

// 7. الشكاوي والمقترحات
router.get('/reports', getAdminAllReports);
router.put('/reports/:id/status', updateAdminReportStatus);

// 8. إشعارات الأدمن
router.get('/notifications/count', getAdminNotificationCount);
router.get('/notifications', getAdminNotifications);
router.put('/notifications/state', updateAdminNotificationStates);

module.exports = router;
