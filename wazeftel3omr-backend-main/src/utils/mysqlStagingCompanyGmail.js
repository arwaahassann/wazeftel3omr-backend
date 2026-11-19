const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const getEncryptionKey = () => {
  const encoded = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
};

const getOAuthClient = () => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_GMAIL_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_GMAIL_REDIRECT_URI) {
    throw new Error('GMAIL_OAUTH_NOT_CONFIGURED');
  }
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_GMAIL_REDIRECT_URI);
};

const isAllowedFrontendOrigin = (origin) => {
  try {
    const parsedOrigin = new URL(origin);
    const configured = process.env.CLIENT_URL ? new URL(process.env.CLIENT_URL).origin : null;
    return parsedOrigin.origin === origin
      && (origin === configured || ['http://localhost:5173', 'http://localhost:3000'].includes(origin));
  } catch {
    return false;
  }
};

const encryptRefreshToken = (token) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
};

const createMysqlStagingConnectUrl = ({ userId, origin }) => {
  if (!isAllowedFrontendOrigin(origin)) throw new Error('GMAIL_OAUTH_ORIGIN_NOT_ALLOWED');
  getEncryptionKey();
  const oauth2Client = getOAuthClient();
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

const completeMysqlStagingGmailConnection = async ({ code, state, users }) => {
  const payload = jwt.verify(state, process.env.JWT_SECRET);
  if (payload.purpose !== 'connect-company-gmail'
    || !payload.userId
    || !isAllowedFrontendOrigin(payload.origin)) {
    throw new Error('GMAIL_OAUTH_STATE_INVALID');
  }
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  if (!String(tokens.scope || '').split(/\s+/).includes(GMAIL_SEND_SCOPE)) {
    throw new Error('GMAIL_SEND_SCOPE_MISSING');
  }
  oauth2Client.setCredentials(tokens);
  const { data: gmailUser } = await oauth2Client.request({
    url: 'https://www.googleapis.com/oauth2/v2/userinfo',
  });
  if (!gmailUser.email || gmailUser.verified_email !== true) {
    throw new Error('GMAIL_ADDRESS_NOT_VERIFIED');
  }
  const currentUser = await users.getGmailConnection(payload.userId);
  if (!currentUser || currentUser.role !== 'employer') throw new Error('GMAIL_ACCOUNT_NOT_EMPLOYER');
  let encryptedRefreshToken = tokens.refresh_token
    ? encryptRefreshToken(tokens.refresh_token)
    : null;
  if (!encryptedRefreshToken) {
    if (currentUser.gmailSenderEmail !== String(gmailUser.email).toLowerCase()
      || !currentUser.gmailRefreshTokenEncrypted) {
      throw new Error('GMAIL_REFRESH_TOKEN_MISSING');
    }
    encryptedRefreshToken = currentUser.gmailRefreshTokenEncrypted;
  }
  return {
    userId: String(payload.userId),
    origin: payload.origin,
    email: String(gmailUser.email).toLowerCase(),
    encryptedRefreshToken,
  };
};

module.exports = {
  createMysqlStagingConnectUrl,
  completeMysqlStagingGmailConnection,
};
