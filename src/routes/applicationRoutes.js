const express = require('express');
const router = express.Router();
const {
  applyForJob,
  getMyApplications,
  getApplicationStats,
  updateApplicationStatus,
  getJobApplications,
  getAllEmployerApplicants,
} = require('../controllers/applicationController');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  validateApplyForJob,
  validateUpdateStatus,
} = require('../middleware/validationMiddleware');

// جميع مسارات الطلبات تتطلب تسجيل الدخول
router.use(protect);

// 📌 Seeker routes
router.get('/stats', getApplicationStats);
router.get('/', getMyApplications);

// 📌 Employer routes
router.get('/all',          authorize('employer', 'admin'), getAllEmployerApplicants);
router.get('/employer/all', authorize('employer', 'admin'), getAllEmployerApplicants);
router.get('/job/:jobId',   authorize('employer', 'admin'), getJobApplications);

// تحديث حالة الطلب مع Validation صارم لقيمة الـ status
router.put('/:id/status',   authorize('employer', 'admin'), validateUpdateStatus, updateApplicationStatus);

// 📌 Apply route + Validation (MUST BE LAST)
router.post('/:jobId', validateApplyForJob, applyForJob);

module.exports = router;
