const express = require('express');
const router = express.Router();
const {
  getApplicationMessages,
  sendMessage,
} = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/:applicationId', getApplicationMessages);
router.post('/:applicationId', sendMessage);

module.exports = router;
