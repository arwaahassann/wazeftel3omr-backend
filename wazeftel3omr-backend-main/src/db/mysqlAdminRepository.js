const {
  MysqlRepository,
  createMongoId,
  normalizeMongoId,
} = require('./mysqlRepository');
const { normalizePhoneInput } = require('../utils/accountIdentity');

const userCardColumns = `
  u.id AS _id,
  u.name,
  u.email,
  u.role,
  u.phone,
  u.company,
  u.company_website AS companyWebsite,
  u.company_industry AS companyIndustry,
  u.location,
  u.detailed_address AS detailedAddress,
  u.job_title AS jobTitle,
  u.account_status AS accountStatus,
  u.created_at AS createdAt,
  u.avatar,
  u.is_verified AS isVerified
`;

const jobListColumns = `
  j.id AS _id,
  j.title,
  j.company,
  j.location,
  j.job_type AS jobType,
  j.created_at AS createdAt,
  j.status,
  j.posted_by AS postedById,
  u.company AS postedByCompany
`;

const mapUser = (row) => {
  if (!row) return null;
  const user = { ...row };
  if (Object.hasOwn(user, 'isVerified')) user.isVerified = Boolean(user.isVerified);
  return user;
};

const mapAdminJob = (row) => {
  const job = {
    _id: row._id,
    title: row.title,
    company: row.company,
    location: row.location,
    jobType: row.jobType,
    createdAt: row.createdAt,
    status: row.status,
    postedBy: row.postedById
      ? { _id: row.postedById, ...(row.postedByCompany !== undefined ? { company: row.postedByCompany } : {}) }
      : row.postedById,
  };
  return job;
};

const toLiteralPattern = (value) => String(value).trim();

class MysqlAdminRepository {
  constructor(pool) {
    this.repository = pool instanceof MysqlRepository ? pool : new MysqlRepository(pool);
  }

