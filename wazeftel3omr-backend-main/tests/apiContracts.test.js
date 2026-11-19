process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-api-contract-test-secret';
process.env.RATE_LIMIT_MAX = '1000';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../src/models/User');
const Job = require('../src/models/Job');
const Application = require('../src/models/Application');

const applicantId = '64a000000000000000000001';
const employerId = '64a000000000000000000002';

const users = new Map([
  [applicantId, {
    _id: applicantId,
    id: applicantId,
    name: 'Test Applicant',
    email: 'applicant@example.test',
    role: 'job_seeker',
    accountStatus: 'active',
    company: '',
    jobTitle: 'Engineer',
    location: 'Cairo',
    avatar: '',
  }],
  [employerId, {
    _id: employerId,
    id: employerId,
    name: 'Test Employer',
    email: 'employer@example.test',
    role: 'employer',
    accountStatus: 'active',
    company: 'Test Company',
  }],
]);

User.findById = (id) => ({
  select() {
    return this;
  },
  lean: async () => users.get(String(id)) || null,
});
Job.find = () => ({ distinct: async () => [] });
Application.aggregate = async () => [];

const app = express();
app.use(express.json());
app.use('/api/auth', require('../src/routes/authRoutes'));
app.use('/api/applications', require('../src/routes/applicationRoutes'));
app.use('/api/admin', require('../src/routes/adminRoutes'));

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

const tokenFor = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '5m' });

const getJson = async (path, id) => {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: id ? { Authorization: `Bearer ${tokenFor(id)}` } : {},
  });
  return { response, body: await response.json() };
};

test('GET /api/auth/me preserves the existing authenticated user response contract', async () => {
  const { response, body } = await getJson('/api/auth/me', applicantId);
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    user: users.get(applicantId),
  });
});

test('login validation preserves the established error response contract', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invalid', password: '' }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.equal(body.message, 'صيغة البريد الإلكتروني غير صحيحة');
});

test('employer application statistics retain their response shape', async () => {
  const { response, body } = await getJson('/api/applications/employer/stats', employerId);
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    stats: {
      total: 0,
      pending: 0,
      reviewing: 0,
      interview: 0,
      accepted: 0,
      rejected: 0,
    },
  });
});

test('job seekers cannot access employer-only application statistics', async () => {
  const { response, body } = await getJson('/api/applications/employer/stats', applicantId);
  assert.equal(response.status, 403);
  assert.equal(body.success, false);
});

test('job seekers and employers cannot access admin dashboard routes', async () => {
  for (const id of [applicantId, employerId]) {
    const { response, body } = await getJson('/api/admin/stats', id);
    assert.equal(response.status, 403);
    assert.equal(body.success, false);
  }
});

test('protected API routes reject missing and invalid tokens', async () => {
  const anonymous = await getJson('/api/applications/employer/stats');
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.body.success, false);

  const invalid = await fetch(`${baseUrl}/api/applications/employer/stats`, {
    headers: { Authorization: 'Bearer invalid-token' },
  });
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).success, false);
});
