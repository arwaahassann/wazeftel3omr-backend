const {
  MysqlRepository,
  createMongoId,
  normalizeMongoId,
} = require('./mysqlRepository');

const applicationColumns = `
  a.id AS _id,
  a.user_id AS userId,
  a.job_id AS jobId,
  a.status,
  a.name,
  a.email,
  a.phone,
  a.location,
  a.experience,
  a.skills,
  a.cv_url AS cvUrl,
  a.linkedin_url AS linkedinUrl,
  a.portfolio_url AS portfolioUrl,
  a.github_url AS githubUrl,
  a.expected_salary AS expectedSalary,
  a.availability,
  a.notes,
  a.interview_date AS interviewDate,
  a.interview_time AS interviewTime,
  a.interview_format AS interviewFormat,
  a.interview_location AS interviewLocation,
  a.interview_notes AS interviewNotes,
  a.decision_message AS decisionMessage,
  a.decision_processing AS decisionProcessing,
  a.decision_processing_at AS decisionProcessingAt,
  a.decision_notification_sent AS decisionNotificationSent,
  a.decision_email_sent AS decisionEmailSent,
  a.applied_at AS appliedAt,
  a.created_at AS createdAt,
  a.updated_at AS updatedAt
`;

const applicationFromRow = (row) => {
  const application = {
    _id: row._id,
    user: row.userId,
    job: row.jobId,
    status: row.status,
    name: row.name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    experience: row.experience,
    skills: row.skills,
    cvUrl: row.cvUrl,
    linkedinUrl: row.linkedinUrl,
    portfolioUrl: row.portfolioUrl,
    githubUrl: row.githubUrl,
    expectedSalary: row.expectedSalary,
    availability: row.availability,
    notes: row.notes,
    interviewDetails: {
      date: row.interviewDate || '',
      time: row.interviewTime || '',
      format: row.interviewFormat || 'in_person',
      location: row.interviewLocation || '',
      notes: row.interviewNotes || '',
    },
    decisionMessage: row.decisionMessage || '',
    decisionProcessing: Boolean(row.decisionProcessing),
    decisionProcessingAt: row.decisionProcessingAt,
    decisionNotificationSent: Boolean(row.decisionNotificationSent),
    decisionEmailSent: Boolean(row.decisionEmailSent),
    appliedAt: row.appliedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.user) application.user = row.user;
  if (row.job) application.job = row.job;
  return application;
};

const toStringValue = (value, fallback = '') => (
  value === undefined || value === null ? fallback : String(value)
);

const mapInterview = (row, prefix = '') => ({
  date: row[`${prefix}interviewDate`] || '',
  time: row[`${prefix}interviewTime`] || '',
  format: row[`${prefix}interviewFormat`] || 'in_person',
  location: row[`${prefix}interviewLocation`] || '',
  notes: row[`${prefix}interviewNotes`] || '',
});

class MysqlApplicationRepository {
  constructor(pool) {
    this.repository = pool instanceof MysqlRepository ? pool : new MysqlRepository(pool);
  }

