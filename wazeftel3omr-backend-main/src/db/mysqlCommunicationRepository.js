const {
  MysqlRepository,
  createMongoId,
  normalizeMongoId,
} = require('./mysqlRepository');

const notificationFromRow = (row) => {
  const notification = {
    _id: row._id,
    user: row.userId,
    title: row.title,
    message: row.message,
    type: row.type,
    isRead: Boolean(row.isRead),
    job: row.jobId || undefined,
    application: row.applicationId || undefined,
    interviewDetails: {
      date: row.interviewDate || '',
      time: row.interviewTime || '',
      format: row.interviewFormat || 'in_person',
      location: row.interviewLocation || '',
      notes: row.interviewNotes || '',
    },
    decisionMessage: row.decisionMessage || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.populatedJobId) {
    notification.job = {
      _id: row.populatedJobId,
      title: row.populatedJobTitle,
      company: row.populatedJobCompany,
      location: row.populatedJobLocation,
      postedBy: row.populatedJobPoster
        ? { _id: row.populatedJobPoster, avatar: row.populatedJobPosterAvatar || null }
        : null,
    };
  }
  if (row.populatedApplicationId) {
    notification.application = {
      _id: row.populatedApplicationId,
      status: row.populatedApplicationStatus,
      job: row.populatedApplicationJob,
      user: row.populatedApplicationUser,
    };
  }
  return notification;
};

const reportFromRow = (row) => {
  const report = {
    _id: row._id,
    user: row.userId,
    type: row.type,
    subject: row.subject,
    message: row.message,
    relatedJob: row.relatedJobId,
    status: row.status,
    adminReply: row.adminReply,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.populatedUserId) {
    report.user = {
      _id: row.populatedUserId,
      name: row.populatedUserName,
      email: row.populatedUserEmail,
      role: row.populatedUserRole,
      phone: row.populatedUserPhone,
      avatar: row.populatedUserAvatar,
    };
  }
  if (row.populatedJobId) {
    report.relatedJob = {
      _id: row.populatedJobId,
      title: row.populatedJobTitle,
      company: row.populatedJobCompany,
    };
  }
  return report;
};

const notificationColumns = `
  n.id AS _id,
  n.user_id AS userId,
  n.title,
  n.message,
  n.type,
  n.is_read AS isRead,
  n.job_id AS jobId,
  n.application_id AS applicationId,
  n.interview_date AS interviewDate,
  n.interview_time AS interviewTime,
  n.interview_format AS interviewFormat,
  n.interview_location AS interviewLocation,
  n.interview_notes AS interviewNotes,
  n.decision_message AS decisionMessage,
  n.created_at AS createdAt,
  n.updated_at AS updatedAt
`;

const reportColumns = `
  r.id AS _id,
  r.user_id AS userId,
  r.type,
  r.subject,
  r.message,
  r.related_job_id AS relatedJobId,
  r.status,
  r.admin_reply AS adminReply,
  r.created_at AS createdAt,
  r.updated_at AS updatedAt
`;

const populatedReportColumns = `
  u.id AS populatedUserId,
  u.name AS populatedUserName,
  u.email AS populatedUserEmail,
  u.role AS populatedUserRole,
  u.phone AS populatedUserPhone,
  u.avatar AS populatedUserAvatar,
  j.id AS populatedJobId,
  j.title AS populatedJobTitle,
  j.company AS populatedJobCompany
`;

class MysqlCommunicationRepository {
  constructor(pool) {
    this.repository = pool instanceof MysqlRepository ? pool : new MysqlRepository(pool);
  }

  async listNotifications(userId) {
    const user = normalizeMongoId(userId);
    const rows = await this.repository.query(
      `SELECT ${notificationColumns},
         j.id AS populatedJobId,
         j.title AS populatedJobTitle,
         j.company AS populatedJobCompany,
         j.location AS populatedJobLocation,
         poster.id AS populatedJobPoster,
         poster.avatar AS populatedJobPosterAvatar,
         a.id AS populatedApplicationId,
         a.status AS populatedApplicationStatus,
         a.job_id AS populatedApplicationJob,
         a.user_id AS populatedApplicationUser
       FROM notifications n
       LEFT JOIN jobs j ON j.id = n.job_id
       LEFT JOIN users poster ON poster.id = j.posted_by
       LEFT JOIN applications a ON a.id = n.application_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC, n.id DESC`,
      [user],
    );
    const [countRow] = await this.repository.query(
      'SELECT COUNT(*) AS unreadCount FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [user],
    );
    return {
      notifications: rows.map(notificationFromRow),
      unreadCount: Number(countRow.unreadCount),
    };
  }

