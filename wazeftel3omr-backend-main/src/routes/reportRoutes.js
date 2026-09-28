const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { createReport, getMyReports } = require('../controllers/reportController');

router.use(protect);
router.post('/', createReport);
router.get('/mine', getMyReports);

module.exports = router;
