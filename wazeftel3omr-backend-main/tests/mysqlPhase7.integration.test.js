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
const { createMysqlStagingApp } = require('../src/createMysqlStagingApp');

const enabled = process.env.MYSQL_STAGING_PHASE7_TESTS === 'true';

test('MySQL staging Phase 7 admin search, role dashboards, statistics, filters, and access boundaries', {
  skip: !enabled,
}, async (t) => {
  const databaseUrl = new URL(process.env.MYSQL_URL || '');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname.toLowerCase()),
    'Phase 7 integration tests are restricted to a local MySQL database');
  assert.match(databaseUrl.pathname, /staging/i, 'Phase 7 integration tests require a staging database');
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required');

  const pool = getMysqlPool();
  const users = createMysqlUserRepository(pool);
  const jobs = new MysqlJobRepository(pool);
  const applications = new MysqlApplicationRepository(pool);
  const app = createMysqlStagingApp({
    pool,
    sendEmail: async () => ({ sent: true, sender: 'staging-test@example.test' }),
    sendJobStatusEmail: async () => ({ sent: true }),
  });
  const server = http.createServer(app);
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const searchWord = `p7lookup${suffix}`;
  const createdUserIds = [];
  const createdJobIds = [];
  const createdApplicationIds = [];
  const createdReportIds = [];
  let baseUrl;
  let admin;
  let employer;
  let otherEmployer;
  let seeker;
  let secondSeeker;
  let tokens;
  let activeJobs;
  let seekerApplication;

  const makeUser = async (role, tag, overrides = {}) => {
    const user = await users.create({
      name: `${searchWord} ${role} ${tag}`,
      email: `${searchWord}-${role}-${tag}@example.test`,
      password: 'StagePass123!',
      role,
      phone: `010${String(Date.now()).slice(-8)}`,
      company: role === 'employer' ? `${searchWord} Company ${tag}` : '',
      accountStatus: 'active',
      cvUrl: role === 'job_seeker' ? `https://example.test/phase7/${suffix}.pdf` : '',
      detailedAddress: 'MySQL Phase 7 Integration Test',
      ...overrides,
    });
    createdUserIds.push(user._id);
    return user;
  };
  const issueToken = (user) => jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '10m' });
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
  const createJob = async (poster, title, status = 'active') => {
    const job = await jobs.create({
      title,
      company: poster.company || `P7 ${searchWord}`,
      location: 'Cairo Phase 7',
      jobType: 'دوام كامل',
      category: `Phase 7 ${searchWord}`,
      description: `Detailed description containing ${searchWord} for real database search and filtering.`,
      requirements: ['MySQL', 'Role dashboards'],
      salary: '25000',
      level: 'متوسط',
      experience: '1-3 سنوات',
      qualifications: 'درجة جامعية',
      status,
      postedBy: poster._id,
    });
    createdJobIds.push(job._id);
    return job;
  };

  try {
    admin = await makeUser('admin', 'operator');
    employer = await makeUser('employer', 'primary');
    otherEmployer = await makeUser('employer', 'other');
    seeker = await makeUser('job_seeker', 'candidate-one');
    secondSeeker = await makeUser('job_seeker', 'candidate-two');
    tokens = {
      admin: issueToken(admin),
      employer: issueToken(employer),
      otherEmployer: issueToken(otherEmployer),
      seeker: issueToken(seeker),
      secondSeeker: issueToken(secondSeeker),
    };

    activeJobs = [
      await createJob(employer, `P7 ${searchWord} active alpha`),
      await createJob(employer, `P7 ${searchWord} active beta`),
      await createJob(employer, `P7 ${searchWord} active gamma`),
    ];
    const pendingJob = await createJob(employer, `P7 ${searchWord} pending job`, 'reviewing');
    const otherEmployerJob = await createJob(otherEmployer, `P7 ${searchWord} other employer job`);
    const sortFixtureIds = [...activeJobs, otherEmployerJob];
    for (const [index, fixtureJob] of sortFixtureIds.entries()) {
      await pool.execute(
        'UPDATE jobs SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND) WHERE id = ?',
        [sortFixtureIds.length - index, fixtureJob._id],
      );
    }

    await applications.create({
      user: seeker,
      jobId: activeJobs[0]._id,
      input: {
        name: seeker.name,
        email: seeker.email,
        phone: seeker.phone,
        location: 'Cairo',
        experience: '3 years',
        skills: 'SQL, integration tests',
        cvUrl: seeker.cvUrl,
        linkedinUrl: '',
        portfolioUrl: '',
        githubUrl: '',
        expectedSalary: '',
        availability: 'Immediate',
        notes: '',
      },
    }).then((record) => {
      seekerApplication = record;
      createdApplicationIds.push(record._id);
    });
    const secondApplication = await applications.create({
      user: secondSeeker,
      jobId: activeJobs[1]._id,
      input: {
        name: secondSeeker.name,
        email: secondSeeker.email,
        phone: secondSeeker.phone,
        location: 'Cairo',
        experience: '2 years',
        skills: 'SQL',
        cvUrl: secondSeeker.cvUrl,
        linkedinUrl: '',
        portfolioUrl: '',
        githubUrl: '',
        expectedSalary: '',
        availability: 'Immediate',
        notes: '',
      },
    });
    createdApplicationIds.push(secondApplication._id);

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    await t.test('admin account search is role-protected, literal, bounded, and response-compatible', async () => {
      const shortQuery = await request('/api/admin/account-search?search=x', { token: tokens.admin });
      assert.equal(shortQuery.response.status, 400);
      assert.equal(shortQuery.body.success, false);

      const found = await request(`/api/admin/account-search?search=${encodeURIComponent(searchWord.toUpperCase())}`, {
        token: tokens.admin,
      });
      assert.equal(found.response.status, 200);
      assert.equal(found.body.success, true);
      assert.equal(found.body.count, found.body.users.length);
      assert.ok(found.body.users.length <= 8);
      assert.ok(found.body.users.some((user) => user._id === employer._id && user.role === 'employer'));
      assert.ok(found.body.users.some((user) => user._id === seeker._id && user.role === 'job_seeker'));
      assert.ok(found.body.users.every((user) => user._id !== admin._id));
      assert.ok(found.body.users.every((user) => (
        ['_id', 'name', 'email', 'role', 'phone', 'company', 'accountStatus', 'createdAt', 'isVerified']
          .every((field) => Object.hasOwn(user, field))
      )));

      for (const token of [tokens.seeker, tokens.employer]) {
        const denied = await request('/api/admin/account-search?search=phase', { token });
        assert.equal(denied.response.status, 403);
      }
      const anonymous = await request('/api/admin/account-search?search=phase');
      assert.equal(anonymous.response.status, 401);
    });

    await t.test('admin dashboard reports real cross-role stats, activities, and admin-only resources', async () => {
      await pool.execute(
        'UPDATE jobs SET created_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY) WHERE id = ?',
        [pendingJob._id],
      );
      await pool.execute(
        'UPDATE applications SET created_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY) WHERE id = ?',
        [seekerApplication._id],
      );
      const dashboard = await request('/api/admin/stats', { token: tokens.admin });
      assert.equal(dashboard.response.status, 200);
      assert.ok(dashboard.body.stats.totalSeekers >= 2);
      assert.ok(dashboard.body.stats.totalEmployers >= 2);
      assert.ok(dashboard.body.stats.totalJobs >= 5);
      assert.ok(dashboard.body.stats.totalApplications >= 2);
      assert.ok(dashboard.body.stats.reviewingJobs >= 1);
      assert.ok(dashboard.body.stats.applicationStatuses.pending >= 2);
      assert.ok(Array.isArray(dashboard.body.activities));
      assert.ok(dashboard.body.activities.some(
        (activity) => activity.id === `job_${pendingJob._id}`,
      ));
      assert.ok(dashboard.body.activities.some(
        (activity) => activity.id === `app_${seekerApplication._id}`,
      ));
      assert.ok(dashboard.body.activities.length <= 8);
      assert.ok(dashboard.body.activities.every((activity) => (
        ['job', 'application', 'report'].includes(activity.type)
        && typeof activity.id === 'string'
        && typeof activity.text === 'string'
        && typeof activity.subText === 'string'
      )));

      const adminApplicationStats = await request('/api/admin/applications/stats', { token: tokens.admin });
      assert.equal(adminApplicationStats.response.status, 200);
      assert.ok(adminApplicationStats.body.stats.total >= 2);
      const adminReports = await request('/api/admin/reports?search=not-found-p7', { token: tokens.admin });
      assert.equal(adminReports.response.status, 200);
      assert.equal(adminReports.body.count, 0);
      assert.equal(adminReports.body.pages, 1);
      for (const token of [tokens.seeker, tokens.employer]) {
        const denied = await request('/api/admin/stats', { token });
        assert.equal(denied.response.status, 403);
      }
    });

    await t.test('job seeker dashboard data and filters remain limited to the signed-in seeker', async () => {
      const profile = await request('/api/seeker/profile', { token: tokens.seeker });
      assert.equal(profile.response.status, 200);
      assert.equal(profile.body.user._id, seeker._id);
      assert.equal(profile.body.user.role, 'job_seeker');

      const applicationsList = await request('/api/seeker/applications?status=pending', { token: tokens.seeker });
      assert.equal(applicationsList.response.status, 200);
      assert.equal(applicationsList.body.count, 1);
      assert.equal(applicationsList.body.applications[0]._id, seekerApplication._id);
      assert.equal(applicationsList.body.applications[0].job._id, activeJobs[0]._id);
      const stats = await request('/api/seeker/applications/stats', { token: tokens.seeker });
      assert.equal(stats.response.status, 200);
      assert.equal(stats.body.stats.applications, 1);
      assert.equal(stats.body.stats.reviewing, 1);
      const notifications = await request('/api/seeker/notifications', { token: tokens.seeker });
      assert.equal(notifications.response.status, 200);
      assert.ok(notifications.body.notifications.some((item) => item.application?._id === seekerApplication._id));
      const otherProfileData = await request('/api/applications', { token: tokens.secondSeeker });
      assert.equal(otherProfileData.body.count, 1);
      assert.notEqual(otherProfileData.body.applications[0]._id, seekerApplication._id);

      for (const path of ['/api/applications/employer/stats', '/api/admin/applications']) {
        const denied = await request(path, { token: tokens.seeker });
        assert.equal(denied.response.status, 403);
      }
    });

    await t.test('employer dashboard data is owned-job scoped with accurate filters and pagination', async () => {
      const ownedJobs = await request('/api/employer/jobs/mine', { token: tokens.employer });
      assert.equal(ownedJobs.response.status, 200);
      assert.ok(ownedJobs.body.jobs.some((record) => record._id === pendingJob._id));
      assert.ok(!ownedJobs.body.jobs.some((record) => record._id === otherEmployerJob._id));

      const allApplicants = await request('/api/employer/applicants/all?page=1&limit=1', {
        token: tokens.employer,
      });
      assert.equal(allApplicants.response.status, 200);
      assert.equal(allApplicants.body.count, 1);
      assert.equal(allApplicants.body.total, 2);
      assert.equal(allApplicants.body.pages, 2);
      const filtered = await request('/api/employer/applicants/all?status=pending', {
        token: tokens.employer,
      });
      assert.equal(filtered.response.status, 200);
      assert.equal(filtered.body.total, 2);
      const employerStats = await request('/api/seeker/applications/employer/stats', { token: tokens.employer });
      assert.equal(employerStats.response.status, 200);
      assert.equal(employerStats.body.stats.total, 2);

      const otherEmployerApps = await request('/api/employer/applicants/all', {
        token: tokens.otherEmployer,
      });
      assert.equal(otherEmployerApps.response.status, 200);
      assert.equal(otherEmployerApps.body.total, 0);
      const seekerDenied = await request('/api/employer/applicants/all', { token: tokens.seeker });
      assert.equal(seekerDenied.response.status, 403);
    });

    await t.test('public search, filters, sort order, pagination, and relationship counts use MySQL rows', async () => {
      const newest = await request(
        `/api/jobs?search=${encodeURIComponent(searchWord)}&category=${encodeURIComponent(`Phase 7 ${searchWord}`)}&page=1&limit=1&sortBy=newest`,
      );
      assert.equal(newest.response.status, 200);
      assert.equal(newest.body.count, 1);
      assert.equal(newest.body.total, 4);
      assert.equal(newest.body.pages, 4);
      assert.equal(newest.body.jobs[0]._id, otherEmployerJob._id);

      const oldest = await request(
        `/api/jobs?search=${encodeURIComponent(searchWord)}&page=1&limit=1&sortBy=oldest`,
      );
      assert.equal(oldest.response.status, 200);
      assert.equal(oldest.body.total, 4);
      assert.equal(oldest.body.jobs[0]._id, activeJobs[0]._id);

      const byLocation = await request(
        `/api/jobs?search=${encodeURIComponent(searchWord)}&location=Cairo%20Phase%207&jobType=${encodeURIComponent('دوام كامل')}`,
      );
      assert.equal(byLocation.response.status, 200);
      assert.equal(byLocation.body.total, 4);
      const applicationsForOwnedJob = await request(`/api/applications/job/${activeJobs[0]._id}`, {
        token: tokens.employer,
      });
      assert.equal(applicationsForOwnedJob.response.status, 200);
      assert.equal(applicationsForOwnedJob.body.count, 1);
      assert.equal(applicationsForOwnedJob.body.applications[0].user._id, seeker._id);
      const unauthorizedJobApplicants = await request(`/api/applications/job/${activeJobs[0]._id}`, {
        token: tokens.otherEmployer,
      });
      assert.equal(unauthorizedJobApplicants.response.status, 403);
    });
  } finally {
    if (createdReportIds.length) {
      const placeholders = createdReportIds.map(() => '?').join(', ');
      await pool.execute(`DELETE FROM reports WHERE id IN (${placeholders})`, createdReportIds);
    }
    if (createdUserIds.length) {
      const placeholders = createdUserIds.map(() => '?').join(', ');
      await pool.execute(`DELETE FROM admin_notification_states WHERE admin_id IN (${placeholders})`, createdUserIds);
      await pool.execute(`DELETE FROM notifications WHERE user_id IN (${placeholders})`, createdUserIds);
    }
    if (createdApplicationIds.length) {
      const placeholders = createdApplicationIds.map(() => '?').join(', ');
      await pool.execute(`DELETE FROM applications WHERE id IN (${placeholders})`, createdApplicationIds);
    }
    if (createdJobIds.length) {
      const placeholders = createdJobIds.map(() => '?').join(', ');
      await pool.execute(`DELETE FROM jobs WHERE id IN (${placeholders})`, createdJobIds);
    }
    if (createdUserIds.length) {
      const placeholders = createdUserIds.map(() => '?').join(', ');
      await pool.execute(`DELETE FROM users WHERE id IN (${placeholders})`, createdUserIds);
    }
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});