  async getUnreadNotificationCount(userId) {
    const [row] = await this.repository.query(
      'SELECT COUNT(*) AS unreadCount FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [normalizeMongoId(userId)],
    );
    return Number(row.unreadCount);
  }

  async getNotification(userId, notificationId) {
    const rows = await this.repository.query(
      `SELECT ${notificationColumns}
       FROM notifications n
       WHERE n.user_id = ? AND n.id = ?
       LIMIT 1`,
      [normalizeMongoId(userId), normalizeMongoId(notificationId)],
    );
    return rows[0] ? notificationFromRow(rows[0]) : null;
  }

  async markNotificationRead(userId, notificationId) {
    const notification = await this.getNotification(userId, notificationId);
    if (!notification) return null;
    await this.repository.execute(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND id = ?',
      [normalizeMongoId(userId), normalizeMongoId(notificationId)],
    );
    return { ...notification, isRead: true };
  }

  async markAllNotificationsRead(userId) {
    const result = await this.repository.execute(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
      [normalizeMongoId(userId)],
    );
    return result.affectedRows;
  }

  async deleteNotification(userId, notificationId) {
    const result = await this.repository.execute(
      'DELETE FROM notifications WHERE user_id = ? AND id = ?',
      [normalizeMongoId(userId), normalizeMongoId(notificationId)],
    );
    return result.affectedRows > 0;
  }

  async deleteNotifications(userId, notificationIds) {
    const ids = [...new Set(notificationIds.map(normalizeMongoId))];
    if (!ids.length) return 0;
    const result = await this.repository.execute(
      `DELETE FROM notifications WHERE user_id = ?
       AND id IN (${ids.map(() => '?').join(', ')})`,
      [normalizeMongoId(userId), ...ids],
    );
    return result.affectedRows;
  }

  async getConversation(applicationId) {
    const rows = await this.repository.query(
      `SELECT
         a.id AS applicationId,
         a.name AS applicantName,
         a.user_id AS applicantId,
         applicant.name AS applicantUserName,
         applicant.email AS applicantEmail,
         applicant.job_title AS applicantJobTitle,
         applicant.location AS applicantLocation,
         applicant.avatar AS applicantAvatar,
         j.id AS jobId,
         j.title AS jobTitle,
         j.company AS jobCompany,
         j.location AS jobLocation,
         j.posted_by AS jobPosterId,
         poster.name AS posterName,
         poster.company AS posterCompany,
         poster.avatar AS posterAvatar
       FROM applications a
       INNER JOIN jobs j ON j.id = a.job_id
       INNER JOIN users applicant ON applicant.id = a.user_id
       INNER JOIN users poster ON poster.id = j.posted_by
       WHERE a.id = ?
       LIMIT 1`,
      [normalizeMongoId(applicationId)],
    );
    return rows[0] || null;
  }

  async listMessages(applicationId) {
    return this.repository.query(
      `SELECT
         m.id AS _id,
         m.application_id AS application,
         m.job_id AS job,
         m.sender_id AS senderId,
         m.sender_role AS senderRole,
         m.content,
         m.is_read AS isRead,
         m.created_at AS createdAt,
         m.updated_at AS updatedAt,
         u.id AS populatedSenderId,
         u.name AS senderName,
         u.email AS senderEmail,
         u.role AS senderUserRole,
         u.job_title AS senderJobTitle,
         u.company AS senderCompany,
         u.avatar AS senderAvatar
       FROM messages m
       INNER JOIN users u ON u.id = m.sender_id
       WHERE m.application_id = ?
       ORDER BY m.created_at ASC, m.id ASC`,
      [normalizeMongoId(applicationId)],
    );
  }

