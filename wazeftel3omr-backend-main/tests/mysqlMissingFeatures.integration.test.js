require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { getMysqlPool } = require('../src/config/mysql');
const { createMysqlUserRepository } = require('../src/db/mysqlUserRepository');
const { MysqlJobRepository } = require('../src/db/mysqlJobRepository');
const { MysqlApplicationRepository } = require('../src/db/mysqlApplicationRepository');
const { MysqlAdminRepository } = require('../src/db/mysqlAdminRepository');
const { createMysqlStagingApp } = require('../src/createMysqlStagingApp');

const enabled = process.env.MYSQL_STAGING_MISSING_FEATURES_TESTS === 'true';

test('MySQL staging admin management, Gmail connection management, and AI route parity', {
  skip: !enabled,
}, async (t) => {
  const databaseUrl = new URL(process.env.MYSQL_URL || '');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname.toLowerCase()),
    'Missing-features integration tests are restricted to local MySQL');
  assert.match(databaseUrl.pathname, /staging/i, 'Missing-features tests require a staging database');
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required');

  const pool = getMysqlPool();
  const users = createMysqlUserRepository(pool);
  const jobs = new MysqlJobRepository(pool);
  const applications = new MysqlApplicationRepository(pool);
  const statusEmails = [];
  const app = createMysqlStagingApp({
    pool,
    sendJobStatusEmail: async (email) => {
      statusEmails.push(email);
      return { sent: true };
    },
  });
  const server = http.createServer(app);
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const userIds = [];
  const jobIds = [];
  const applicationIds = [];
  let baseUrl;
  let admin;
  let employer;
  let seeker;
  let tokens;

  const makeUser = async (role, overrides = {}) => {
    const user = await users.create({
      name: `Missing feature ${role} ${suffix}`,
      email: `missing-features-${role}-${suffix}@example.test`,
      password: 'StagePass123!',
      role,
      phone: role === 'employer' ? '01012345678' : '',
      company: role === 'employer' ? `MissingFeaturesCo${suffix}` : '',
      accountStatus: 'reviewing',
      detailedAddress: 'Staging integration address',
      jobTitle: role === 'job_seeker' ? 'Integration candidate' : '',
      ...overrides,
    });
    userIds.push(user._id);
    return user;
  };
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
  const createJob = async (status, title) => {
    const job = await jobs.create({
      title,
      company: employer.company,
      location: 'Cairo',
      category: `MissingFeatures${suffix}`,
      description: 'Detailed staging integration job description.',
      qualifications: 'Experience',
      requirements: ['SQL', 'Testing'],
      status,
      postedBy: employer._id,
    });
    jobIds.push(job._id);
    return job;
  };

  try {
    admin = await makeUser('admin', { accountStatus: 'active' });
    employer = await makeUser('employer', {
      location: 'Cairo',
      detailedAddress: '12 Staging Street',
      accountStatus: 'reviewing',
    });
    seeker = await makeUser('job_seeker');
    tokens = Object.fromEntries([admin, employer, seeker].map((user) => [
      user.role,
      jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '10m' }),
    ]));
    const address = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve(server.address());
      });
    });
    baseUrl = `http://127.0.0.1:${address.port}`;

    await users.upsertCompanyDocument(employer._id, 'commercialRegister', {
      fileName: 'commercial-register.pdf',
      mimeType: 'application/pdf',
      dataUrl: 'data:application/pdf;base64,c3RhZ2luZw==',
      uploadedAt: new Date(),
    });
    await users.upsertCompanyDocument(employer._id, 'taxCard', {
      fileName: 'tax-card.pdf',
      mimeType: 'application/pdf',
      dataUrl: 'data:application/pdf;base64,c3RhZ2luZw==',
      uploadedAt: new Date(),
    });
    const [storedDocuments] = await pool.execute(
      'SELECT user_id, document_type FROM company_documents WHERE user_id = ?',
      [employer._id],
    );
    assert.equal(storedDocuments.length, 2);
    const adminRepository = new MysqlAdminRepository(pool);
    assert.ok(await adminRepository.getCompanyDocument(employer._id, 'commercialRegister'));

    let result = await request('/api/admin/companies?search=MissingFeatures', { token: tokens.admin });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.count, 1);
    assert.equal(result.body.companies[0]._id, employer._id);
    assert.equal(result.body.companies[0].companyDocuments.commercialRegister.fileName, 'commercial-register.pdf');
    result = await request(`/api/admin/companies/${employer._id}/documents/commercialRegister`, { token: tokens.admin });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.document.dataUrl, 'data:application/pdf;base64,c3RhZ2luZw==');
    result = await request(`/api/admin/companies/${employer._id}/status`, {
      method: 'PUT',
      body: { status: 'active' },
      token: tokens.admin,
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.company.accountStatus, 'active');
    result = await request(`/api/admin/companies/${employer._id}/status`, {
      method: 'PUT',
      body: { status: 'active' },
      token: tokens.employer,
    });
    assert.equal(result.response.status, 403);

    result = await request('/api/admin/seekers?search=Integration%20candidate', { token: tokens.admin });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.count, 1);
    assert.equal(result.body.seekers[0]._id, seeker._id);
    result = await request(`/api/admin/seekers/${seeker._id}/status`, {
      method: 'PUT',
      body: { status: 'suspended' },
      token: tokens.admin,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.seeker.accountStatus, 'suspended');
    await users.update(seeker._id, { accountStatus: 'active' });

    const firstJob = await createJob('reviewing', `MF ${suffix} Review`);
    const secondJob = await createJob('active', `MF ${suffix} Active`);
    result = await request(`/api/admin/jobs?search=${encodeURIComponent(suffix)}&limit=1`, { token: tokens.admin });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.count, 1);
    assert.equal(result.body.hasMore, true);
    assert.ok(result.body.nextCursor);
    result = await request(`/api/admin/jobs?search=${encodeURIComponent(suffix)}&limit=1&cursor=${encodeURIComponent(result.body.nextCursor)}`, {
      token: tokens.admin,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.count, 1);
    result = await request(`/api/admin/jobs/${firstJob._id}`, { token: tokens.admin });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.job.postedBy._id, employer._id);
    result = await request(`/api/admin/jobs/${firstJob._id}/status`, {
      method: 'PUT',
      body: { status: 'rejected', rejectionReason: 'Missing required details' },
      token: tokens.admin,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.job.status, 'rejected');
    assert.equal(statusEmails.length, 1);
    assert.equal(statusEmails[0].email, employer.email);
    result = await request(`/api/admin/jobs/${firstJob._id}/status`, {
      method: 'PUT',
      body: { status: 'active', rejectionReason: 'not allowed here' },
      token: tokens.admin,
    });
    assert.equal(result.response.status, 400);
    result = await request(`/api/admin/jobs/${secondJob._id}/status`, {
      method: 'PUT',
      body: { status: 'active' },
      token: tokens.employer,
    });
    assert.equal(result.response.status, 403);

    const application = await applications.create({
      user: seeker,
      jobId: secondJob._id,
      input: { name: seeker.name, email: seeker.email },
    });
    applicationIds.push(application._id);
    await pool.execute(
      `INSERT INTO messages (id, application_id, job_id, sender_id, sender_role, content)
       VALUES (?, ?, ?, ?, 'job_seeker', ?)`,
      [`${Date.now().toString(16).slice(-12).padStart(24, 'a')}`, application._id, secondJob._id, seeker._id, 'Temporary cascade check'],
    );
    result = await request(`/api/admin/jobs/${secondJob._id}`, { token: tokens.admin });
    assert.equal(result.response.status, 200);
    result = await request(`/api/admin/jobs/${secondJob._id}`, { token: tokens.employer });
    assert.equal(result.response.status, 403);
    result = await request(`/api/admin/jobs/${secondJob._id}`, { method: 'DELETE', token: tokens.admin });
    assert.equal(result.response.status, 200);
    const [[remainingApplications]] = await pool.execute(
      'SELECT COUNT(*) AS count FROM applications WHERE id = ?',
      [application._id],
    );
    const [[remainingMessages]] = await pool.execute(
      'SELECT COUNT(*) AS count FROM messages WHERE application_id = ?',
      [application._id],
    );
    assert.equal(Number(remainingApplications.count), 0);
    assert.equal(Number(remainingMessages.count), 0);

    for (const role of ['admin', 'employer', 'job_seeker']) {
      result = await request('/api/ai/generate-job', {
        method: 'POST',
        body: { title: `Developer ${role}` },
        token: tokens[role],
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.success, true);
      assert.ok(result.body.data.description);
      result = await request('/api/ai/screen-candidate', {
        method: 'POST',
        body: { applicantSkills: 'JavaScript, SQL, Testing', jobTitle: 'Developer' },
        token: tokens[role],
      });
      assert.equal(result.response.status, 200);
      assert.ok(Number.isFinite(result.body.data.matchScore));
      result = await request('/api/ai/generate-cover-letter', {
        method: 'POST',
        body: { jobTitle: 'Developer', company: 'Staging Co' },
        token: tokens[role],
      });
      assert.equal(result.response.status, 200);
      assert.ok(result.body.coverLetter.includes('Developer'));
      result = await request('/api/ai/career-coach', {
        method: 'POST',
        body: { message: 'نصائح للسيرة الذاتية' },
        token: tokens[role],
      });
      assert.equal(result.response.status, 200);
      assert.ok(result.body.reply);
    }
    result = await request('/api/ai/generate-job', { method: 'POST', body: { title: 'Developer' } });
    assert.equal(result.response.status, 401);

    result = await request('/api/employer/gmail/status', { token: tokens.employer });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.connected, false);
    result = await request('/api/employer/gmail/status', { token: tokens.admin });
    assert.equal(result.response.status, 403);
    await users.update(employer._id, {
      gmailSenderEmail: 'staging@example.test',
      gmailRefreshTokenEncrypted: 'encrypted-staging-token',
      gmailConnectedAt: new Date(),
    });
    result = await request('/api/employer/gmail/status', { token: tokens.employer });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.connected, true);
    assert.equal(result.body.email, 'staging@example.test');
    result = await request('/api/auth/me', { token: tokens.employer });
    assert.equal(result.response.status, 200);
    assert.deepEqual(Object.keys(result.body.user).sort(), [
      '_id', 'accountStatus', 'company', 'email', 'jobTitle', 'location', 'name', 'phone', 'role', 'avatar',
    ].sort());
    result = await request('/api/users/profile', { token: tokens.employer });
    assert.equal(result.response.status, 200);
    assert.equal(Object.hasOwn(result.body.user, 'gmailSenderEmail'), false);
    assert.equal(Object.hasOwn(result.body.user, 'gmailRefreshTokenEncrypted'), false);
    assert.equal(Object.hasOwn(result.body.user, 'gmailConnectedAt'), false);
    result = await request('/api/employer/gmail/connection', {
      method: 'DELETE',
      token: tokens.employer,
    });
    assert.equal(result.response.status, 200);
    const gmailConnection = await users.getGmailConnection(employer._id);
    assert.equal(gmailConnection.gmailSenderEmail, null);
    assert.equal(gmailConnection.gmailRefreshTokenEncrypted, null);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (userIds.length) {
      const placeholders = userIds.map(() => '?').join(', ');
      await pool.execute(
        `DELETE FROM messages WHERE sender_id IN (${placeholders}) OR job_id IN (${jobIds.map(() => '?').join(', ') || "''"})`,
        [...userIds, ...jobIds],
      );
      if (applicationIds.length) {
        const applicationPlaceholders = applicationIds.map(() => '?').join(', ');
        await pool.execute(`DELETE FROM applications WHERE id IN (${applicationPlaceholders})`, applicationIds);
      }
      if (jobIds.length) {
        const jobPlaceholders = jobIds.map(() => '?').join(', ');
        await pool.execute(`DELETE FROM notifications WHERE job_id IN (${jobPlaceholders})`, jobIds);
        await pool.execute(`DELETE FROM jobs WHERE id IN (${jobPlaceholders})`, jobIds);
      }
      await pool.execute(`DELETE FROM notifications WHERE user_id IN (${placeholders})`, userIds);
      await pool.execute(`DELETE FROM company_documents WHERE user_id IN (${placeholders})`, userIds);
      await pool.execute(`DELETE FROM users WHERE id IN (${placeholders})`, userIds);
      const [remaining] = await pool.execute(`SELECT COUNT(*) AS count FROM users WHERE id IN (${placeholders})`, userIds);
      assert.equal(Number(remaining[0].count), 0, 'temporary MySQL users are removed');
    }
    await pool.end();
  }
});
