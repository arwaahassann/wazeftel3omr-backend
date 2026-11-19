require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { getMysqlPool } = require('../src/config/mysql');
const { createMysqlUserRepository } = require('../src/db/mysqlUserRepository');
const { MysqlJobRepository } = require('../src/db/mysqlJobRepository');
const { createMysqlStagingApp } = require('../src/createMysqlStagingApp');
const { getCairoDate } = require('../src/utils/cairoDate');

const enabled = process.env.MYSQL_STAGING_JOBS_TESTS === 'true';

test('MySQL staging jobs, search, closing, and saved jobs end-to-end', { skip: !enabled }, async (t) => {
  const databaseUrl = new URL(process.env.MYSQL_URL || '');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname.toLowerCase()),
    'Job integration tests are restricted to a local MySQL database');
  assert.match(databaseUrl.pathname, /staging/i, 'Job integration tests require a staging database');
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required');

  const pool = getMysqlPool();
  const users = createMysqlUserRepository(pool);
  const jobs = new MysqlJobRepository(pool);
  const app = createMysqlStagingApp({
    pool,
    sendJobStatusEmail: async () => ({ sent: true }),
  });
  const server = http.createServer(app);
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const createdUserIds = [];
  const createdJobIds = [];
  const today = getCairoDate();
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const pastDate = yesterday.toISOString().slice(0, 10);
  let baseUrl;
  let employer;
  let otherEmployer;
  let admin;
  let seeker;
  let tokens;

  const makeUser = async (role, tag = '', extra = {}) => {
    const user = await users.create({
      name: `Phase 4 ${role}`,
      email: `phase4-${role}${tag}-${suffix}@example.test`,
      password: 'StagePass123!',
      role,
      phone: role === 'employer' ? '01012345678' : '',
      accountStatus: 'active',
      detailedAddress: 'MySQL staging integration fixture',
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
  const trackJob = (job) => {
    if (job?._id && !createdJobIds.includes(job._id)) createdJobIds.push(job._id);
    return job;
  };
  const makeJob = (title, overrides = {}) => ({
    title,
    company: `P4Co${suffix}`,
    location: 'Cairo Phase Four',
    jobType: 'دوام كامل',
    category: 'Phase 4 Testing',
    description: `Unique body ${suffix} for ${title} with enough characters.`,
    requirements: ['SQL', 'Integration testing'],
    salary: '100',
    level: 'متوسط',
    experience: '1-3 سنوات',
    qualifications: 'درجة جامعية',
    closingDate: '',
    ...overrides,
  });

  try {
    employer = await makeUser('employer', '-main');
    otherEmployer = await makeUser('employer', '-other');
    admin = await makeUser('admin');
    seeker = await makeUser('job_seeker');
    tokens = {
      employer: issueToken(employer),
      otherEmployer: issueToken(otherEmployer),
      admin: issueToken(admin),
      job_seeker: issueToken(seeker),
    };
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    await t.test('enforces role access and preserves create/edit/delete business rules', async () => {
      const forbiddenCreate = await request('/api/jobs', {
        method: 'POST',
        token: tokens.job_seeker,
        body: makeJob(`P4-${suffix}-forbidden`),
      });
      assert.equal(forbiddenCreate.response.status, 403);

      const created = await request('/api/jobs', {
        method: 'POST',
        token: tokens.employer,
        body: makeJob(`P4-${suffix}-employer`),
      });
      assert.equal(created.response.status, 201);
      assert.equal(created.body.success, true);
      assert.equal(created.body.job.status, 'reviewing');
      assert.equal(created.body.job.postedBy, employer._id);
      assert.deepEqual(created.body.job.requirements, ['SQL', 'Integration testing']);
      const employerJob = trackJob(created.body.job);

      const forbiddenEdit = await request(`/api/jobs/${employerJob._id}`, {
        method: 'PUT',
        token: tokens.otherEmployer,
        body: { title: `P4-${suffix}-unauthorized` },
      });
      assert.equal(forbiddenEdit.response.status, 403);

      const edit = await request(`/api/jobs/${employerJob._id}`, {
        method: 'PUT',
        token: tokens.employer,
        body: {
          title: `P4-${suffix}-edited`,
          requirements: ['MySQL', 'Authorization'],
          status: 'active',
        },
      });
      assert.equal(edit.response.status, 200);
      assert.equal(edit.body.job.title, `P4-${suffix}-edited`);
      assert.equal(edit.body.job.status, 'reviewing');
      assert.deepEqual(edit.body.job.requirements, ['MySQL', 'Authorization']);

      const activated = await request(`/api/jobs/${employerJob._id}`, {
        method: 'PUT',
        token: tokens.admin,
        body: { status: 'active' },
      });
      assert.equal(activated.response.status, 200);
      assert.equal(activated.body.job.status, 'active');

      const details = await request(`/api/jobs/${employerJob._id}`);
      assert.equal(details.response.status, 200);
      assert.equal(details.body.job._id, employerJob._id);
      assert.equal(details.body.job.postedBy._id, employer._id);
      assert.equal(details.body.job.postedBy.email, employer.email);
      assert.equal(details.body.job.logoUrl, '');
      assert.deepEqual(details.body.job.requirements, ['MySQL', 'Authorization']);

      const mine = await request('/api/jobs/mine', { token: tokens.employer });
      assert.equal(mine.response.status, 200);
      assert.ok(mine.body.jobs.some((job) => job._id === employerJob._id));
      assert.equal(mine.body.jobs.find((job) => job._id === employerJob._id).applicantsCount, 0);

      const deletionRequested = await request(`/api/jobs/${employerJob._id}`, {
        method: 'DELETE',
        token: tokens.employer,
      });
      assert.equal(deletionRequested.response.status, 200);
      assert.equal(deletionRequested.body.job.status, 'deletion_pending');
      assert.equal(deletionRequested.body.job.deletionRequested, true);

      const deleted = await request(`/api/jobs/${employerJob._id}`, {
        method: 'DELETE',
        token: tokens.admin,
      });
      assert.equal(deleted.response.status, 200);
      assert.equal((await jobs.findOwnedById(employerJob._id)), null);
    });

    await t.test('searches, filters, sorts, paginates, and closes expired jobs from MySQL rows', async () => {
      const fixtures = [];
      for (let index = 0; index < 5; index += 1) {
        const payload = makeJob(`P4-${suffix}-search-${index}`, {
          location: index % 2 === 0 ? 'Cairo Test District' : 'Giza Test District',
          jobType: index % 2 === 0 ? 'دوام كامل' : 'دوام جزئي',
          category: index % 2 === 0 ? 'Engineering Phase' : 'Design Phase',
          level: index % 2 === 0 ? 'متوسط' : 'مبتدئ',
          salary: index === 4 ? '99' : String(100 + index),
          closingDate: index === 3 ? pastDate : index === 2 ? today : '',
        });
        const created = await request('/api/jobs', {
          method: 'POST',
          token: tokens.admin,
          body: payload,
        });
        assert.equal(created.response.status, 201);
        fixtures.push(trackJob(created.body.job));
      }
      for (const [index, fixture] of fixtures.entries()) {
        await pool.execute(
          'UPDATE jobs SET created_at = ? WHERE id = ?',
          [new Date(Date.now() - (fixtures.length - index) * 60_000), fixture._id],
        );
      }

      const query = encodeURIComponent(`p4-${suffix}-search`);
      const firstPage = await request(`/api/jobs?search=${query}&page=1&limit=2`);
      assert.equal(firstPage.response.status, 200);
      assert.equal(firstPage.body.total, 4);
      assert.equal(firstPage.body.count, 2);
      assert.equal(firstPage.body.page, 1);
      assert.equal(firstPage.body.pages, 2);
      assert.deepEqual(firstPage.body.jobs.map((job) => job._id), [fixtures[4]._id, fixtures[2]._id]);

      const secondPage = await request(`/api/jobs?search=${query}&page=2&limit=2`);
      assert.equal(secondPage.body.count, 2);
      assert.equal(secondPage.body.total, 4);
      assert.deepEqual(secondPage.body.jobs.map((job) => job._id), [fixtures[1]._id, fixtures[0]._id]);
      assert.equal(new Set([...firstPage.body.jobs, ...secondPage.body.jobs].map((job) => job._id)).size, 4);

      const companySearch = await request(`/api/jobs?search=${encodeURIComponent(`P4Co${suffix}`)}`);
      assert.equal(companySearch.body.total, 4);
      const descriptionSearch = await request(`/api/jobs?search=${encodeURIComponent(`Unique body ${suffix}`)}`);
      assert.equal(descriptionSearch.body.total, 4);

      const filtered = await request(
        `/api/jobs?search=${encodeURIComponent('Engineering')}&location=${encodeURIComponent('Cairo')}`
          + `&jobType=${encodeURIComponent('دوام كامل')}&category=${encodeURIComponent('Engineering')}`
          + `&level=${encodeURIComponent('متوسط')}`,
      );
      assert.equal(filtered.body.total, 3);
      assert.ok(filtered.body.jobs.every((job) => job.location.includes('Cairo')));
      assert.ok(filtered.body.jobs.every((job) => job.jobType === 'دوام كامل'));

      const salaryOrder = await request(`/api/jobs?search=${query}&sortBy=salary_high&limit=50`);
      assert.equal(salaryOrder.body.total, 4);
      assert.equal(salaryOrder.body.jobs[0]._id, fixtures[4]._id);

      const expired = fixtures[3];
      const expiredRecord = await jobs.findOwnedById(expired._id);
      assert.equal(expiredRecord.status, 'closed');
      const todayJob = await jobs.findOwnedById(fixtures[2]._id);
      assert.equal(todayJob.status, 'active');
      assert.ok(!firstPage.body.jobs.some((job) => job._id === expired._id));

      const oldest = await request(`/api/jobs?search=${query}&sortBy=oldest&limit=50`);
      assert.equal(oldest.body.total, 4);
      assert.equal(oldest.body.jobs.length, 4);
      assert.deepEqual(oldest.body.jobs.map((job) => job._id), [
        fixtures[0]._id,
        fixtures[1]._id,
        fixtures[2]._id,
        fixtures[4]._id,
      ]);
    });

    await t.test('concurrent creation, expiry, search, and deletion preserve job data and notifications', async () => {
      const expired = trackJob(await jobs.create(makeJob(`P4-${suffix}-concurrent-expired`, {
        closingDate: pastDate,
        status: 'active',
        postedBy: admin._id,
      })));
      const payloads = Array.from({ length: 16 }, (_, index) => makeJob(
        `P4-${suffix}-concurrent-${index}`,
        { requirements: [`requirement-${index}`, 'concurrent-regression'] },
      ));

      const [createResults] = await Promise.all([
        Promise.all(payloads.map(async (body) => {
          const result = await request('/api/jobs', {
            method: 'POST',
            token: tokens.admin,
            body,
          });
          trackJob(result.body.job);
          return result;
        })),
        Promise.all(Array.from({ length: 8 }, () => request(
          `/api/jobs?search=${encodeURIComponent(`P4-${suffix}-concurrent`)}&sortBy=newest&limit=20`,
        ))),
      ]);

      for (const result of createResults) {
        assert.equal(result.response.status, 201, JSON.stringify(result.body));
        assert.equal(result.body.success, true);
      }

      const createdJobs = createResults.map((result) => result.body.job);
      for (const job of createdJobs) {
        const stored = await jobs.findOwnedById(job._id);
        assert.deepEqual(stored.requirements, job.requirements);
        const [[notificationCount]] = await pool.execute(
          'SELECT COUNT(*) AS count FROM notifications WHERE job_id = ? AND user_id = ?',
          [job._id, admin._id],
        );
        assert.equal(Number(notificationCount.count), 1);
      }
      assert.equal((await jobs.findOwnedById(expired._id)).status, 'closed');

      const expiryBatch = [];
      for (let index = 0; index < 12; index += 1) {
        expiryBatch.push(trackJob(await jobs.create(makeJob(
          `P4-${suffix}-expiry-race-${index}`,
          { closingDate: pastDate, status: 'active', postedBy: admin._id },
        ))));
      }
      const deletedExpiryJobs = expiryBatch.slice(0, 6);
      const retainedExpiryJobs = expiryBatch.slice(6);
      const [expiryResults, expiryDeleteResults, expirySearchResults] = await Promise.all([
        Promise.all(Array.from({ length: 8 }, () => jobs.closeExpiredJobs(today))),
        Promise.all(deletedExpiryJobs.map((job) => request(`/api/jobs/${job._id}`, {
          method: 'DELETE',
          token: tokens.admin,
        }))),
        Promise.all(Array.from({ length: 8 }, () => request(
          `/api/jobs?search=${encodeURIComponent(`P4-${suffix}-expiry-race`)}&limit=20`,
        ))),
      ]);
      assert.ok(expiryResults.every((result) => Number.isInteger(result.modifiedCount)));
      for (const result of expiryDeleteResults) {
        assert.equal(result.response.status, 200);
        assert.equal(result.body.success, true);
      }
      for (const result of expirySearchResults) {
        assert.equal(result.response.status, 200);
        assert.ok(Array.isArray(result.body.jobs));
      }
      for (const job of deletedExpiryJobs) assert.equal(await jobs.findOwnedById(job._id), null);
      for (const job of retainedExpiryJobs) assert.equal((await jobs.findOwnedById(job._id)).status, 'closed');

      const jobsToDelete = createdJobs.slice(0, 8);
      const [deleteResults] = await Promise.all([
        Promise.all(jobsToDelete.map((job) => request(`/api/jobs/${job._id}`, {
          method: 'DELETE',
          token: tokens.admin,
        }))),
        Promise.all(Array.from({ length: 8 }, () => request(
          `/api/jobs?search=${encodeURIComponent(`P4-${suffix}-concurrent`)}&sortBy=oldest&limit=20`,
        ))),
      ]);
      for (const result of deleteResults) assert.equal(result.response.status, 200);
      for (const job of jobsToDelete) {
        assert.equal(await jobs.findOwnedById(job._id), null);
        const [[requirementCount]] = await pool.execute(
          'SELECT COUNT(*) AS count FROM job_requirements WHERE job_id = ?',
          [job._id],
        );
        assert.equal(Number(requirementCount.count), 0);
      }
    });

    await t.test('toggles saved jobs and excludes closed or deleted jobs from the saved list', async () => {
      const savedTarget = trackJob((await request('/api/jobs', {
        method: 'POST',
        token: tokens.admin,
        body: makeJob(`P4-${suffix}-saved`),
      })).body.job);

      const save = await request(`/api/users/saved/${savedTarget._id}`, {
        method: 'POST',
        token: tokens.job_seeker,
      });
      assert.equal(save.response.status, 200);
      assert.equal(save.body.saved, true);

      const savedList = await request('/api/users/saved', { token: tokens.job_seeker });
      assert.equal(savedList.response.status, 200);
      assert.ok(savedList.body.savedJobs.some((job) => job._id === savedTarget._id));
      assert.equal(savedList.body.savedJobs.find((job) => job._id === savedTarget._id).logoUrl, '');

      const unsave = await request(`/api/users/saved/${savedTarget._id}`, {
        method: 'POST',
        token: tokens.job_seeker,
      });
      assert.equal(unsave.response.status, 200);
      assert.equal(unsave.body.saved, false);

      const concurrentTarget = trackJob((await request('/api/jobs', {
        method: 'POST',
        token: tokens.admin,
        body: makeJob(`P4-${suffix}-saved-concurrent`),
      })).body.job);
      const concurrentToggles = await Promise.all([
        request(`/api/users/saved/${concurrentTarget._id}`, {
          method: 'POST',
          token: tokens.job_seeker,
        }),
        request(`/api/users/saved/${concurrentTarget._id}`, {
          method: 'POST',
          token: tokens.job_seeker,
        }),
      ]);
      assert.deepEqual(concurrentToggles.map(({ body }) => body.saved).sort(), [false, true]);
      const concurrentList = await request('/api/users/saved', { token: tokens.job_seeker });
      assert.ok(!concurrentList.body.savedJobs.some((job) => job._id === concurrentTarget._id));

      const resave = await request(`/api/users/saved/${savedTarget._id}`, {
        method: 'POST',
        token: tokens.job_seeker,
      });
      assert.equal(resave.body.saved, true);
      const close = await request(`/api/jobs/${savedTarget._id}`, {
        method: 'PUT',
        token: tokens.admin,
        body: { status: 'closed' },
      });
      assert.equal(close.body.job.status, 'closed');
      const closedList = await request('/api/users/saved', { token: tokens.job_seeker });
      assert.ok(!closedList.body.savedJobs.some((job) => job._id === savedTarget._id));

      const deleteTarget = trackJob((await request('/api/jobs', {
        method: 'POST',
        token: tokens.admin,
        body: makeJob(`P4-${suffix}-delete-cascade`),
      })).body.job);
      await request(`/api/users/saved/${deleteTarget._id}`, {
        method: 'POST',
        token: tokens.job_seeker,
      });
      const deleted = await request(`/api/jobs/${deleteTarget._id}`, {
        method: 'DELETE',
        token: tokens.admin,
      });
      assert.equal(deleted.response.status, 200);
      assert.equal(await jobs.findOwnedById(deleteTarget._id), null);
      const [savedRows] = await pool.execute('SELECT COUNT(*) AS count FROM saved_jobs WHERE job_id = ?', [
        deleteTarget._id,
      ]);
      assert.equal(Number(savedRows[0].count), 0);
    });
  } finally {
    if (createdJobIds.length) {
      const placeholders = createdJobIds.map(() => '?').join(', ');
      await pool.execute(`DELETE FROM jobs WHERE id IN (${placeholders})`, createdJobIds);
      const [remainingJobs] = await pool.execute(
        `SELECT COUNT(*) AS count FROM jobs WHERE id IN (${placeholders})`,
        createdJobIds,
      );
      assert.equal(Number(remainingJobs[0].count), 0, 'Job fixtures must be removed after the test');
    }
    if (createdUserIds.length) {
      const placeholders = createdUserIds.map(() => '?').join(', ');
      await pool.execute(`DELETE FROM notifications WHERE user_id IN (${placeholders})`, createdUserIds);
      await pool.execute(`DELETE FROM users WHERE id IN (${placeholders})`, createdUserIds);
      const [remainingUsers] = await pool.execute(
        `SELECT COUNT(*) AS count FROM users WHERE id IN (${placeholders})`,
        createdUserIds,
      );
      assert.equal(Number(remainingUsers[0].count), 0, 'User fixtures must be removed after the test');
    }
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});
