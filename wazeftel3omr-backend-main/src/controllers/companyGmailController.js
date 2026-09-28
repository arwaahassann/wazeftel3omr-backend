const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  createConnectUrl,
  completeGmailConnection,
} = require('../utils/companyGmail');

const getConnectionStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+gmailSenderEmail');
    res.status(200).json({
      success: true,
      connected: Boolean(user?.gmailSenderEmail),
      email: user?.gmailSenderEmail || null,
    });
  } catch (error) {
    next(error);
  }
};

const getConnectUrl = (req, res) => {
  try {
    const url = createConnectUrl({ userId: req.user._id, origin: req.get('origin') });
    res.status(200).json({ success: true, url });
  } catch (error) {
    const message = error.message === 'GMAIL_OAUTH_NOT_CONFIGURED'
      || error.message === 'GMAIL_TOKEN_ENCRYPTION_KEY is not configured'
      || error.message === 'GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key'
      ? 'ربط Gmail غير مُعدّ على الخادم بعد.'
      : 'تعذر بدء ربط Gmail من هذا الموقع.';
    res.status(503).json({ success: false, message });
  }
};

const gmailOAuthCallback = async (req, res) => {
  let origin = process.env.CLIENT_URL;
  try {
    const result = await completeGmailConnection({
      code: req.query.code,
      state: req.query.state,
    });
    origin = result.origin;
    const user = await User.findById(result.userId).select('role');
    if (!user || user.role !== 'employer') throw new Error('GMAIL_ACCOUNT_NOT_EMPLOYER');
    await User.findByIdAndUpdate(result.userId, {
      $set: {
        gmailSenderEmail: result.email,
        gmailRefreshTokenEncrypted: result.encryptedRefreshToken,
        gmailConnectedAt: new Date(),
      },
    });
    return res.redirect(`${origin.replace(/\/$/, '')}/settings?gmail=connected`);
  } catch (error) {
    if (error.message === 'GMAIL_OAUTH_STATE_INVALID' || error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      console.error('Company Gmail OAuth callback rejected:', error.message);
    } else {
      try {
        const decoded = jwt.verify(req.query.state, process.env.JWT_SECRET);
        if (decoded.purpose === 'connect-company-gmail') origin = decoded.origin;
      } catch {
        // Invalid callback state uses the configured frontend origin.
      }
      console.error('Company Gmail OAuth callback failed:', error.message);
    }
    return res.redirect(`${String(origin || '').replace(/\/$/, '')}/settings?gmail=error`);
  }
};

const disconnectGmail = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $unset: { gmailSenderEmail: 1, gmailRefreshTokenEncrypted: 1, gmailConnectedAt: 1 },
    });
    res.status(200).json({ success: true, message: 'تم فصل حساب Gmail عن الشركة.' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getConnectionStatus, getConnectUrl, gmailOAuthCallback, disconnectGmail };