  async create({ user, jobId, input }) {
    const applicationId = createMongoId();
    const normalizedJobId = normalizeMongoId(jobId);
    await this.repository.transaction(async (connection) => {
      const [jobRows] = await connection.execute(
        `SELECT id, posted_by, title, company, status
         FROM jobs WHERE id = ? FOR UPDATE`,
        [normalizedJobId],
      );
      const job = jobRows[0];
      if (!job || job.status !== 'active') {
        const error = new Error('JOB_NOT_AVAILABLE');
        error.code = 'JOB_NOT_AVAILABLE';
        throw error;
      }
      if (job.posted_by === normalizeMongoId(user._id)) {
        const error = new Error('JOB_OWNER_APPLY');
        error.code = 'JOB_OWNER_APPLY';
        throw error;
      }

      const [userRows] = await connection.execute(
        'SELECT cv_url AS cvUrl FROM users WHERE id = ? LIMIT 1',
        [normalizeMongoId(user._id)],
      );
      const values = {
        id: applicationId,
        user_id: normalizeMongoId(user._id),
        job_id: normalizedJobId,
        status: 'pending',
        name: toStringValue(input.name, user.name),
        email: toStringValue(input.email, user.email),
        phone: toStringValue(input.phone, user.phone),
        location: toStringValue(input.location),
        experience: toStringValue(input.experience),
        skills: toStringValue(input.skills),
        cv_url: toStringValue(input.cvUrl, userRows[0]?.cvUrl),
        linkedin_url: toStringValue(input.linkedinUrl),
        portfolio_url: toStringValue(input.portfolioUrl),
        github_url: toStringValue(input.githubUrl),
        expected_salary: toStringValue(input.expectedSalary),
        availability: toStringValue(input.availability, 'فوري'),
        notes: toStringValue(input.notes),
        interview_date: '',
        interview_time: '',
        interview_format: 'in_person',
        interview_location: '',
        interview_notes: '',
        decision_message: '',
        decision_processing: false,
        decision_processing_at: null,
        decision_notification_sent: false,
        decision_email_sent: false,
        applied_at: new Date(),
      };
      const fields = Object.keys(values);
      await connection.execute(
        `INSERT INTO applications (${fields.join(', ')})
         VALUES (${fields.map(() => '?').join(', ')})`,
        fields.map((field) => values[field]),
      );
      const applicantName = values.name || user.name;
      await this.insertNotification(connection, {
        userId: job.posted_by,
        applicationId,
        jobId: normalizedJobId,
        title: `طلب تقديم جديد: ${job.title} 👤`,
        message: `قام المتقدم (${applicantName}) بالتقديم على وظيفتك (${job.title}). يمكنك مراجعة السيرة الذاتية والتواصل معه الآن.`,
        type: 'pending',
      });
      await this.insertNotification(connection, {
        userId: user._id,
        applicationId,
        jobId: normalizedJobId,
        title: `تم إرسال طلب التقديم: ${job.title} ✅`,
        message: `تم إرسال طلب تقديمك بنجاح لوظيفة (${job.title}) لدى (${job.company || 'الشركة المُعلنة'}). سيتم إشعارك فور مراجعة الطلب أو تحديد مقابلة.`,
        type: 'pending',
      });
    });
    return this.findById(applicationId);
  }

  async findById(id) {
    const [row] = await this.repository.query(
      `SELECT ${applicationColumns}
       FROM applications a
       WHERE a.id = ?
       LIMIT 1`,
      [normalizeMongoId(id)],
    );
    return row ? applicationFromRow(row) : null;
  }

  async getApplicantApplications(userId, status) {
    const conditions = ['a.user_id = ?'];
    const parameters = [normalizeMongoId(userId)];
    if (status && status !== 'all') {
      conditions.push('a.status = ?');
      parameters.push(String(status));
    }
    const rows = await this.repository.query(
      `SELECT ${applicationColumns},
         j.id AS populatedJobId,
         j.title AS populatedJobTitle,
         j.company AS populatedJobCompany,
         j.location AS populatedJobLocation,
         j.job_type AS populatedJobType,
         j.category AS populatedJobCategory,
         j.salary AS populatedJobSalary,
         j.status AS populatedJobStatus,
         j.posted_by AS populatedJobPoster,
         u.avatar AS populatedJobPosterAvatar
       FROM applications a
       INNER JOIN jobs j ON j.id = a.job_id
       INNER JOIN users u ON u.id = j.posted_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.created_at DESC, a.id DESC`,
      parameters,
    );
    return rows.map((row) => {
      const application = applicationFromRow(row);
      delete application.cvUrl;
      application.job = {
        _id: row.populatedJobId,
        title: row.populatedJobTitle,
        company: row.populatedJobCompany,
        location: row.populatedJobLocation,
        jobType: row.populatedJobType,
        category: row.populatedJobCategory,
        salary: row.populatedJobSalary,
        status: row.populatedJobStatus,
        postedBy: {
          _id: row.populatedJobPoster,
          avatar: row.populatedJobPosterAvatar || '',
        },
        logoUrl: row.populatedJobPosterAvatar || '',
      };
      return application;
    });
  }