  async listCompanies({ page = 1, limit = 10, search, status } = {}) {
    const conditions = ["u.role = 'employer'"];
    const parameters = [];
    if (status && status !== 'all') {
      conditions.push('u.account_status = ?');
      parameters.push(status);
    }
    if (search && String(search).trim()) {
      const term = toLiteralPattern(search);
      conditions.push(`(
        LOCATE(LOWER(?), LOWER(u.company)) > 0
        OR LOCATE(LOWER(?), LOWER(u.name)) > 0
        OR LOCATE(LOWER(?), LOWER(u.email)) > 0
        OR LOCATE(LOWER(?), LOWER(u.phone)) > 0
      )`);
      parameters.push(term, term, term, term);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 10));
    const [rows, countRows] = await Promise.all([
      this.repository.query(
        `SELECT ${userCardColumns},
           cr.file_name AS commercialRegisterFileName,
           cr.mime_type AS commercialRegisterMimeType,
           cr.uploaded_at AS commercialRegisterUploadedAt,
           tax.file_name AS taxCardFileName,
           tax.mime_type AS taxCardMimeType,
           tax.uploaded_at AS taxCardUploadedAt
         FROM users u
         LEFT JOIN company_documents cr
           ON cr.user_id = u.id AND cr.document_type = 'commercialRegister'
         LEFT JOIN company_documents tax
           ON tax.user_id = u.id AND tax.document_type = 'taxCard'
         ${where}
         ORDER BY u.created_at DESC, u.id DESC
         LIMIT ? OFFSET ?`,
        [...parameters, limitNum, (pageNum - 1) * limitNum],
      ),
      this.repository.query(`SELECT COUNT(*) AS total FROM users u ${where}`, parameters),
    ]);
    const companies = rows.map((row) => {
      const company = mapUser(row);
      delete company.role;
      delete company.isVerified;
      company.companyDocuments = {};
      if (row.commercialRegisterFileName) {
        company.companyDocuments.commercialRegister = {
          fileName: row.commercialRegisterFileName,
          mimeType: row.commercialRegisterMimeType,
          uploadedAt: row.commercialRegisterUploadedAt,
        };
      }
      if (row.taxCardFileName) {
        company.companyDocuments.taxCard = {
          fileName: row.taxCardFileName,
          mimeType: row.taxCardMimeType,
          uploadedAt: row.taxCardUploadedAt,
        };
      }
      return company;
    });
    const total = Number(countRows[0].total);
    return {
      companies,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
    };
  }

  async updateCompanyStatus(companyId, status) {
    const id = normalizeMongoId(companyId);
    if (status === 'active') {
      const rows = await this.repository.query(
        `SELECT u.phone, u.location, u.detailed_address AS detailedAddress,
           cr.file_name AS commercialRegisterFileName,
           cr.mime_type AS commercialRegisterMimeType,
           tax.file_name AS taxCardFileName,
           tax.mime_type AS taxCardMimeType
         FROM users u
         LEFT JOIN company_documents cr
           ON cr.user_id = u.id AND cr.document_type = 'commercialRegister'
         LEFT JOIN company_documents tax
           ON tax.user_id = u.id AND tax.document_type = 'taxCard'
         WHERE u.id = ? AND u.role = 'employer'
         LIMIT 1`,
        [id],
      );
      const company = rows[0];
      if (!company) return { error: 'NOT_FOUND' };
      const phone = normalizePhoneInput(company.phone);
      const digits = phone.replace(/\D/g, '');
      if (!/^[+\d\s().-]+$/.test(phone) || digits.length < 8 || digits.length > 15) {
        return { error: 'INVALID_PHONE' };
      }
      if (!company.location || !company.detailedAddress
        || !company.commercialRegisterFileName || !company.taxCardFileName) {
        return { error: 'INCOMPLETE_COMPANY' };
      }
    }
    await this.repository.execute(
      "UPDATE users SET account_status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND role = 'employer'",
      [status, id],
    );
    const rows = await this.repository.query(
      `SELECT id AS _id, name, email, company, account_status AS accountStatus
       FROM users WHERE id = ? AND role = 'employer' LIMIT 1`,
      [id],
    );
    return rows[0] ? { company: rows[0] } : { error: 'NOT_FOUND' };
  }

  async getCompanyDocument(companyId, documentType) {
    const rows = await this.repository.query(
      `SELECT d.file_name AS fileName, d.mime_type AS mimeType,
         d.data_url AS dataUrl, d.uploaded_at AS uploadedAt
       FROM company_documents d
       INNER JOIN users u ON u.id = d.user_id
       WHERE u.id = ? AND u.role = 'employer' AND d.document_type = ?
       LIMIT 1`,
      [normalizeMongoId(companyId), documentType],
    );
    return rows[0] || null;
  }

  async listSeekers({ page = 1, limit = 10, search, status } = {}) {
    const conditions = ["u.role = 'job_seeker'"];
    const parameters = [];
    if (status && status !== 'all') {
      conditions.push('u.account_status = ?');
      parameters.push(status);
    }
    if (typeof search === 'string' && search.trim()) {
      const term = toLiteralPattern(search);
      conditions.push(`(
        LOCATE(LOWER(?), LOWER(u.name)) > 0
        OR LOCATE(LOWER(?), LOWER(u.email)) > 0
        OR LOCATE(LOWER(?), LOWER(u.phone)) > 0
        OR LOCATE(LOWER(?), LOWER(u.job_title)) > 0
      )`);
      parameters.push(term, term, term, term);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 10));
    const [rows, countRows] = await Promise.all([
      this.repository.query(
        `SELECT ${userCardColumns}
         FROM users u ${where}
         ORDER BY u.created_at DESC, u.id DESC
         LIMIT ? OFFSET ?`,
        [...parameters, limitNum, (pageNum - 1) * limitNum],
      ),
      this.repository.query(`SELECT COUNT(*) AS total FROM users u ${where}`, parameters),
    ]);
    const total = Number(countRows[0].total);
    return {
      seekers: rows.map((row) => {
        const seeker = mapUser(row);
        delete seeker.role;
        delete seeker.company;
        delete seeker.companyWebsite;
        delete seeker.companyIndustry;
        delete seeker.location;
        delete seeker.detailedAddress;
        return seeker;
      }),
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
    };
  }

  async updateSeekerStatus(seekerId, status) {
    await this.repository.execute(
      "UPDATE users SET account_status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND role = 'job_seeker'",
      [status, normalizeMongoId(seekerId)],
    );
    const rows = await this.repository.query(
      `SELECT id AS _id, name, email, account_status AS accountStatus
       FROM users WHERE id = ? AND role = 'job_seeker' LIMIT 1`,
      [normalizeMongoId(seekerId)],
    );
    return rows[0] || null;
  }

  async listJobs({ cursor, search, status, limit = 10 } = {}) {
    const conditions = [];
    const parameters = [];
    if (status && status !== 'all') {
      conditions.push('j.status = ?');
      parameters.push(status);
    }
    if (search && String(search).trim()) {
      const term = toLiteralPattern(search);
      conditions.push(`(
        LOCATE(LOWER(?), LOWER(j.title)) > 0
        OR LOCATE(LOWER(?), LOWER(j.company)) > 0
        OR LOCATE(LOWER(?), LOWER(j.location)) > 0
        OR LOCATE(LOWER(?), LOWER(j.category)) > 0
      )`);
      parameters.push(term, term, term, term);
    }
    if (cursor) {
      let decoded;
      try {
        decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
        const id = normalizeMongoId(decoded.id);
        const createdAt = new Date(decoded.createdAt);
        if (!Number.isFinite(createdAt.getTime())) throw new TypeError('Invalid job cursor');
        conditions.push('(j.created_at < ? OR (j.created_at = ? AND j.id < ?))');
        parameters.push(createdAt, createdAt, id);
      } catch {
        return { error: 'INVALID_CURSOR' };
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitNum = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 10));
    const rows = await this.repository.query(
      `SELECT ${jobListColumns}
       FROM jobs j
       INNER JOIN users u ON u.id = j.posted_by
       ${where}
       ORDER BY j.created_at DESC, j.id DESC
       LIMIT ?`,
      [...parameters, limitNum + 1],
    );
    const hasMore = rows.length > limitNum;
    if (hasMore) rows.pop();
    const last = rows[rows.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last._id })).toString('base64url')
      : null;
    return {
      jobs: rows.map(mapAdminJob),
      hasMore,
      nextCursor,
    };
  }

  async getJobDetails(jobId) {
    const rows = await this.repository.query(
      `SELECT j.id AS _id, j.title, j.company, j.logo_url AS logoUrl,
         j.location, j.job_type AS jobType, j.category, j.description,
         j.salary, j.level, j.experience, j.qualifications, j.specialty,
         j.degree, j.work_time AS workTime, j.closing_date AS closingDate,
         j.status, j.deletion_requested AS deletionRequested,
         j.posted_by AS posterId, j.created_at AS createdAt, j.updated_at AS updatedAt,
         u.id AS employerId, u.name AS employerName, u.email AS employerEmail,
         u.phone AS employerPhone, u.company AS employerCompany,
         u.company_website AS employerCompanyWebsite,
         u.company_industry AS employerCompanyIndustry,
         u.location AS employerLocation, u.account_status AS employerAccountStatus,
         u.avatar AS employerAvatar
       FROM jobs j
       LEFT JOIN users u ON u.id = j.posted_by
       WHERE j.id = ?
       LIMIT 1`,
      [normalizeMongoId(jobId)],
    );
    const row = rows[0];
    if (!row) return null;
    const requirements = await this.repository.query(
      'SELECT requirement FROM job_requirements WHERE job_id = ? ORDER BY position',
      [row._id],
    );
    const job = {
      _id: row._id,
      title: row.title,
      company: row.company,
      logoUrl: row.logoUrl,
      location: row.location,
      jobType: row.jobType,
      category: row.category,
      description: row.description,
      salary: row.salary,
      level: row.level,
      experience: row.experience,
      qualifications: row.qualifications,
      specialty: row.specialty,
      degree: row.degree,
      workTime: row.workTime,
      closingDate: row.closingDate instanceof Date
        ? row.closingDate.toISOString().slice(0, 10)
        : String(row.closingDate || ''),
      status: row.status,
      deletionRequested: Boolean(row.deletionRequested),
      postedBy: row.employerId ? {
        _id: row.employerId,
        name: row.employerName,
        email: row.employerEmail,
        phone: row.employerPhone,
        company: row.employerCompany,
        companyWebsite: row.employerCompanyWebsite,
        companyIndustry: row.employerCompanyIndustry,
        location: row.employerLocation,
        accountStatus: row.employerAccountStatus,
        avatar: row.employerAvatar,
      } : null,
      requirements: requirements.map((item) => item.requirement),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    return job;
  }

  async updateJobStatus(jobId, status) {
    await this.repository.execute(
      'UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [status, normalizeMongoId(jobId)],
    );
    return this.getJobDetails(jobId);
  }

  async getEmployerEmail(employerId) {
    if (!employerId) return null;
    const rows = await this.repository.query(
      "SELECT email FROM users WHERE id = ? AND role = 'employer' LIMIT 1",
      [normalizeMongoId(employerId)],
    );
    return rows[0]?.email || null;
  }

  async createJobStatusNotification(userId, jobId, title, message) {
    if (!userId) return false;
    await this.repository.execute(
      `INSERT INTO notifications
         (id, user_id, title, message, type, job_id, interview_date, interview_time,
          interview_location, interview_notes, decision_message)
       VALUES (?, ?, ?, ?, 'system', ?, '', '', '', '', '')`,
      [createMongoId(), normalizeMongoId(userId), title, message, normalizeMongoId(jobId)],
    );
    return true;
  }

  async deleteJob(jobId) {
    const id = normalizeMongoId(jobId);
    return this.repository.transaction(async (connection) => {
      const [rows] = await connection.execute(
        'SELECT id, posted_by AS postedBy, title FROM jobs WHERE id = ? FOR UPDATE',
        [id],
      );
      const job = rows[0];
      if (!job) return null;
      const [result] = await connection.execute('DELETE FROM jobs WHERE id = ?', [id]);
      if (result.affectedRows !== 1) return null;
      await connection.execute(
        `INSERT INTO notifications
           (id, user_id, title, message, type, interview_date, interview_time,
            interview_location, interview_notes, decision_message)
         VALUES (?, ?, ?, ?, 'system', '', '', '', '', '')`,
        [
          createMongoId(),
          job.postedBy,
          'تم حذف الوظيفة من المنصة 🗑️',
          `تمت الموافقة على حذف وظيفة "${job.title}" وتمت إزالتها نهائياً من المنصة.`,
        ],
      );
      return job;
    });
  }
}

module.exports = { MysqlAdminRepository };
