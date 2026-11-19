const jwt = require('jsonwebtoken');
const {
  createMysqlStagingConnectUrl,
  completeMysqlStagingGmailConnection,
} = require('../utils/mysqlStagingCompanyGmail');

const createMysqlStagingCompanyGmailController = (users) => {
  const getConnectionStatus = async (req, res, next) => {
    try {
      const user = await users.getGmailConnection(req.user._id);
      return res.status(200).json({
        success: true,
        connected: Boolean(user?.gmailSenderEmail),
        email: user?.gmailSenderEmail || null,
      });
    } catch (error) {
      return next(error);
    }
  };

  const getConnectUrl = (req, res) => {
    try {
      const url = createMysqlStagingConnectUrl({
        userId: req.user._id,
        origin: req.get('origin'),
      });
      return res.status(200).json({ success: true, url });
    } catch (error) {
      const configurationErrors = [
        'GMAIL_OAUTH_NOT_CONFIGURED',
        'GMAIL_TOKEN_ENCRYPTION_KEY is not configured',
        'GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      ];
      const message = configurationErrors.includes(error.message)
        ? 'ربط Gmail غير مُعدّ على الخادم بعد.'
        : 'تعذر بدء ربط Gmail من هذا الموقع.';
      return res.status(503).json({ success: false, message });
    }
  };

  const gmailOAuthCallback = async (req, res) => {
    let origin = process.env.CLIENT_URL;
    try {
      const result = await completeMysqlStagingGmailConnection({
        code: req.query.code,
        state: req.query.state,
        users,
      });
      origin = result.origin;
      await users.update(result.userId, {
        gmailSenderEmail: result.email,
        gmailRefreshTokenEncrypted: result.encryptedRefreshToken,
        gmailConnectedAt: new Date(),
      });
      return res.redirect(`${origin.replace(/\/$/, '')}/settings?gmail=connected`);
    } catch (error) {
      if (error.message !== 'GMAIL_OAUTH_STATE_INVALID'
        && error.name !== 'JsonWebTokenError'
        && error.name !== 'TokenExpiredError') {
        try {
          const decoded = jwt.verify(req.query.state, process.env.JWT_SECRET);
          if (decoded.purpose === 'connect-company-gmail') origin = decoded.origin;
        } catch {
          // Invalid callback state falls back to the configured frontend URL.
        }
      }
      console.error('MySQL staging Gmail OAuth callback failed:', error.message);
      return res.redirect(`${String(origin || '').replace(/\/$/, '')}/settings?gmail=error`);
    }
  };

  const disconnectGmail = async (req, res, next) => {
    try {
      await users.update(req.user._id, {
        gmailSenderEmail: null,
        gmailRefreshTokenEncrypted: null,
        gmailConnectedAt: null,
      });
      return res.status(200).json({ success: true, message: 'تم فصل حساب Gmail عن الشركة.' });
    } catch (error) {
      return next(error);
    }
  };

  return { getConnectionStatus, getConnectUrl, gmailOAuthCallback, disconnectGmail };
};

module.exports = { createMysqlStagingCompanyGmailController };