  async getSeekerStats(userId) {
    const rows = await this.repository.query(
      `SELECT a.status, COUNT(*) AS count
       FROM applications a
       INNER JOIN jobs j ON j.id = a.job_id
       WHERE a.user_id = ?
       GROUP BY a.status`,
      [normalizeMongoId(userId)],
    );
    const stats = { applications: 0, accepted: 0, interviews: 0, reviewing: 0, rejected: 0 };
    for (const row of rows) {
      const count = Number(row.count);
      stats.applications += count;
      if (row.status === 'accepted') stats.accepted = count;
      if (row.status === 'interview') stats.interviews = count;
      if (row.status === 'reviewing' || row.status === 'pending') stats.reviewing += count;
      if (row.status === 'rejected') stats.rejected = count;
    }
    return stats;
  }

  async getEmployerStats(employerId) {
    const rows = await this.repository.query(
      `SELECT a.status, COUNT(*) AS count
       FROM applications a
       INNER JOIN jobs j ON j.id = a.job_id
       WHERE j.posted_by = ?
       GROUP BY a.status`,
      [normalizeMongoId(employerId)],
    );
    const stats = { total: 0, pending: 0, reviewing: 0, interview: 0, accepted: 0, rejected: 0 };
    for (const row of rows) {
      const count = Number(row.count);
      stats.total += count;
      stats[row.status] = count;
    }
    return stats;
  }

  async getAdminStats() {
    const rows = await this.repository.query(
      `SELECT a.status, COUNT(*) AS count
       FROM applications a
       INNER JOIN jobs j ON j.id = a.job_id
       GROUP BY a.status`,
    );
    const stats = { total: 0, pending: 0, reviewing: 0, interview: 0, accepted: 0, rejected: 0 };
    for (const row of rows) {
      const count = Number(row.count);
      stats.total += count;
      stats[row.status] = count;
    }
    return stats;
  }

  async getJobApplications(jobId) {
    const rows = await this.repository.query(
      `SELECT ${applicationColumns},
         u.id AS populatedUserId,
         u.name AS populatedUserName,
         u.email AS populatedUserEmail,
         u.job_title AS populatedUserJobTitle,
         u.phone AS populatedUserPhone,
         u.location AS populatedUserLocation,
         u.avatar AS populatedUserAvatar
       FROM applications a
       INNER JOIN users u ON u.id = a.user_id
       WHERE a.job_id = ?
       ORDER BY a.created_at DESC, a.id DESC`,
      [normalizeMongoId(jobId)],
    );
    return this.populateApplicants(rows, false);
  }

  async getEmployerApplicationDetails(applicationId) {
    const [row] = await this.repository.query(
      `SELECT ${applicationColumns},
         u.id AS populatedUserId,
         u.name AS populatedUserName,
         u.email AS populatedUserEmail,
         u.job_title AS populatedUserJobTitle,
         u.phone AS populatedUserPhone,
         u.location AS populatedUserLocation,
         u.avatar AS populatedUserAvatar,
         u.cv_url AS populatedUserCvUrl,
         j.id AS populatedJobId,
         j.title AS populatedJobTitle,
         j.company AS populatedJobCompany,
         j.location AS populatedJobLocation,
         j.description AS populatedJobDescription,
         j.posted_by AS populatedJobPoster
       FROM applications a
       INNER JOIN users u ON u.id = a.user_id
       INNER JOIN jobs j ON j.id = a.job_id
       WHERE a.id = ?
       LIMIT 1`,
      [normalizeMongoId(applicationId)],
    );
    if (!row) return null;
    const application = applicationFromRow(row);
    application.user = {
      _id: row.populatedUserId,
      name: row.populatedUserName,
      email: row.populatedUserEmail,
      jobTitle: row.populatedUserJobTitle,
      phone: row.populatedUserPhone,
      location: row.populatedUserLocation,
      skills: await this.getUserSkills(row.populatedUserId),
      cvUrl: row.populatedUserCvUrl || '',
      avatar: row.populatedUserAvatar || '',
    };
    application.job = {
      _id: row.populatedJobId,
      title: row.populatedJobTitle,
      company: row.populatedJobCompany,
      location: row.populatedJobLocation,
      description: row.populatedJobDescription,
      postedBy: row.populatedJobPoster,
    };
    return application;
  }

