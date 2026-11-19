require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomInt } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { getMysqlPool } = require('../src/config/mysql');
const { createMysqlUserRepository } = require('../src/db/mysqlUserRepository');
const { createMysqlStagingApp } = require('../src/createMysqlStagingApp');

const enabled = process.env.MYSQL_STAGING_AUTH_TESTS === 'true';

test('MySQL staging authentication and profile end-to-end', { skip: !enabled }, async (t) => {
  assert.ok(process.env.MONGO_URI, 'MONGO_URI must be present to confirm it remains configured');

  const pool = getMysqlPool();
  const users = createMysqlUserRepository(pool);
  const testEmail = `mysql-staging-auth-${Date.now()}@example.test`;
  const testPhone = `010${randomInt(10_000_000, 100_000_000)}`;
  const deliveredOtps = [];
  const app = createMysqlStagingApp({
    pool,
    sendEmail: async (email) => {
      deliveredOtps.push(email);
      return { sent: true, sender: 'staging-test@example.test' };
    },
  });
  const server = http.createServer(app);
  let baseUrl;
  const createdIds = [];
  let registrationToken;
  let registeredUser;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const request = async (path, { method = 'GET', body, token } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { response, body: await response.json() };
  };

  try {
    await t.test('registers a staging-only user and preserves Mongo-compatible IDs', async () => {
      const { response, body } = await request('/api/auth/register', {
        method: 'POST',
        body: {
          name: 'Staging OTP Test',
          email: testEmail,
          password: 'StagePass123!',
          role: 'job_seeker',
          phone: testPhone,
          jobTitle: 'QA Engineer',
          location: 'Cairo',
          detailedAddress: 'Staging Test Address',
        },
      });
      assert.equal(response.status, 201);
      assert.equal(body.success, true);
      assert.match(body.user.id, /^[a-f\d]{24}$/i);
      assert.equal(body.user.email, testEmail.toLowerCase());
      assert.equal(body.user.role, 'job_seeker');
      registeredUser = body.user;
      registrationToken = body.token;
      createdIds.push(registeredUser.id);

      const stored = await users.findByEmail(testEmail);
      assert.match(stored.password, /^\$2[aby]\$/);
      assert.equal(await bcrypt.compare('StagePass123!', stored.password), true);
    });

    await t.test('sends OTP through the isolated test sender and rejects invalid or expired codes', async () => {
      const sent = await request('/api/auth/send-otp', {
        method: 'POST',
        body: { email: testEmail },
      });
      assert.equal(sent.response.status, 200);
      assert.equal(sent.body.success, true);
      assert.match(sent.body.message, /تم إرسال رمز التحقق/);
      assert.equal(Object.hasOwn(sent.body, 'otpCode'), false);

      const current = await users.findByEmail(testEmail);
      assert.match(current.otpCode, /^\d{6}$/);
      assert.ok(new Date(current.otpExpire).getTime() > Date.now());
      assert.equal(deliveredOtps.length, 1);
      assert.equal(deliveredOtps[0].email, testEmail);
      assert.equal(deliveredOtps[0].otpCode, current.otpCode);

      const invalid = await request('/api/auth/verify-otp', {
        method: 'POST',
        body: { email: testEmail, otp: '000000' },
      });
      assert.equal(invalid.response.status, 400);
      assert.match(invalid.body.message, /غير صحيح/);

      await pool.execute(
        'UPDATE users SET otp_expire = ? WHERE id = ?',
        [new Date(Date.now() - 60_000), registeredUser.id],
      );
      const expired = await request('/api/auth/verify-otp', {
        method: 'POST',
        body: { email: testEmail, otp: current.otpCode },
      });
      assert.equal(expired.response.status, 400);
      assert.match(expired.body.message, /انتهت صلاحية/);

      const resent = await request('/api/auth/send-otp', {
        method: 'POST',
        body: { email: testEmail },
      });
      assert.equal(resent.response.status, 200);
      assert.equal(deliveredOtps.length, 2);
      assert.equal(deliveredOtps[1].email, testEmail);
      assert.notEqual((await users.findByEmail(testEmail)).otpCode, current.otpCode);
    });

    await t.test('verifies the test-sender OTP and accepts the issued JWT', async () => {
      const deliveredCode = (await users.findByEmail(testEmail)).otpCode;
      const verified = await request('/api/auth/verify-otp', {
        method: 'POST',
        body: { email: testEmail, otp: deliveredCode },
      });
      assert.equal(verified.response.status, 200);
      assert.equal(verified.body.success, true);
      assert.equal(verified.body.user.isVerified, true);
      assert.equal(verified.body.user.id, registeredUser.id);
      registrationToken = verified.body.token;

      const me = await request('/api/auth/me', { token: registrationToken });
      assert.equal(me.response.status, 200);
      assert.equal(me.body.user._id, registeredUser.id);
      assert.equal(me.body.user.email, testEmail.toLowerCase());
      assert.equal(Object.hasOwn(me.body.user, 'password'), false);
    });

    await t.test('logs in with a pre-existing bcrypt hash without rehashing it', async () => {
      const legacyPassword = 'LegacyPass123!';
      const legacyHash = await bcrypt.hash(legacyPassword, 12);
      const legacyUser = await users.create({
        name: 'Legacy Hash Test',
        email: `legacy-${Date.now()}@example.test`,
        password: legacyHash,
        role: 'job_seeker',
        detailedAddress: 'Test',
      });
      createdIds.push(legacyUser._id);

      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: legacyUser.email, password: legacyPassword },
      });
      assert.equal(login.response.status, 200);
      assert.equal(login.body.user.id, legacyUser._id);
      assert.equal((await users.findByEmail(legacyUser.email)).password, legacyHash);
    });

    await t.test('resets the password with a valid OTP and authenticates the new password', async () => {
      const resetCode = '739184';
      await pool.execute(
        'UPDATE users SET otp_code = ?, otp_expire = ? WHERE id = ?',
        [resetCode, new Date(Date.now() + 15 * 60_000), registeredUser.id],
      );
      const reset = await request('/api/auth/reset-password-otp', {
        method: 'POST',
        body: {
          email: testEmail,
          otp: resetCode,
          newPassword: 'ResetPass456!',
          confirmPassword: 'ResetPass456!',
        },
      });
      assert.equal(reset.response.status, 200);
      assert.equal(reset.body.success, true);

      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: testEmail, password: 'ResetPass456!' },
      });
      assert.equal(login.response.status, 200);
      registrationToken = login.body.token;

      const wrongOtpReset = await request('/api/auth/reset-password-otp', {
        method: 'POST',
        body: {
          email: testEmail,
          otp: '000000',
          newPassword: 'AnotherPass789!',
        },
      });
      assert.equal(wrongOtpReset.response.status, 400);
    });

    await t.test('updates and retrieves profile fields and nested skill/experience records', async () => {
      const update = await request('/api/users/profile', {
        method: 'PUT',
        token: registrationToken,
        body: {
          name: 'Staging OTP Test Updated',
          jobTitle: 'Senior QA Engineer',
          phone: testPhone,
          location: 'Giza',
          detailedAddress: 'Updated Staging Address',
          bio: 'A staging profile for integration testing.',
          skills: ['SQL', 'Testing'],
          experiences: [{ title: 'QA', company: 'Test Co', period: '2024-2026' }],
        },
      });
      assert.equal(update.response.status, 200);
      assert.equal(update.body.user._id, registeredUser.id);
      assert.deepEqual(update.body.user.skills, ['SQL', 'Testing']);
      assert.deepEqual(update.body.user.experiences, [
        { title: 'QA', company: 'Test Co', period: '2024-2026' },
      ]);

      const profile = await request('/api/users/profile', { token: registrationToken });
      assert.equal(profile.response.status, 200);
      assert.equal(profile.body.user.detailedAddress, 'Updated Staging Address');
      assert.deepEqual(profile.body.user.skills, ['SQL', 'Testing']);
      assert.equal(Object.hasOwn(profile.body.user, 'password'), false);
    });

    await t.test('changes password, preserves protected profile access, and accepts invalid-password rejection', async () => {
      const changed = await request('/api/users/change-password', {
        method: 'PUT',
        token: registrationToken,
        body: {
          currentPassword: 'ResetPass456!',
          newPassword: 'ChangedPass789!',
          confirmPassword: 'ChangedPass789!',
        },
      });
      assert.equal(changed.response.status, 200);

      const oldPassword = await request('/api/auth/login', {
        method: 'POST',
        body: { email: testEmail, password: 'ResetPass456!' },
      });
      assert.equal(oldPassword.response.status, 401);

      const newPassword = await request('/api/auth/login', {
        method: 'POST',
        body: { email: testEmail, password: 'ChangedPass789!' },
      });
      assert.equal(newPassword.response.status, 200);

      const anonymous = await request('/api/users/profile');
      assert.equal(anonymous.response.status, 401);
    });
  } finally {
    for (const id of createdIds) {
      await pool.execute('DELETE FROM users WHERE id = ?', [id]);
    }
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await pool.end();
  }
});
