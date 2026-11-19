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

const enabled = process.env.MYSQL_STAGING_APPLICATIONS_TESTS === 'true';

test('MySQL staging application lifecycle, permissions, notifications, email, and statistics end-to-end', {
  skip: !enabled,
}, async (t) => {
  const databaseUrl = new URL(process.env.MYSQL_URL || '');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname.toLowerCase()),
    'Application integration tests are restricted to a local MySQL database');
  assert.match(databaseUrl.pathname, /staging/i, 'Application integration tests require a staging database');
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required');

  const pool = getMysqlPool();
  const users = createMysqlUserRepository(pool);
  const jobs = new MysqlJobRepository(pool);
  const applications = new MysqlApplicationRepository(pool);
  const sentEmails = [];
  let failNextEmail = false;
  const app = createMysqlStagingApp({
    pool,
    sendEmail: async (message) => {
      sentEmails.push(message);
      if (failNextEmail) {
        failNextEmail = false;
        return { sent: false, reason: 'STAGING_TEST_DELIVERY_FAILURE' };
      }
      return { sent: true, sender: 'staging-test@example.test', messageId: `test-${sentEmails.length}` };
    },
    sendJobStatusEmail: async () => ({ sent: true }),
  });
  const server = http.createServer(app);
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const createdUserIds = [];
  const createdJobIds = [];
  const createdApplicationIds = [];
  let employer;
  let otherEmployer;
  let admin;
  let seeker;
  let seekerTwo;
  let tokens;
  let baseUrl;

  const makeUser = async (role, tag = '', extra = {}) => {
    const user = await users.create({
      name: `Phase 5 ${role}`,
      email: `phase5-${role}${tag}-${suffix}@example.test`,
      password: 'StagePass123!',
      role,
      phone: role === 'employer' ? '01012345678' : '01012345679',
      accountStatus: 'active',
      cvUrl: role === 'job_seeker' ? `https://example.test/cv/${suffix}.pdf` : '',
      detailedAddress: 'MySQL Phase 5 Integration Test',
      ...extra,
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
  const makeJob = (title, overrides = {}) => ({
    title,
    company: `P5Company${suffix}`,
    location: 'Cairo Phase 5',
    jobType: 'دوام كامل',
    category: 'Phase 5 Applications',
    description: `Detailed description for ${title} with enough characters.`,
    requirements: ['SQL', 'Review applications'],
    salary: '100',
    level: 'متوسط',
    experience: '1-3 سنوات',
    qualifications: 'درجة جامعية',
    status: 'active',
    postedBy: employer._id,
    ...overrides,
  });
  const makeApplication = (user, overrides = {}) => ({
    name: user.name,
    email: user.email,
    phone: user.phone,
    location: 'Cairo',
    experience: '3 سنوات',
    skills: 'SQL, Testing',
    cvUrl: `https://example.test/application-cv/${user._id}.pdf`,
    linkedinUrl: 'https://linkedin.example.test/candidate',
    portfolioUrl: 'https://portfolio.example.test',
    githubUrl: 'https://github.example.test/candidate',
    expectedSalary: '25000',
    availability: 'فوري',
    notes: 'Application test notes',
    ...overrides,
  });
  const trackJob = (job) => {
    if (job?._id && !createdJobIds.includes(job._id)) createdJobIds.push(job._id);
    return job;
  };

  try {
    employer = await makeUser('employer', '-owner');
    otherEmployer = await makeUser('employer', '-other');
    admin = await makeUser('admin');
    seeker = await makeUser('job_seeker', '-primary');
    seekerTwo = await makeUser('job_seeker', '-secondary');
    tokens = {
      employer: issueToken(employer),
      otherEmployer: issueToken(otherEmployer),
      admin: issueToken(admin),
      seeker: issueToken(seeker),
      seekerTwo: issueToken(seekerTwo),
    };

    const job = trackJob(await jobs.create(makeJob(`P5-${suffix}-job`)));
    const closedJob = trackJob(await jobs.create(makeJob(`P5-${suffix}-closed`, { status: 'closed' })));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    await t.test('job seeker applies once, receives confirmation email, and duplicates are rejected', async () => {
      const applied = await request(`/api/applications/${job._id}`, {
        method: 'POST',
        token: tokens.seeker,
        body: makeApplication(seeker),
      });
      assert.equal(applied.response.status, 201);
      assert.equal(applied.body.success, true);
      assert.equal(applied.body.emailSent, true);
      assert.equal(applied.body.application.status, 'pending');
      assert.equal(applied.body.application.user, seeker._id);
      assert.equal(applied.body.application.job, job._id);
      assert.equal(Object.hasOwn(applied.body.application, 'cvUrl'), false);
      createdApplicationIds.push(applied.body.application._id);
      assert.equal(sentEmails.length, 1);
      assert.equal(sentEmails[0].email, seeker.email);
      assert.match(sentEmails[0].subject, new RegExp(job.title));

      const duplicate = await request(`/api/applications/${job._id}`, {
        method: 'POST',
        token: tokens.seeker,
        body: makeApplication(seeker),
      });
      assert.equal(duplicate.response.status, 400);
      assert.match(duplicate.body.message, /بالتقديم على هذه الوظيفة من قبل/);

      const closed = await request(`/api/applications/${closedJob._id}`, {
        method: 'POST',
        token: tokens.seekerTwo,
        body: makeApplication(seekerTwo),
      });
      assert.equal(closed.response.status, 404);
      assert.match(closed.body.message, /مغلقة أو غير متاحة/);

      const [notifications] = await pool.execute(
        `SELECT user_id AS userId, type, title, message FROM notifications
         WHERE application_id = ? ORDER BY created_at, id`,
        [applied.body.application._id],
      );
      assert.equal(notifications.length, 2);
      const byUserId = new Map(notifications.map((notification) => [notification.userId, notification]));
      assert.match(byUserId.get(employer._id).message, new RegExp(job.title));
      assert.match(byUserId.get(seeker._id).message, /تم إرسال طلب تقديمك/);
    });

    await t.test('seeker status list, filters, and real application statistics are scoped correctly', async () => {
      const list = await request('/api/applications', { token: tokens.seeker });
      assert.equal(list.response.status, 200);
      assert.equal(list.body.count, 1);
      assert.equal(list.body.applications[0].job._id, job._id);
      assert.equal(list.body.applications[0].job.logoUrl, '');
      assert.equal(Object.hasOwn(list.body.applications[0], 'cvUrl'), false);

      const pending = await request('/api/applications?status=pending', { token: tokens.seeker });
      assert.equal(pending.body.count, 1);
      const rejectedFilter = await request('/api/applications?status=rejected', { token: tokens.seeker });
      assert.equal(rejectedFilter.body.count, 0);

      const stats = await request('/api/applications/stats', { token: tokens.seeker });
      assert.equal(stats.response.status, 200, JSON.stringify(stats.body));
      assert.deepEqual(stats.body.stats, {
        applications: 1,
        accepted: 0,
        interviews: 0,
        reviewing: 1,
        rejected: 0,
      });

      const notSeekerStats = await request('/api/applications/stats', { token: tokens.employer });
      assert.equal(notSeekerStats.response.status, 403);
    });

    await t.test('employer reviews applications and unauthorized employers are denied', async () => {
      const jobApplications = await request(`/api/applications/job/${job._id}`, { token: tokens.employer });
      assert.equal(jobApplications.response.status, 200);
      assert.equal(jobApplications.body.count, 1);
      assert.equal(jobApplications.body.applications[0].user._id, seeker._id);
      assert.equal(jobApplications.body.applications[0].user.email, seeker.email);
      assert.equal(Object.hasOwn(jobApplications.body.applications[0], 'cvUrl'), false);

      const deniedJobList = await request(`/api/applications/job/${job._id}`, { token: tokens.otherEmployer });
      assert.equal(deniedJobList.response.status, 403);
      const deniedDetails = await request(
        `/api/applications/${createdApplicationIds[0]}/details`,
        { token: tokens.otherEmployer },
      );
      assert.equal(deniedDetails.response.status, 403);

      const details = await request(
        `/api/applications/${createdApplicationIds[0]}/details`,
        { token: tokens.employer },
      );
      assert.equal(details.response.status, 200);
      assert.equal(details.body.application.user._id, seeker._id);
      assert.equal(details.body.application.user.cvUrl, `https://example.test/cv/${suffix}.pdf`);
      assert.equal(details.body.application.job.postedBy, employer._id);

      const employerAll = await request('/api/applications/employer/all?page=1&limit=10', {
        token: tokens.employer,
      });
      assert.equal(employerAll.response.status, 200, JSON.stringify(employerAll.body));
      assert.equal(employerAll.body.total, 1);
      assert.equal(employerAll.body.applications[0].job._id, job._id);

      const summary = await request('/api/applications/all?summary=true', { token: tokens.employer });
      assert.equal(summary.response.status, 200);
      assert.equal(summary.body.total, 1);
      assert.equal(summary.body.interviewCount, 0);
      assert.equal(summary.body.activeJobsCount, 1);

      const employerStats = await request('/api/applications/employer/stats', { token: tokens.employer });
      assert.equal(employerStats.response.status, 200);
      assert.deepEqual(employerStats.body.stats, {
        total: 1,
        pending: 1,
        reviewing: 0,
        interview: 0,
        accepted: 0,
        rejected: 0,
      });
      const seekerDenied = await request('/api/applications/employer/stats', { token: tokens.seeker });
      assert.equal(seekerDenied.response.status, 403);
    });

    await t.test('interview status persists details, sends email, and notifies the applicant', async () => {
      const status = await request(`/api/applications/${createdApplicationIds[0]}/status`, {
        method: 'PUT',
        token: tokens.employer,
        body: {
          status: 'interview',
          notes: 'Review notes',
          interviewDetails: {
            date: '2026-11-20',
            time: '10:30',
            format: 'online',
            location: 'https://meet.example.test/phase5',
            notes: 'Please bring portfolio examples',
          },
        },
      });
      assert.equal(status.response.status, 200);
      assert.equal(status.body.emailSent, true);
      assert.equal(status.body.notificationSent, true);
      assert.equal(status.body.application.status, 'interview');
      assert.equal(status.body.application.interviewDetails.date, '2026-11-20');
      assert.equal(status.body.application.interviewDetails.format, 'online');
      assert.equal(sentEmails.length, 2);
      assert.equal(sentEmails[1].email, seeker.email);
      assert.match(sentEmails[1].html, /meet\.example\.test/);
      assert.match(sentEmails[1].html, /Please bring portfolio examples/);

      const [notifications] = await pool.execute(
        `SELECT title, message, interview_date AS interviewDate,
           interview_time AS interviewTime, interview_format AS interviewFormat,
           interview_location AS interviewLocation, interview_notes AS interviewNotes
         FROM notifications
         WHERE user_id = ? AND application_id = ? AND type = 'interview'`,
        [seeker._id, createdApplicationIds[0]],
      );
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].interviewDate, '2026-11-20');
      assert.equal(notifications[0].interviewFormat, 'online');
      assert.equal(notifications[0].interviewLocation, 'https://meet.example.test/phase5');
      assert.match(notifications[0].message, /الساعة 10:30/);

      const seekerApplications = await request('/api/applications?status=interview', {
        token: tokens.seeker,
      });
      assert.equal(seekerApplications.body.count, 1);
      assert.equal(seekerApplications.body.applications[0].status, 'interview');
      assert.equal(seekerApplications.body.applications[0].interviewDetails.date, '2026-11-20');

      const seekerStats = await request('/api/applications/stats', { token: tokens.seeker });
      assert.equal(seekerStats.body.stats.interviews, 1);
      const employerStats = await request('/api/applications/employer/stats', { token: tokens.employer });
      assert.equal(employerStats.body.stats.interview, 1);
    });

    await t.test('only the owner or admin may change status; final email failures can be retried', async () => {
      const forbidden = await request(`/api/applications/${createdApplicationIds[0]}/status`, {
        method: 'PUT',
        token: tokens.otherEmployer,
        body: { status: 'accepted' },
      });
      assert.equal(forbidden.response.status, 403);

      const seekerUpdate = await request(`/api/applications/${createdApplicationIds[0]}/status`, {
        method: 'PUT',
        token: tokens.seeker,
        body: { status: 'accepted' },
      });
      assert.equal(seekerUpdate.response.status, 403);

      failNextEmail = true;
      const failedDecisionEmail = await request(`/api/applications/${createdApplicationIds[0]}/status`, {
        method: 'PUT',
        token: tokens.employer,
        body: { status: 'accepted', decisionMessage: 'Welcome to the team!' },
      });
      assert.equal(failedDecisionEmail.response.status, 502);
      assert.equal(failedDecisionEmail.body.decisionRecorded, true);
      assert.equal(failedDecisionEmail.body.emailSent, false);
      assert.equal(failedDecisionEmail.body.notificationSent, true);

      const retry = await request(`/api/applications/${createdApplicationIds[0]}/status`, {
        method: 'PUT',
        token: tokens.employer,
        body: { status: 'accepted', decisionMessage: 'Welcome to the team!' },
      });
      assert.equal(retry.response.status, 200);
      assert.equal(retry.body.emailSent, true);
      assert.equal(retry.body.application.decisionEmailSent, true);
      assert.equal(retry.body.application.user._id, seeker._id);
      assert.equal(retry.body.application.job._id, job._id);

      const finalStatusChange = await request(`/api/applications/${createdApplicationIds[0]}/status`, {
        method: 'PUT',
        token: tokens.admin,
        body: { status: 'rejected' },
      });
      assert.equal(finalStatusChange.response.status, 409);

      const [notifications] = await pool.execute(
        `SELECT COUNT(*) AS count FROM notifications
         WHERE user_id = ? AND application_id = ? AND type = 'accepted'`,
        [seeker._id, createdApplicationIds[0]],
      );
      assert.equal(Number(notifications[0].count), 1);
      const seekerApplications = await request('/api/applications', { token: tokens.seeker });
      assert.equal(seekerApplications.body.applications[0].status, 'accepted');
      const stats = await request('/api/applications/stats', { token: tokens.seeker });
      assert.equal(stats.body.stats.accepted, 1);
      assert.equal(stats.body.stats.applications, 1);
    });

    await t.test('admin sees real application lists, changes status, and reads actual dashboard statistics', async () => {
      failNextEmail = true;
      const secondApplication = await request(`/api/applications/${job._id}`, {
        method: 'POST',
        token: tokens.seekerTwo,
        body: makeApplication(seekerTwo),
      });
      assert.equal(secondApplication.response.status, 201);
      assert.equal(secondApplication.body.emailSent, false);
      createdApplicationIds.push(secondApplication.body.application._id);
      const [secondNotifications] = await pool.execute(
        'SELECT COUNT(*) AS count FROM notifications WHERE application_id = ?',
        [secondApplication.body.application._id],
      );
      assert.equal(Number(secondNotifications[0].count), 2);

      const adminUpdate = await request(
        `/api/applications/${secondApplication.body.application._id}/status`,
        {
          method: 'PUT',
          token: tokens.admin,
          body: { status: 'reviewing', notes: 'Admin review' },
        },
      );
      assert.equal(adminUpdate.response.status, 200);
      assert.equal(adminUpdate.body.application.status, 'reviewing');
      assert.equal(adminUpdate.body.application.notes, 'Admin review');
      assert.equal(adminUpdate.body.emailSent, true);

      const adminApplications = await request(
        `/api/admin/applications?status=accepted&search=${encodeURIComponent(seeker.email)}&page=1&limit=2`,
        { token: tokens.admin },
      );
      assert.equal(adminApplications.response.status, 200);
      assert.ok(adminApplications.body.total >= 1);
      assert.ok(adminApplications.body.applications.some((appRecord) => (
        appRecord._id === createdApplicationIds[0]
      )));

      const applicationStats = await request('/api/admin/applications/stats', { token: tokens.admin });
      assert.equal(applicationStats.response.status, 200);
      assert.ok(applicationStats.body.stats.total >= 1);
      assert.ok(applicationStats.body.stats.accepted >= 1);
      assert.ok(applicationStats.body.stats.reviewing >= 1);

      await pool.execute(
        'UPDATE applications SET created_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY) WHERE id = ?',
        [createdApplicationIds[0]],
      );
      const dashboard = await request('/api/admin/stats', { token: tokens.admin });
      assert.equal(dashboard.response.status, 200);
      assert.ok(dashboard.body.stats.totalApplications >= 1);
      assert.ok(dashboard.body.stats.applicationStatuses.accepted >= 1);
      assert.ok(dashboard.body.stats.applicationStatuses.reviewing >= 1);
      assert.ok(Array.isArray(dashboard.body.activities));
      assert.ok(dashboard.body.activities.some(
        (activity) => activity.id === `app_${createdApplicationIds[0]}`,
      ));
      assert.ok(dashboard.body.activities.length <= 8);
      assert.ok(dashboard.body.activities.every((activity) => (
        ['job', 'application', 'report'].includes(activity.type)
        && typeof activity.id === 'string'
        && typeof activity.text === 'string'
        && typeof activity.subText === 'string'
      )));

      for (const token of [tokens.seeker, tokens.employer]) {
        const denied = await request('/api/admin/applications/stats', { token });
        assert.equal(denied.response.status, 403);
      }
    });
  } finally {
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
      await pool.execute(`DELETE FROM notifications WHERE user_id IN (${placeholders})`, createdUserIds);
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