  async getEmployerApplications(employerId, { page, limit, status, summary = false }) {
    const conditions = ['j.posted_by = ?'];
    const parameters = [normalizeMongoId(employerId)];
    if (status && status !== 'all') {
      conditions.push('a.status = ?');
      parameters.push(String(status));
    }
    const where = conditions.join(' AND ');
    const [countRow] = await this.repository.query(
      `SELECT COUNT(*) AS total
       FROM applications a
       INNER JOIN jobs j ON j.id = a.job_id
       WHERE ${where}`,
      parameters,
    );
    const total = Number(countRow.total);
    const actualLimit = summary ? 8 : limit;
    const offset = summary ? 0 : (page - 1) * limit;
    const rows = await this.repository.query(
      `SELECT ${applicationColumns},
         u.id AS populatedUserId,
         u.name AS populatedUserName,
         u.email AS populatedUserEmail,
         u.job_title AS populatedUserJobTitle,
         u.phone AS populatedUserPhone,
         u.location AS populatedUserLocation,
         u.avatar AS populatedUserAvatar,
         j.id AS populatedJobId,
         j.title AS populatedJobTitle,
         j.company AS populatedJobCompany,
         j.location AS populatedJobLocation
       FROM applications a
       INNER JOIN users u ON u.id = a.user_id
       INNER JOIN jobs j ON j.id = a.job_id
       WHERE ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
      [...parameters, actualLimit, offset],
    );
    const applications = await this.populateApplicants(rows, true);
    let interviewCount = 0;
    let activeJobsCount = 0;
    if (summary) {
      const [[interviewRows], [activeRows]] = await Promise.all([
        this.repository.query(
          `SELECT COUNT(*) AS count FROM applications a
           INNER JOIN jobs j ON j.id = a.job_id
           WHERE j.posted_by = ? AND a.status = 'interview'`,
          [normalizeMongoId(employerId)],
        ),
        this.repository.query(
          `SELECT COUNT(*) AS count FROM jobs
           WHERE posted_by = ? AND status = 'active'`,
          [normalizeMongoId(employerId)],
        ),
      ]);
      interviewCount = Number(interviewRows.count);
      activeJobsCount = Number(activeRows.count);
    }
    return { applications, total, interviewCount, activeJobsCount };
  }

  async updateStatus(applicationId, employerId, {
    status,
    notes,
    interviewDetails,
    decisionMessage,
    notificationTitle,
    notificationMessage,
    notificationType,
  }) {
    const id = normalizeMongoId(applicationId);
    const allowedFinalStatuses = ['accepted', 'rejected'];
    return this.repository.transaction(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT a.id, a.user_id AS userId, a.job_id AS jobId, a.status,
            a.email, a.name, a.decision_email_sent AS decisionEmailSent,
            a.decision_notification_sent AS decisionNotificationSent,
            a.decision_processing AS decisionProcessing,
            a.decision_processing_at AS decisionProcessingAt,
            j.title AS jobTitle, j.company AS companyName, j.posted_by AS postedBy,
            u.email AS userEmail, u.name AS userName
         FROM applications a
         INNER JOIN jobs j ON j.id = a.job_id
         INNER JOIN users u ON u.id = a.user_id
         WHERE a.id = ?
         FOR UPDATE`,
        [id],
      );
      const current = rows[0];
      if (!current) return { error: 'NOT_FOUND' };
      if (String(current.postedBy) !== String(employerId) && employerId !== null) {
        return { error: 'FORBIDDEN' };
      }

      const currentIsFinal = allowedFinalStatuses.includes(current.status);
      const retryingFinal = currentIsFinal
        && status === current.status
        && (!current.decisionEmailSent || !current.decisionNotificationSent);
      if (currentIsFinal && !retryingFinal) return { error: 'FINALIZED' };

      const processingTime = current.decisionProcessingAt
        ? new Date(current.decisionProcessingAt).getTime()
        : 0;
      if (current.decisionProcessing && processingTime > Date.now() - 10 * 60 * 1000) {
        return { error: 'BUSY' };
      }

      const details = interviewDetails || mapInterview(current, '');
      const decisions = decisionMessage === undefined ? '' : String(decisionMessage);
      await connection.execute(
        `UPDATE applications SET
           status = ?,
           notes = COALESCE(?, notes),
           interview_date = COALESCE(?, interview_date),
           interview_time = COALESCE(?, interview_time),
           interview_format = COALESCE(?, interview_format),
           interview_location = COALESCE(?, interview_location),
           interview_notes = COALESCE(?, interview_notes),
           decision_message = COALESCE(?, decision_message),
           decision_processing = TRUE,
           decision_processing_at = CURRENT_TIMESTAMP(3),
           decision_notification_sent = ?,
           decision_email_sent = ?,
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [
          status,
          notes === undefined ? null : String(notes),
          interviewDetails === undefined ? null : toStringValue(details.date),
          interviewDetails === undefined ? null : toStringValue(details.time),
          interviewDetails === undefined ? null : toStringValue(details.format, 'in_person'),
          interviewDetails === undefined ? null : toStringValue(details.location),
          interviewDetails === undefined ? null : toStringValue(details.notes),
          decisionMessage === undefined ? null : decisions,
          retryingFinal && current.decisionNotificationSent ? 1 : 0,
          retryingFinal && current.decisionEmailSent ? 1 : 0,
          id,
        ],
      );

      let notificationSent = retryingFinal && Boolean(current.decisionNotificationSent);
      if (!notificationSent) {
        const [existing] = await connection.execute(
          `SELECT id FROM notifications
           WHERE user_id = ? AND application_id = ? AND type = ?
           ORDER BY created_at DESC LIMIT 1`,
          [current.userId, id, notificationType],
        );
        if (existing.length) {
          await connection.execute(
            `UPDATE notifications SET title = ?, message = ?, job_id = ?,
               interview_date = ?, interview_time = ?, interview_format = ?,
               interview_location = ?, interview_notes = ?, decision_message = ?,
               is_read = FALSE, updated_at = CURRENT_TIMESTAMP(3)
             WHERE id = ?`,
            [
              notificationTitle,
              notificationMessage,
              current.jobId,
              toStringValue(details.date),
              toStringValue(details.time),
              toStringValue(details.format, 'in_person'),
              toStringValue(details.location),
              toStringValue(details.notes),
              decisions,
              existing[0].id,
            ],
          );
        } else {
          await this.insertNotification(connection, {
            userId: current.userId,
            applicationId: id,
            jobId: current.jobId,
            title: notificationTitle,
            message: notificationMessage,
            type: notificationType,
            interviewDetails: details,
            decisionMessage: decisions,
          });
        }
        notificationSent = true;
      }
      await connection.execute(
        `UPDATE applications SET decision_notification_sent = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [notificationSent ? 1 : 0, id],
      );
      return {
        applicationId: id,
        userId: current.userId,
        jobId: current.jobId,
        jobTitle: current.jobTitle,
        companyName: current.companyName,
        applicantName: current.name || current.userName || 'المتقدم',
        candidateEmail: String(current.email || current.userEmail || '').trim(),
        interviewDetails: details,
        decisionMessage: decisions,
        notificationTitle,
        notificationMessage,
        notificationSent,
        emailAlreadySent: retryingFinal && Boolean(current.decisionEmailSent),
        status,
      };
    });
  }

  async completeStatusEmail(applicationId, sent) {
    await this.repository.execute(
      `UPDATE applications SET decision_email_sent = ?,
         decision_processing = FALSE, decision_processing_at = NULL,
         updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [sent ? 1 : 0, normalizeMongoId(applicationId)],
    );
    return this.getEmployerApplicationDetails(applicationId);
  }

  async getAdminApplicationList({ page, limit, status, search }) {
    const conditions = [];
    const parameters = [];
    if (status && status !== 'all') {
      conditions.push('a.status = ?');
      parameters.push(String(status));
    }
    if (search && String(search).trim()) {
      const term = String(search).trim();
      conditions.push(`(
        LOCATE(LOWER(?), LOWER(COALESCE(a.name, ''))) > 0
        OR LOCATE(LOWER(?), LOWER(COALESCE(a.email, ''))) > 0
        OR LOCATE(LOWER(?), LOWER(COALESCE(a.phone, ''))) > 0
      )`);
      parameters.push(term, term, term);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [countRow] = await this.repository.query(
      `SELECT COUNT(*) AS total FROM applications a ${where}`,
      parameters,
    );
    const total = Number(countRow.total);
    const rows = await this.repository.query(
      `SELECT ${applicationColumns},
         u.id AS populatedUserId,
         u.name AS populatedUserName,
         u.email AS populatedUserEmail,
         u.job_title AS populatedUserJobTitle,
         u.phone AS populatedUserPhone,
         u.location AS populatedUserLocation,
         u.avatar AS populatedUserAvatar,
         j.id AS populatedJobId,
         j.title AS populatedJobTitle,
         j.company AS populatedJobCompany,
         j.location AS populatedJobLocation
       FROM applications a
       INNER JOIN users u ON u.id = a.user_id
       INNER JOIN jobs j ON j.id = a.job_id
       ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
      [...parameters, limit, (page - 1) * limit],
    );
    return {
      applications: await this.populateApplicants(rows, true),
      total,
    };
  }

  async getDashboardStats() {
    const [totals] = await this.repository.query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role = 'job_seeker') AS totalSeekers,
         (SELECT COUNT(*) FROM users WHERE role = 'employer') AS totalEmployers,
         (SELECT COUNT(*) FROM jobs) AS totalJobs,
         (SELECT COUNT(*) FROM jobs WHERE status = 'active') AS activeJobs,
         (SELECT COUNT(*) FROM jobs WHERE status = 'reviewing') AS reviewingJobs,
         (SELECT COUNT(*) FROM jobs WHERE status = 'closed') AS closedJobs,
         (SELECT COUNT(*) FROM jobs WHERE status = 'rejected') AS rejectedJobs,
         (SELECT COUNT(*) FROM applications) AS totalApplications,
         (SELECT COUNT(*) FROM users WHERE role = 'job_seeker' AND account_status = 'active') AS activeSeekers,
         (SELECT COUNT(*) FROM users WHERE role = 'job_seeker' AND account_status = 'suspended') AS suspendedSeekers,
         (SELECT COUNT(*) FROM users WHERE role = 'job_seeker' AND account_status = 'reviewing') AS reviewingSeekers,
         (SELECT COUNT(*) FROM users WHERE role = 'employer' AND account_status = 'active') AS activeEmployers,
         (SELECT COUNT(*) FROM users WHERE role = 'employer' AND account_status = 'suspended') AS suspendedEmployers,
         (SELECT COUNT(*) FROM users WHERE role = 'employer' AND account_status = 'reviewing') AS reviewingEmployers,
         (SELECT COUNT(*) FROM users WHERE role = 'employer' AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 7 DAY) AS newEmployersThisWeek,
         (SELECT COUNT(*) FROM applications WHERE created_at >= UTC_TIMESTAMP(3) - INTERVAL 7 DAY) AS newApplicationsThisWeek`,
    );
    const statusRows = await this.repository.query(
      `SELECT a.status, COUNT(*) AS count FROM applications a
       INNER JOIN jobs j ON j.id = a.job_id
       GROUP BY a.status`,
    );
    const applicationStatuses = {
      pending: 0,
      reviewing: 0,
      interview: 0,
      accepted: 0,
      rejected: 0,
    };
    for (const row of statusRows) applicationStatuses[row.status] = Number(row.count);

    const activityRows = await this.repository.query(
      `(
        SELECT CONCAT('job_', j.id) AS id, 'job' AS type,
          CONCAT('تم نشر وظيفه جديده بواسطه شركه ', COALESCE(u.company, j.company, 'المجد')) AS text,
          j.title AS subText, j.created_at AS date
        FROM jobs j INNER JOIN users u ON u.id = j.posted_by
        ORDER BY j.created_at DESC, j.id DESC LIMIT 5
      ) UNION ALL (
        SELECT CONCAT('app_', a.id) AS id, 'application' AS type,
          CONCAT('تقدم ', COALESCE(a.name, u.name, 'مستخدم'), ' علي وظيفه') AS text,
          j.title AS subText, a.created_at AS date
        FROM applications a
        INNER JOIN users u ON u.id = a.user_id
        INNER JOIN jobs j ON j.id = a.job_id
        ORDER BY a.created_at DESC, a.id DESC LIMIT 5
      ) UNION ALL (
        SELECT CONCAT('report_', r.id) AS id, 'report' AS type,
          CONCAT(IF(r.type = 'suggestion', 'مقترح جديد من ', 'شكوى جديدة من '),
            COALESCE(u.name, 'مستخدم')) AS text,
          r.subject AS subText, r.created_at AS date
        FROM reports r INNER JOIN users u ON u.id = r.user_id
        ORDER BY r.created_at DESC, r.id DESC LIMIT 5
      )
       ORDER BY date DESC
       LIMIT 8`,
    );
    return {
      stats: {
        totalSeekers: Number(totals.totalSeekers),
        totalEmployers: Number(totals.totalEmployers),
        totalJobs: Number(totals.totalJobs),
        totalApplications: Number(totals.totalApplications),
        applicationStatuses,
        activeJobs: Number(totals.activeJobs),
        reviewingJobs: Number(totals.reviewingJobs),
        closedJobs: Number(totals.closedJobs),
        rejectedJobs: Number(totals.rejectedJobs),
        seekers: {
          active: Number(totals.activeSeekers),
          suspended: Number(totals.suspendedSeekers),
          reviewing: Number(totals.reviewingSeekers),
        },
        employers: {
          active: Number(totals.activeEmployers),
          suspended: Number(totals.suspendedEmployers),
          reviewing: Number(totals.reviewingEmployers),
        },
        thisWeek: {
          newEmployers: Number(totals.newEmployersThisWeek),
          newApplications: Number(totals.newApplicationsThisWeek),
        },
      },
      activities: activityRows,
    };
  }

  async getUserSkills(userId) {
    const rows = await this.repository.query(
      'SELECT skill FROM user_skills WHERE user_id = ? ORDER BY position',
      [normalizeMongoId(userId)],
    );
    return rows.map((row) => row.skill);
  }

  async populateApplicants(rows, includeJob) {
    const userIds = [...new Set(rows.map((row) => row.populatedUserId))];
    const skills = new Map(await Promise.all(
      userIds.map(async (id) => [id, await this.getUserSkills(id)]),
    ));
    return rows.map((row) => {
      const application = applicationFromRow(row);
      delete application.cvUrl;
      application.user = {
        _id: row.populatedUserId,
        name: row.populatedUserName,
        email: row.populatedUserEmail,
        jobTitle: row.populatedUserJobTitle,
        phone: row.populatedUserPhone,
        location: row.populatedUserLocation,
        skills: skills.get(row.populatedUserId) || [],
        avatar: row.populatedUserAvatar || '',
      };
      if (includeJob) {
        application.job = {
          _id: row.populatedJobId,
          title: row.populatedJobTitle,
          company: row.populatedJobCompany,
          location: row.populatedJobLocation,
        };
      }
      return application;
    });
  }

  async insertNotification(connection, {
    userId,
    applicationId,
    jobId,
    title,
    message,
    type,
    interviewDetails = {},
    decisionMessage = '',
  }) {
    await connection.execute(
      `INSERT INTO notifications (
         id, user_id, title, message, type, is_read, job_id, application_id,
         interview_date, interview_time, interview_format, interview_location,
         interview_notes, decision_message
       ) VALUES (?, ?, ?, ?, ?, FALSE, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createMongoId(),
        normalizeMongoId(userId),
        title,
        message,
        type,
        normalizeMongoId(jobId),
        normalizeMongoId(applicationId),
        toStringValue(interviewDetails.date),
        toStringValue(interviewDetails.time),
        toStringValue(interviewDetails.format, 'in_person'),
        toStringValue(interviewDetails.location),
        toStringValue(interviewDetails.notes),
        decisionMessage,
      ],
    );
  }
}

module.exports = { MysqlApplicationRepository };
