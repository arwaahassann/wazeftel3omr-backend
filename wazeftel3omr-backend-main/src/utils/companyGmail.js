const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const getOAuthConfig = () => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_GMAIL_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_GMAIL_REDIRECT_URI) {
    throw new Error('GMAIL_OAUTH_NOT_CONFIGURED');
  }
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: GOOGLE_GMAIL_REDIRECT_URI };
};

const createOAuthClient = () => {
  const config = getOAuthConfig();
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
};

const getEncryptionKey = () => {
  const encoded = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
};

const encryptRefreshToken = (token) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.');
};

const decryptRefreshToken = (value) => {
  const [ivPart, tagPart, encryptedPart] = String(value || '').split('.');
  if (!ivPart || !tagPart || !encryptedPart) throw new Error('Stored Gmail token is invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

const isAllowedFrontendOrigin = (origin) => {
  try {
    new URL(origin);
    const configuredClientUrl = process.env.CLIENT_URL;
    const configuredOrigin = configuredClientUrl ? new URL(configuredClientUrl).origin : null;
    return origin === configuredOrigin
      || ['http://localhost:5173', 'http://localhost:3000'].includes(origin);
  } catch {
    return false;
  }
};

const createConnectUrl = ({ userId, origin }) => {
  if (!isAllowedFrontendOrigin(origin)) throw new Error('GMAIL_OAUTH_ORIGIN_NOT_ALLOWED');
  getEncryptionKey();
  const oauth2Client = createOAuthClient();
  const state = jwt.sign(
    { purpose: 'connect-company-gmail', userId: String(userId), origin },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['openid', 'email', GMAIL_SEND_SCOPE],
    state,
  });
};

const completeGmailConnection = async ({ code, state }) => {
  const payload = jwt.verify(state, process.env.JWT_SECRET);
  if (payload.purpose !== 'connect-company-gmail' || !payload.userId || !isAllowedFrontendOrigin(payload.origin)) {
    throw new Error('GMAIL_OAUTH_STATE_INVALID');
  }

  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  if (!String(tokens.scope || '').split(/\s+/).includes(GMAIL_SEND_SCOPE)) {
    throw new Error('GMAIL_SEND_SCOPE_MISSING');
  }

  oauth2Client.setCredentials(tokens);
  const { data: gmailUser } = await oauth2Client.request({
    url: 'https://www.googleapis.com/oauth2/v2/userinfo',
  });
  if (!gmailUser.email || gmailUser.verified_email !== true) throw new Error('GMAIL_ADDRESS_NOT_VERIFIED');

  let encryptedRefreshToken = tokens.refresh_token
    ? encryptRefreshToken(tokens.refresh_token)
    : null;
  if (!encryptedRefreshToken) {
    const existingUser = await User.findById(payload.userId)
      .select('+gmailSenderEmail +gmailRefreshTokenEncrypted');
    if (existingUser?.gmailSenderEmail !== String(gmailUser.email).toLowerCase()
      || !existingUser.gmailRefreshTokenEncrypted) {
      throw new Error('GMAIL_REFRESH_TOKEN_MISSING');
    }
    encryptedRefreshToken = existingUser.gmailRefreshTokenEncrypted;
  }

  return {
    userId: String(payload.userId),
    origin: payload.origin,
    email: String(gmailUser.email).toLowerCase(),
    encryptedRefreshToken,
  };
};

const sendCompanyEmail = async (mailbox, options) => {
  if (!mailbox?.gmailSenderEmail || !mailbox?.gmailRefreshTokenEncrypted) {
    return { sent: false, reason: 'GMAIL_NOT_CONNECTED' };
  }

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    refresh_token: decryptRefreshToken(mailbox.gmailRefreshTokenEncrypted),
  });
  const transporter = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'windows',
  });

  try {
    const message = await transporter.sendMail({
      from: `"${String(options.fromName || mailbox.company || 'الشركة').replace(/["\r\n]/g, '')}" <${mailbox.gmailSenderEmail}>`,
      to: options.email,
      replyTo: mailbox.gmailSenderEmail,
      subject: options.subject,
      text: options.message,
      html: options.html,
    });

    if (!Buffer.isBuffer(message.message)) throw new Error('GMAIL_MESSAGE_ENCODING_FAILED');
    const { data } = await oauth2Client.request({
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      method: 'POST',
      data: { raw: message.message.toString('base64url') },
    });
    if (!data.id) return { sent: false, reason: 'GMAIL_MESSAGE_NOT_ACCEPTED' };
    return { sent: true, messageId: data.id, sender: mailbox.gmailSenderEmail };
  } finally {
    transporter.close();
  }
};

module.exports = {
  createConnectUrl,
  completeGmailConnection,
  sendCompanyEmail,
};
