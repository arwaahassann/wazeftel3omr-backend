const express = require('express');
const router = express.Router();
const {
  getAllJobs,
  getJobById,
  createJob,
  updateJob,
  deleteJob,
  getMyJobs,
  expireJobsFromCron,
} = require('../controllers/jobController');
const { protect, optionalProtect, authorize } = require('../middleware/authMiddleware');
const {
  validateCreateJob,
  validateUpdateJob,
} = require('../middleware/validationMiddleware');

// 1. المسارات العامة (متاحة للجميع للبحث واستعراض الوظائف)
router.get('/expire', expireJobsFromCron);
router.get('/', getAllJobs);
router.get('/mine', protect, authorize('employer', 'admin'), getMyJobs);
router.get('/:id', optionalProtect, getJobById);

// 2. المسارات المحمية لإدارة وظائف صاحب العمل + Validation
router.post('/',    protect, authorize('employer'), validateCreateJob, createJob);
router.put('/:id',  protect, authorize('employer'), validateUpdateJob,  updateJob);
router.delete('/:id', protect, authorize('employer'), deleteJob);

module.exports = router;
