const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  getConnectionStatus,
  getConnectUrl,
  gmailOAuthCallback,
  disconnectGmail,
} = require('../controllers/companyGmailController');

router.get('/oauth/callback', gmailOAuthCallback);
router.use(protect, authorize('employer'));
router.get('/status', getConnectionStatus);
router.get('/connect-url', getConnectUrl);
router.delete('/connection', disconnectGmail);

module.exports = router;
