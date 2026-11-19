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
const { MysqlCommunicationRepository } = require('../src/db/mysqlCommunicationRepository');
const { createMysqlStagingApp } = require('../src/createMysqlStagingApp');

const enabled = process.env.MYSQL_STAGING_COMMUNICATION_TESTS === 'true';

test('MySQL staging notifications, messaging, reports, and admin notification states end-to-end', {
  skip: !enabled,
}, async (t) => {
  const databaseUrl = new URL(process.env.MYSQL_URL || '');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname.toLowerCase()),
    'Communication integration tests are restricted to a local MySQL database');
  assert.match(databaseUrl.pathname, /staging/i, 'Communication integration tests require a staging database');
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required');

  const pool = getMysqlPool();
  const users = createMysqlUserRepository(pool);
  const jobs = new MysqlJobRepository(pool);
  const applications = new MysqlApplicationRepository(pool);
  const communication = new MysqlCommunicationRepository(pool);
  const app = createMysqlStagingApp({
    pool,
    communication,
    sendEmail: async () => ({ sent: true, sender: 'staging-test@example.test' }),
    sendJobStatusEmail: async () => ({ sent: true }),
  });
  const server = http.createServer(app);
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const createdUserIds = [];
  const createdJobIds = [];
  const createdApplicationIds = [];
  const createdReportIds = [];
  let baseUrl;
  let employer;
  let otherEmployer;
  let pendingEmployer;
  let admin;
  let seeker;
  let otherSeeker;
  let tokens;
  let application;
  let job;

  const makeUser = async (role, tag, overrides = {}) => {
    const user = await users.create({
      name: `Phase 6 ${role}`,
      email: `phase6-${role}-${tag}-${suffix}@example.test`,
      password: 'StagePass123!',
      role,
      phone: '01012345678',
      accountStatus: 'active',
      cvUrl: role === 'job_seeker' ? `https://example.test/phase6/${suffix}.pdf` : '',
      detailedAddress: 'MySQL Phase 6 Integration Test',
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

  try {
    employer = await makeUser('employer', 'owner', { company: `P6 Company ${suffix}` });
    otherEmployer = await makeUser('employer', 'other');
    pendingEmployer = await makeUser('employer', 'pending', { accountStatus: 'reviewing' });
    admin = await makeUser('admin', 'admin');
    seeker = await makeUser('job_seeker', 'candidate');
    otherSeeker = await makeUser('job_seeker', 'other-candidate');
    tokens = {
      employer: issueToken(employer),
      otherEmployer: issueToken(otherEmployer),
      admin: issueToken(admin),
      seeker: issueToken(seeker),
      otherSeeker: issueToken(otherSeeker),
    };

    job = await jobs.create({
      title: `P6 ${suffix} Engineer`,
      company: employer.company,
      location: 'Cairo',
      jobType: 'دوام كامل',
      category: 'Phase 6',
      description: 'A sufficiently detailed description for the Phase 6 integration test.',
      requirements: ['Messaging', 'Reports'],
      salary: '100',
      level: 'متوسط',
      experience: '1-3 سنوات',
      qualifications: 'درجة جامعية',
      status: 'reviewing',
      postedBy: employer._id,
    });
    createdJobIds.push(job._id);
    const activeJob = await jobs.create({
      title: `P6 ${suffix} Active Engineer`,
      company: employer.company,
      location: 'Cairo',
      jobType: 'دوام كامل',
      category: 'Phase 6',
      description: 'An active posting with enough detail for a job application.',
      requirements: ['Messaging'],
      salary: '100',
      level: 'متوسط',
      experience: '1-3 سنوات',
      qualifications: 'درجة جامعية',
      status: 'active',
      postedBy: employer._id,
    });
    createdJobIds.push(activeJob._id);
    application = await applications.create({
      user: seeker,
      jobId: activeJob._id,
      input: {
        name: seeker.name,
        email: seeker.email,
        phone: seeker.phone,
        location: 'Cairo',
        experience: '3 سنوات',
        skills: 'SQL, integration testing',
        cvUrl: seeker.cvUrl,
        linkedinUrl: '',
        portfolioUrl: '',
        githubUrl: '',
        expectedSalary: '',
        availability: 'فوري',
        notes: '',
      },
    });
    createdApplicationIds.push(application._id);

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    await t.test('notifications are created, populated, user-scoped, and support read/unread and deletion', async () => {
      const created = await request('/api/notifications', { token: tokens.seeker });
      assert.equal(created.response.status, 200);
      assert.ok(created.body.count >= 1);
      assert.ok(created.body.notifications.some((item) => item.application?._id === application._id));
      const applicationNotice = created.body.notifications.find((item) => item.application?._id === application._id);
      assert.equal(applicationNotice.job._id, activeJob._id);
      assert.equal(applicationNotice.isRead, false);

      const countOnly = await request('/api/notifications?countOnly=true', { token: tokens.seeker });
      assert.equal(countOnly.body.count, 0);
      assert.equal(countOnly.body.notifications.length, 0);
      assert.ok(countOnly.body.unreadCount >= 1);

      const notOwned = await request(`/api/notifications/${applicationNotice._id}/read`, {
        method: 'PUT',
        token: tokens.otherSeeker,
      });
      assert.equal(notOwned.response.status, 404);
      const marked = await request(`/api/notifications/${applicationNotice._id}/read`, {
        method: 'PUT',
        token: tokens.seeker,
      });
      assert.equal(marked.response.status, 200);
      assert.equal(marked.body.notification.isRead, true);
      const alreadyRead = await request(`/api/notifications/${applicationNotice._id}/read`, {
        method: 'PUT',
        token: tokens.seeker,
      });
      assert.equal(alreadyRead.response.status, 200);
      assert.equal(alreadyRead.body.notification.isRead, true);

      await request('/api/notifications/read-all', { method: 'PUT', token: tokens.seeker });
      const afterReadAll = await request('/api/notifications?countOnly=true', { token: tokens.seeker });
      assert.equal(afterReadAll.body.unreadCount, 0);

      const employerList = await request('/api/notifications', { token: tokens.employer });
      assert.ok(employerList.body.notifications.some((item) => item.application?._id === application._id));
      const employerNotice = employerList.body.notifications.find((item) => item.application?._id === application._id);
      const removed = await request('/api/notifications/bulk-delete', {
        method: 'POST',
        token: tokens.employer,
        body: { ids: [employerNotice._id] },
      });
      assert.equal(removed.response.status, 200);
      assert.equal(removed.body.deletedCount, 1);
      const stillThereForSeeker = await request(`/api/notifications/${applicationNotice._id}`, {
        method: 'DELETE',
        token: tokens.seeker,
      });
      assert.equal(stillThereForSeeker.response.status, 200);
    });

    await t.test('applicant, employer, and admin messaging preserves conversation permissions and read state', async () => {
      const sent = await request(`/api/messages/${application._id}`, {
        method: 'POST',
        token: tokens.seeker,
        body: { content: '  Could we discuss the role?  ' },
      });
      assert.equal(sent.response.status, 201);
      assert.equal(sent.body.message.content, 'Could we discuss the role?');
      assert.equal(sent.body.message.sender._id, seeker._id);
      const [storedMessage] = await pool.execute(
        'SELECT id, is_read AS isRead FROM messages WHERE application_id = ?',
        [application._id],
      );
      assert.equal(storedMessage.length, 1);

      const forbiddenEmployer = await request(`/api/messages/${application._id}`, {
        token: tokens.otherEmployer,
      });
      assert.equal(forbiddenEmployer.response.status, 403);
      const forbiddenSeeker = await request(`/api/messages/${application._id}`, {
        method: 'POST',
        token: tokens.otherSeeker,
        body: { content: 'Unauthorized message' },
      });
      assert.equal(forbiddenSeeker.response.status, 403);

      const receivedNotice = await request('/api/notifications', { token: tokens.employer });
      const messageNotice = receivedNotice.body.notifications.find((item) => item.type === 'message');
      assert.ok(messageNotice);
      assert.equal(messageNotice.application._id, application._id);

      const employerReply = await request(`/api/messages/${application._id}`, {
        method: 'POST',
        token: tokens.employer,
        body: { content: 'Thank you, let us schedule a call.' },
      });
      assert.equal(employerReply.response.status, 201);
      const conversation = await request(`/api/messages/${application._id}`, { token: tokens.seeker });
      assert.equal(conversation.response.status, 200);
      assert.equal(conversation.body.count, 2);
      assert.equal(conversation.body.chatDetails.isApplicant, true);
      assert.equal(conversation.body.chatDetails.job.title, activeJob.title);
      assert.equal(conversation.body.chatDetails.applicant.name, seeker.name);
      assert.ok(conversation.body.messages.every((item) => item.sender._id));
      assert.equal(conversation.body.messages[0].sender.role, 'job_seeker');
      assert.equal(conversation.body.messages[0].senderRole, 'job_seeker');
      const [readRows] = await pool.execute(
        'SELECT COUNT(*) AS count FROM messages WHERE application_id = ? AND sender_id <> ? AND is_read = TRUE',
        [application._id, seeker._id],
      );
      assert.equal(Number(readRows[0].count), 1);

      const adminConversation = await request(`/api/messages/${application._id}`, { token: tokens.admin });
      assert.equal(adminConversation.response.status, 200);
      assert.equal(adminConversation.body.chatDetails.isApplicant, false);
      assert.equal(adminConversation.body.chatDetails.isJobPoster, false);
      const blank = await request(`/api/messages/${application._id}`, {
        method: 'POST',
        token: tokens.seeker,
        body: { content: '   ' },
      });
      assert.equal(blank.response.status, 400);
    });

    await t.test('reports support seeker and employer submission, private retrieval, admin filtering, and status notices', async () => {
      const seekerReport = await request('/api/reports', {
        method: 'POST',
        token: tokens.seeker,
        body: {
          type: 'complaint',
          subject: `P6 report ${suffix}`,
          message: 'A detailed report submitted by a job seeker.',
          relatedJob: job._id,
        },
      });
      assert.equal(seekerReport.response.status, 201);
      assert.equal(seekerReport.body.report.status, 'pending');
      assert.equal(seekerReport.body.report.user, seeker._id);
      assert.equal(seekerReport.body.report.relatedJob, job._id);
      createdReportIds.push(seekerReport.body.report._id);

      const employerReport = await request('/api/reports', {
        method: 'POST',
        token: tokens.employer,
        body: {
          type: 'suggestion',
          subject: `P6 suggestion ${suffix}`,
          message: 'A detailed suggestion submitted by an employer.',
        },
      });
      assert.equal(employerReport.response.status, 201);
      createdReportIds.push(employerReport.body.report._id);

      const ownReports = await request('/api/reports/mine', { token: tokens.seeker });
      assert.equal(ownReports.response.status, 200);
      assert.equal(ownReports.body.count, 1);
      assert.equal(ownReports.body.reports[0]._id, seekerReport.body.report._id);
      const otherReports = await request('/api/reports/mine', { token: tokens.otherSeeker });
      assert.equal(otherReports.body.count, 0);

      const invalid = await request('/api/reports', {
        method: 'POST',
        token: tokens.seeker,
        body: { type: 'invalid', subject: 'x', message: 'short' },
      });
      assert.equal(invalid.response.status, 400);
      const deniedList = await request('/api/admin/reports', { token: tokens.employer });
      assert.equal(deniedList.response.status, 403);

      const adminList = await request(`/api/admin/reports?type=complaint&search=${encodeURIComponent(suffix)}`, {
        token: tokens.admin,
      });
      assert.equal(adminList.response.status, 200);
      assert.ok(adminList.body.reports.some((report) => report._id === seekerReport.body.report._id));
      assert.equal(adminList.body.reports.find((report) => report._id === seekerReport.body.report._id).user._id, seeker._id);
      assert.ok(adminList.body.stats.complaintCount >= 1);
      const updated = await request(`/api/admin/reports/${seekerReport.body.report._id}/status`, {
        method: 'PUT',
        token: tokens.admin,
        body: { status: 'reviewing' },
      });
      assert.equal(updated.response.status, 200);
      assert.equal(updated.body.report.status, 'reviewing');
      const resolved = await request(`/api/admin/reports/${seekerReport.body.report._id}/status`, {
        method: 'PUT',
        token: tokens.admin,
        body: { status: 'resolved', adminReply: 'We reviewed your report.' },
      });
      assert.equal(resolved.response.status, 200);
      assert.equal(resolved.body.report.adminReply, 'We reviewed your report.');
      const reportNotice = await request('/api/notifications', { token: tokens.seeker });
      assert.ok(reportNotice.body.notifications.some((item) => item.message === 'We reviewed your report.'));
      const invalidStatus = await request(`/api/admin/reports/${seekerReport.body.report._id}/status`, {
        method: 'PUT',
        token: tokens.admin,
        body: { status: 'closed' },
      });
      assert.equal(invalidStatus.response.status, 400);
    });

    await t.test('admin notification states filter pending work and are private to each admin', async () => {
      const notifications = await request('/api/admin/notifications', { token: tokens.admin });
      assert.equal(notifications.response.status, 200);
      assert.ok(notifications.body.pendingJobs.some((item) => item._id === job._id));
      assert.ok(notifications.body.newCompanies.some((item) => item._id === pendingEmployer._id));
      const report = createdReportIds[1];
      assert.ok(notifications.body.reports.some((item) => item._id === report));
      assert.ok(notifications.body.counts.jobs >= 1);
      assert.ok(notifications.body.unreadCounts.reports >= 1);

      const reportKey = `report:${report}`;
      const markRead = await request('/api/admin/notifications/state', {
        method: 'PUT',
        token: tokens.admin,
        body: { keys: [reportKey, reportKey], action: 'read' },
      });
      assert.equal(markRead.response.status, 200);
      assert.equal(markRead.body.updatedCount, 1);
      const unreadCount = await request('/api/admin/notifications/count', { token: tokens.admin });
      assert.ok(unreadCount.body.unreadCount < notifications.body.unreadCount);

      const adminScoped = await request('/api/admin/notifications', { token: tokens.otherSeeker });
      assert.equal(adminScoped.response.status, 403);
      const invalidKeys = await request('/api/admin/notifications/state', {
        method: 'PUT',
        token: tokens.admin,
        body: { keys: ['application:not-an-id'], action: 'delete' },
      });
      assert.equal(invalidKeys.response.status, 400);
      const hideReport = await request('/api/admin/notifications/state', {
        method: 'PUT',
        token: tokens.admin,
        body: { keys: [reportKey], action: 'delete' },
      });
      assert.equal(hideReport.response.status, 200);
      const afterDelete = await request('/api/admin/notifications', { token: tokens.admin });
      assert.ok(!afterDelete.body.reports.some((item) => item._id === report));
      const [stateRows] = await pool.execute(
        'SELECT is_read AS isRead, is_deleted AS isDeleted FROM admin_notification_states WHERE admin_id = ? AND notification_key = ?',
        [admin._id, reportKey],
      );
      assert.equal(Boolean(stateRows[0].isRead), true);
      assert.equal(Boolean(stateRows[0].isDeleted), true);
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