  async markIncomingMessagesRead(applicationId, userId) {
    await this.repository.execute(
      `UPDATE messages
       SET is_read = TRUE
       WHERE application_id = ? AND sender_id <> ? AND is_read = FALSE`,
      [normalizeMongoId(applicationId), normalizeMongoId(userId)],
    );
  }

  async createMessage({ applicationId, jobId, senderId, senderRole, content }) {
    const messageId = createMongoId();
    await this.repository.execute(
      `INSERT INTO messages
       (id, application_id, job_id, sender_id, sender_role, content)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        messageId,
        normalizeMongoId(applicationId),
        normalizeMongoId(jobId),
        normalizeMongoId(senderId),
        senderRole,
        content,
      ],
    );
    const [row] = await this.repository.query(
      `SELECT
         m.id AS _id,
         m.application_id AS application,
         m.job_id AS job,
         m.sender_role AS senderRole,
         m.content,
         m.is_read AS isRead,
         m.created_at AS createdAt,
         m.updated_at AS updatedAt,
         u.id AS senderId,
         u.name AS senderName,
         u.email AS senderEmail,
         u.role AS senderUserRole,
         u.job_title AS senderJobTitle,
         u.company AS senderCompany,
         u.avatar AS senderAvatar
       FROM messages m
       INNER JOIN users u ON u.id = m.sender_id
       WHERE m.id = ?
       LIMIT 1`,
      [messageId],
    );
    return {
      _id: row._id,
      application: row.application,
      job: row.job,
      sender: {
        _id: row.senderId,
        name: row.senderName,
        email: row.senderEmail,
        role: row.senderUserRole,
        jobTitle: row.senderJobTitle,
        company: row.senderCompany,
        avatar: row.senderAvatar,
      },
      senderRole: row.senderRole,
      content: row.content,
      read: Boolean(row.isRead),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async createNotification({ userId, title = '', message, type = 'system', jobId = null, applicationId = null }) {
    const notificationId = createMongoId();
    const values = [
      notificationId,
      normalizeMongoId(userId),
      title,
      message,
      type,
      jobId ? normalizeMongoId(jobId) : null,
      applicationId ? normalizeMongoId(applicationId) : null,
    ];
    await this.repository.execute(
      `INSERT INTO notifications
       (id, user_id, title, message, type, job_id, application_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      values,
    );
    return this.getNotification(userId, notificationId);
  }

  async createReport({ userId, type, subject, message, relatedJobId }) {
    if (relatedJobId) {
      const [job] = await this.repository.query(
        'SELECT id FROM jobs WHERE id = ? LIMIT 1',
        [normalizeMongoId(relatedJobId)],
      );
      if (!job) throw new TypeError('الوظيفة المرتبطة بالبلاغ غير موجودة');
    }
    const reportId = createMongoId();
    await this.repository.execute(
      `INSERT INTO reports
       (id, user_id, type, subject, message, related_job_id, admin_reply)
       VALUES (?, ?, ?, ?, ?, ?, '')`,
      [
        reportId,
        normalizeMongoId(userId),
        type,
        subject,
        message,
        relatedJobId ? normalizeMongoId(relatedJobId) : null,
      ],
    );
    return this.getReport(reportId);
  }

  async getReport(reportId, populate = false) {
    const joins = populate
      ? `INNER JOIN users u ON u.id = r.user_id
         LEFT JOIN jobs j ON j.id = r.related_job_id`
      : '';
    const extra = populate ? `, ${populatedReportColumns}` : '';
    const rows = await this.repository.query(
      `SELECT ${reportColumns}${extra}
       FROM reports r ${joins}
       WHERE r.id = ?
       LIMIT 1`,
      [normalizeMongoId(reportId)],
    );
    return rows[0] ? reportFromRow(rows[0]) : null;
  }

  async listMyReports(userId) {
    const rows = await this.repository.query(
      `SELECT ${reportColumns}
       FROM reports r
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 50`,
      [normalizeMongoId(userId)],
    );
    return rows.map(reportFromRow);
  }

  async listAdminReports({ page = 1, limit = 10, status, type, search } = {}) {
    const conditions = [];
    const parameters = [];
    if (status === 'open') {
      conditions.push("r.status IN ('pending', 'reviewing')");
    } else if (status && status !== 'all') {
      conditions.push('r.status = ?');
      parameters.push(status);
    }
    if (type && type !== 'all') {
      conditions.push('r.type = ?');
      parameters.push(type);
    }
    if (search && search.trim()) {
      const literal = search.trim().replace(/[!%_]/g, (character) => `!${character}`);
      const term = `%${literal}%`;
      conditions.push("(r.subject LIKE ? ESCAPE '!' OR r.message LIKE ? ESCAPE '!')");
      parameters.push(term, term);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;
    const [rows, countRows, statsRows] = await Promise.all([
      this.repository.query(
        `SELECT ${reportColumns}, ${populatedReportColumns}
         FROM reports r
         INNER JOIN users u ON u.id = r.user_id
         LEFT JOIN jobs j ON j.id = r.related_job_id
         ${where}
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ? OFFSET ?`,
        [...parameters, limitNum, offset],
      ),
      this.repository.query(`SELECT COUNT(*) AS total FROM reports r ${where}`, parameters),
      this.repository.query(
        `SELECT
           SUM(type = 'complaint') AS complaintCount,
           SUM(type = 'suggestion') AS suggestionCount,
           SUM(type = 'complaint' AND status IN ('pending', 'reviewing', 'open')) AS complaintOpenCount,
           SUM(type = 'complaint' AND status = 'resolved') AS complaintResolvedCount,
           SUM(type = 'complaint' AND status = 'rejected') AS complaintRejectedCount,
           SUM(type = 'suggestion' AND status IN ('pending', 'reviewing', 'open')) AS suggestionOpenCount,
           SUM(type = 'suggestion' AND status = 'resolved') AS suggestionResolvedCount,
           SUM(type = 'suggestion' AND status = 'rejected') AS suggestionRejectedCount
         FROM reports`,
      ),
    ]);
    const total = Number(countRows[0].total);
    const stats = Object.fromEntries(
      Object.entries(statsRows[0]).map(([key, value]) => [key, Number(value || 0)]),
    );
    const reports = rows.map(reportFromRow);
    return {
      success: true,
      count: reports.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      stats,
      reports,
    };
  }

  async updateAdminReportStatus(reportId, status, adminReply) {
    return this.repository.transaction(async (connection) => {
      const [reportRows] = await connection.execute(
        `SELECT id, user_id AS userId, type, subject, admin_reply AS adminReply
         FROM reports WHERE id = ? FOR UPDATE`,
        [normalizeMongoId(reportId)],
      );
      const report = reportRows[0];
      if (!report) return null;
      const reply = typeof adminReply === 'string' ? adminReply.trim() : report.adminReply;
      await connection.execute(
        'UPDATE reports SET status = ?, admin_reply = ? WHERE id = ?',
        [status, reply, report.id],
      );
      if (status === 'resolved' || status === 'rejected') {
        const kind = report.type === 'suggestion' ? 'مقترحك' : 'شكواك';
        const title = status === 'resolved' ? `تم الرد على ${kind}` : `تحديث بخصوص ${kind}`;
        const notificationMessage = reply || (
          status === 'resolved'
            ? `تمت مراجعة ${kind} بعنوان "${report.subject}" من إدارة المنصة.`
            : `تم إغلاق ${kind} بعنوان "${report.subject}".`
        );
        await connection.execute(
          `INSERT INTO notifications (id, user_id, title, message, type)
           VALUES (?, ?, ?, ?, 'system')`,
          [createMongoId(), report.userId, title, notificationMessage],
        );
      }
      return true;
    }).then((updated) => (updated ? this.getReport(reportId) : null));
  }

  async getAdminNotifications(adminId) {
    const admin = normalizeMongoId(adminId);
    const [states, companies, jobs, reports, recentJobs, recentCompanies, recentReports, counts] = await Promise.all([
      this.repository.query(
        'SELECT notification_key AS notificationKey, is_read AS isRead, is_deleted AS isDeleted FROM admin_notification_states WHERE admin_id = ?',
        [admin],
      ),
      this.repository.query(
        `SELECT id AS _id, name, email, company, account_status AS accountStatus, created_at AS createdAt, avatar
         FROM users WHERE role = 'employer' AND account_status = 'reviewing'
         ORDER BY created_at DESC LIMIT 20`,
      ),
      this.repository.query(
        `SELECT j.id AS _id, j.title, j.company, j.status, j.created_at AS createdAt,
                j.posted_by AS posterId, u.name AS posterName, u.company AS posterCompany
         FROM jobs j INNER JOIN users u ON u.id = j.posted_by
         WHERE j.status IN ('reviewing', 'deletion_pending')
         ORDER BY j.created_at DESC LIMIT 20`,
      ),
      this.repository.query(
        `SELECT r.id AS _id, r.type, r.subject, r.status, r.created_at AS createdAt,
                u.id AS userId, u.name AS userName, u.email AS userEmail
         FROM reports r INNER JOIN users u ON u.id = r.user_id
         WHERE r.status IN ('pending', 'reviewing', 'open')
         ORDER BY r.created_at DESC LIMIT 20`,
      ),
      this.repository.query(
        `SELECT id AS _id, title, status, created_at AS createdAt FROM jobs
         WHERE status IN ('reviewing', 'deletion_pending')
         ORDER BY created_at DESC LIMIT 4`,
      ),
      this.repository.query(
        `SELECT id AS _id, name, company, created_at AS createdAt FROM users
         WHERE role = 'employer' ORDER BY created_at DESC LIMIT 4`,
      ),
      this.repository.query(
        `SELECT id AS _id, subject, type, created_at AS createdAt FROM reports
         ORDER BY created_at DESC LIMIT 4`,
      ),
      this.repository.query(
        `SELECT
           (SELECT COUNT(*) FROM users u WHERE role = 'employer' AND account_status = 'reviewing'
             AND NOT EXISTS (
               SELECT 1 FROM admin_notification_states s
               WHERE s.admin_id = ? AND s.notification_key = CONCAT('company:', u.id) AND s.is_deleted = TRUE
             )) AS companies,
           (SELECT COUNT(*) FROM jobs j WHERE status IN ('reviewing', 'deletion_pending')
             AND NOT EXISTS (
               SELECT 1 FROM admin_notification_states s
               WHERE s.admin_id = ? AND s.notification_key = CONCAT('job:', j.id) AND s.is_deleted = TRUE
             )) AS jobs,
           (SELECT COUNT(*) FROM reports r WHERE status IN ('pending', 'reviewing', 'open')
             AND NOT EXISTS (
               SELECT 1 FROM admin_notification_states s
               WHERE s.admin_id = ? AND s.notification_key = CONCAT('report:', r.id) AND s.is_deleted = TRUE
             )) AS reports,
           (SELECT COUNT(*) FROM users u WHERE role = 'employer' AND account_status = 'reviewing'
             AND NOT EXISTS (
               SELECT 1 FROM admin_notification_states s
               WHERE s.admin_id = ? AND s.notification_key = CONCAT('company:', u.id)
                 AND (s.is_read = TRUE OR s.is_deleted = TRUE)
             )) AS unreadCompanies,
           (SELECT COUNT(*) FROM jobs j WHERE status IN ('reviewing', 'deletion_pending')
             AND NOT EXISTS (
               SELECT 1 FROM admin_notification_states s
               WHERE s.admin_id = ? AND s.notification_key = CONCAT('job:', j.id)
                 AND (s.is_read = TRUE OR s.is_deleted = TRUE)
             )) AS unreadJobs,
           (SELECT COUNT(*) FROM reports r WHERE status IN ('pending', 'reviewing', 'open')
             AND NOT EXISTS (
               SELECT 1 FROM admin_notification_states s
               WHERE s.admin_id = ? AND s.notification_key = CONCAT('report:', r.id)
                 AND (s.is_read = TRUE OR s.is_deleted = TRUE)
             )) AS unreadReports`,
        [admin, admin, admin, admin, admin, admin],
      ),
    ]);

    const stateByKey = new Map(states.map((state) => [
      state.notificationKey,
      { isRead: Boolean(state.isRead), isDeleted: Boolean(state.isDeleted) },
    ]));
    const decorate = (item, type) => {
      const entityId = item.entityId || item._id;
      const notificationKey = `${type}:${entityId}`;
      const state = stateByKey.get(notificationKey);
      return {
        ...item,
        notificationKey,
        isRead: state?.isRead || false,
        isDeleted: state?.isDeleted || false,
      };
    };
    const visible = (items, type) => items.map((item) => decorate(item, type))
      .filter((item) => !item.isDeleted);
    const reportItems = reports.map((row) => ({
      _id: row._id,
      type: row.type,
      subject: row.subject,
      status: row.status,
      createdAt: row.createdAt,
      user: { _id: row.userId, name: row.userName, email: row.userEmail },
    }));
    const pendingCompanies = visible(companies, 'company');
    const pendingJobs = visible(jobs.map((row) => ({
      _id: row._id,
      title: row.title,
      company: row.company,
      status: row.status,
      createdAt: row.createdAt,
      postedBy: row.posterId ? { _id: row.posterId, name: row.posterName, company: row.posterCompany } : null,
    })), 'job');
    const pendingReports = visible(reportItems, 'report');
    const recentAll = [
      ...recentJobs.map((row) => ({
        type: 'job',
        entityId: row._id,
        searchText: row.title,
        status: row.status,
        text: row.status === 'deletion_pending' ? `طلب حذف وظيفة: ${row.title}` : `وظيفة تنتظر الموافقة: ${row.title}`,
        date: row.createdAt,
      })),
      ...recentCompanies.map((row) => ({
        type: 'company',
        entityId: row._id,
        searchText: row.company || row.name,
        text: `شركة جديدة: ${row.company || row.name}`,
        date: row.createdAt,
      })),
      ...recentReports.map((row) => ({
        type: 'report',
        entityId: row._id,
        searchText: row.subject,
        text: `${row.type === 'complaint' ? 'شكوى' : 'مقترح'}: ${row.subject}`,
        date: row.createdAt,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 20)
      .map((item) => decorate(item, item.type))
      .filter((item) => !item.isDeleted);
    const unreadCounts = {
      companies: Number(counts[0].unreadCompanies),
      jobs: Number(counts[0].unreadJobs),
      reports: Number(counts[0].unreadReports),
    };
    const totalPending = Number(counts[0].companies) + Number(counts[0].jobs) + Number(counts[0].reports);
    const totalUnread = unreadCounts.companies + unreadCounts.jobs + unreadCounts.reports;

    return {
      success: true,
      unreadCount: totalUnread,
      totalPending: totalUnread,
      counts: {
        all: totalPending,
        companies: Number(counts[0].companies),
        jobs: Number(counts[0].jobs),
        reports: Number(counts[0].reports),
      },
      unreadCounts: { all: totalUnread, ...unreadCounts },
      newCompanies: pendingCompanies,
      pendingJobs,
      reports: pendingReports,
      recentAll,
    };
  }

  async getAdminNotificationCount(adminId) {
    const notifications = await this.getAdminNotifications(adminId);
    return {
      success: true,
      unreadCount: notifications.unreadCount,
      totalPending: notifications.unreadCount,
    };
  }

  async updateAdminNotificationStates(adminId, keys, action) {
    const admin = normalizeMongoId(adminId);
    const uniqueKeys = [...new Set(keys)];
    await this.repository.transaction(async (connection) => {
      for (const notificationKey of uniqueKeys) {
        const id = createMongoId();
        const isRead = action === 'read';
        const isDeleted = action === 'delete';
        await connection.execute(
          `INSERT INTO admin_notification_states
             (id, admin_id, notification_key, is_read, is_deleted)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             is_read = IF(VALUES(is_read) = TRUE, TRUE, IF(? = 'unread', FALSE, is_read)),
             is_deleted = IF(VALUES(is_deleted) = TRUE, TRUE, is_deleted)`,
          [id, admin, notificationKey, isRead, isDeleted, action],
        );
      }
    });
    return uniqueKeys.length;
  }
}

module.exports = {
  MysqlCommunicationRepository,
};
