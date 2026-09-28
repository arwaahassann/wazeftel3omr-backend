const express = require('express');
const router = express.Router();
const {
  getAllJobs,
  getJobById,
  createJob,
  updateJob,
  deleteJob,
  getMyJobs,
} = require('../controllers/jobController');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  validateCreateJob,
  validateUpdateJob,
} = require('../middleware/validationMiddleware');

// 1. المسارات العامة (متاحة للجميع للبحث واستعراض الوظائف)
router.get('/', getAllJobs);
router.get('/mine', protect, authorize('employer', 'admin'), getMyJobs);
router.get('/:id', getJobById);

// 2. المسارات المحمية (تتطلب دخول صاحب عمل أو أدمين) + Validation
router.post('/',    protect, authorize('employer', 'admin'), validateCreateJob, createJob);
router.put('/:id',  protect, authorize('employer', 'admin'), validateUpdateJob,  updateJob);
router.delete('/:id', protect, authorize('employer', 'admin'), deleteJob);

module.exports = router;
