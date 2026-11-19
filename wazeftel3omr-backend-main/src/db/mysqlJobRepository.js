const {
  MysqlRepository,
  createMongoId,
  normalizeMongoId,
} = require('./mysqlRepository');

const jobFields = {
  title: 'title',
  company: 'company',
  location: 'location',
  jobType: 'job_type',
  category: 'category',
  description: 'description',
  salary: 'salary',
  level: 'level',
  experience: 'experience',
  qualifications: 'qualifications',
  specialty: 'specialty',
  degree: 'degree',
  workTime: 'work_time',
  closingDate: 'closing_date',
  status: 'status',
};

const publicListColumns = `
  j.id AS _id,
  j.title,
  j.company,
  j.location,
  j.job_type AS jobType,
  j.category,
  j.level,
  j.created_at AS createdAt,
  j.posted_by AS postedById,
  u.name AS postedByName,
  u.company AS postedByCompany,
  u.avatar AS postedByAvatar
`;

const publicJobColumns = `
  j.id AS _id,
  j.title,
  j.company,
  j.logo_url AS logoUrl,
  j.location,
  j.job_type AS jobType,
  j.category,
  j.description,
  j.salary,
  j.level,
  j.experience,
  j.qualifications,
  j.specialty,
  j.degree,
  j.work_time AS workTime,
  j.closing_date AS closingDate,
  j.status,
  j.deletion_requested AS deletionRequested,
  j.posted_by AS postedById,
  j.created_at AS createdAt,
  j.updated_at AS updatedAt,
  u.name AS postedByName,
  u.email AS postedByEmail,
  u.company AS postedByCompany,
  u.avatar AS postedByAvatar
`;

const ownedJobColumns = `
  id AS _id,
  title,
  company,
  logo_url AS logoUrl,
  location,
  job_type AS jobType,
  category,
  description,
  salary,
  level,
  experience,
  qualifications,
  specialty,
  degree,
  work_time AS workTime,
  closing_date AS closingDate,
  status,
  deletion_requested AS deletionRequested,
  posted_by AS postedBy,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const publicJob = (row, requirements = []) => {
  const postedBy = {
    _id: row.postedById,
    name: row.postedByName,
    company: row.postedByCompany,
    avatar: row.postedByAvatar || '',
  };
  if (Object.hasOwn(row, 'postedByEmail')) postedBy.email = row.postedByEmail;

  return {
    _id: row._id,
    title: row.title,
    company: row.company,
    logoUrl: row.postedByAvatar || '',
    location: row.location,
    jobType: row.jobType,
    category: row.category,
    ...(Object.hasOwn(row, 'description') ? { description: row.description } : {}),
    ...(Object.hasOwn(row, 'salary') ? { salary: row.salary } : {}),
    ...(Object.hasOwn(row, 'level') ? { level: row.level } : {}),
    ...(Object.hasOwn(row, 'experience') ? { experience: row.experience } : {}),
    ...(Object.hasOwn(row, 'qualifications') ? { qualifications: row.qualifications } : {}),
    ...(Object.hasOwn(row, 'specialty') ? { specialty: row.specialty } : {}),
    ...(Object.hasOwn(row, 'degree') ? { degree: row.degree } : {}),
    ...(Object.hasOwn(row, 'workTime') ? { workTime: row.workTime } : {}),
    ...(Object.hasOwn(row, 'closingDate') ? { closingDate: row.closingDate || '' } : {}),
    ...(Object.hasOwn(row, 'status') ? { status: row.status } : {}),
    ...(Object.hasOwn(row, 'deletionRequested')
      ? { deletionRequested: Boolean(row.deletionRequested) }
      : {}),
    createdAt: row.createdAt,
    ...(Object.hasOwn(row, 'updatedAt') ? { updatedAt: row.updatedAt } : {}),
    postedBy,
    ...(Object.hasOwn(row, 'description') ? { requirements } : {}),
  };
};

const ownedJob = (row, requirements = []) => ({
  ...row,
  closingDate: row.closingDate || '',
  deletionRequested: Boolean(row.deletionRequested),
  requirements,
});

class MysqlJobRepository {
  constructor(pool) {
    this.repository = pool instanceof MysqlRepository ? pool : new MysqlRepository(pool);
  }

  async listPublic({ search, location, jobType, category, level, sortBy, page, limit }) {
    const conditions = ["j.status = 'active'"];
    const parameters = [];

    if (search) {
      const term = String(search).trim();
      if (term) {
        conditions.push(`(
          LOCATE(LOWER(?), LOWER(j.title)) > 0
          OR LOCATE(LOWER(?), LOWER(j.company)) > 0
          OR LOCATE(LOWER(?), LOWER(j.category)) > 0
          OR LOCATE(LOWER(?), LOWER(j.description)) > 0
        )`);
        parameters.push(term, term, term, term);
      }
    }
    if (location && location !== 'all') {
      conditions.push('LOCATE(LOWER(?), LOWER(j.location)) > 0');
      parameters.push(String(location));
    }
    if (jobType && jobType !== 'all') {
      conditions.push('j.job_type = ?');
      parameters.push(String(jobType));
    }
    if (level && level !== 'all') {
      conditions.push('j.level = ?');
      parameters.push(String(level));
    }
    if (category && category !== 'all') {
      conditions.push('LOCATE(LOWER(?), LOWER(j.category)) > 0');
      parameters.push(String(category));
    }

    const where = conditions.join(' AND ');
    const sort = sortBy === 'oldest'
      ? 'j.created_at ASC, j.id ASC'
      : sortBy === 'salary_high'
        ? 'j.salary DESC, j.created_at DESC, j.id DESC'
        : 'j.created_at DESC, j.id DESC';
    const offset = (page - 1) * limit;
    const [rows, countRows] = await Promise.all([
      this.repository.query(
        `SELECT ${publicListColumns}
         FROM jobs j
         INNER JOIN users u ON u.id = j.posted_by
         WHERE ${where}
         ORDER BY ${sort}
         LIMIT ? OFFSET ?`,
        [...parameters, limit, offset],
      ),
      this.repository.query(
        `SELECT COUNT(*) AS total
         FROM jobs j
         WHERE ${where}`,
        parameters,
      ),
    ]);

    const requirements = await this.getRequirements(rows.map((row) => row._id));
    return {
      jobs: rows.map((row) => publicJob(row, requirements.get(row._id) || [])),
      total: Number(countRows[0].total),
    };
  }

  async findPublicById(id) {
    const [row] = await this.repository.query(
      `SELECT ${publicJobColumns}
       FROM jobs j
       INNER JOIN users u ON u.id = j.posted_by
       WHERE j.id = ?
       LIMIT 1`,
      [normalizeMongoId(id)],
    );
    if (!row) return null;
    const requirements = await this.getRequirements([row._id]);
    return publicJob(row, requirements.get(row._id) || []);
  }

  async create(data) {
    const id = createMongoId();
    const posterId = normalizeMongoId(data.postedBy);
    await this.repository.transaction(async (connection) => {
      await connection.execute(
        `INSERT INTO jobs (
          id, title, company, logo_url, location, job_type, category, description,
          salary, level, experience, qualifications, specialty, degree, work_time,
          closing_date, status, deletion_requested, posted_by
        ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?)`,
        [
          id,
          data.title,
          data.company,
          data.location,
          data.jobType || 'دوام كامل',
          data.category || 'تطوير البرمجيات',
          data.description,
          data.salary || 'قابل للمفاوضة',
          data.level || 'متوسط',
          data.experience || '1-3 سنوات',
          data.qualifications || 'لا يشترط مؤهل محدد',
          data.specialty || '',
          data.degree || 'لا يشترط شهادة / بدون مؤهل',
          data.workTime || 'صباحي',
          data.closingDate || null,
          data.status || 'reviewing',
          posterId,
        ],
      );
      await this.insertRequirements(connection, id, data.requirements);
    });
    return this.findOwnedById(id);
  }

  async findOwnedById(id) {
    const [row] = await this.repository.query(
      `SELECT ${ownedJobColumns} FROM jobs WHERE id = ? LIMIT 1`,
      [normalizeMongoId(id)],
    );
    if (!row) return null;
    const requirements = await this.getRequirements([row._id]);
    return ownedJob(row, requirements.get(row._id) || []);
  }

  async update(id, updates) {
    const jobId = normalizeMongoId(id);
    await this.repository.transaction(async (connection) => {
      const [jobs] = await connection.execute(
        'SELECT id FROM jobs WHERE id = ? FOR UPDATE',
        [jobId],
      );
      if (!jobs.length) return;

      const assignments = [];
      const parameters = [];
      for (const [field, value] of Object.entries(updates)) {
        if (field === 'requirements') continue;
        const column = jobFields[field];
        if (!column) throw new TypeError(`Unsupported job update field: ${field}`);
        assignments.push(`${column} = ?`);
        parameters.push(field === 'closingDate' && value === '' ? null : value);
      }
      if (assignments.length > 0) {
        assignments.push('updated_at = CURRENT_TIMESTAMP(3)');
        parameters.push(jobId);
        await connection.execute(
          `UPDATE jobs SET ${assignments.join(', ')} WHERE id = ?`,
          parameters,
        );
      }
      if (updates.requirements !== undefined) {
        await this.replaceRequirements(connection, jobId, updates.requirements);
      }
    });
    return this.findOwnedById(jobId);
  }

  async markDeletionPending(id) {
    const jobId = normalizeMongoId(id);
    await this.repository.execute(
      `UPDATE jobs
       SET status = 'deletion_pending', deletion_requested = TRUE,
           updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [jobId],
    );
    return this.findOwnedById(jobId);
  }

  async delete(id) {
    const result = await this.repository.execute(
      'DELETE FROM jobs WHERE id = ?',
      [normalizeMongoId(id)],
    );
    return result.affectedRows === 1;
  }

  async listOwnedByUser(userId) {
    const id = normalizeMongoId(userId);
    const rows = await this.repository.query(
      `SELECT ${ownedJobColumns},
         (SELECT COUNT(DISTINCT a.user_id) FROM applications a WHERE a.job_id = jobs.id)
           AS applicantsCount
       FROM jobs
       WHERE posted_by = ?
       ORDER BY created_at DESC, id DESC`,
      [id],
    );
    const requirements = await this.getRequirements(rows.map((row) => row._id));
    return rows.map((row) => ({
      ...ownedJob(row, requirements.get(row._id) || []),
      applicantsCount: Number(row.applicantsCount),
    }));
  }

  async toggleSavedJob(userId, jobId) {
    const normalizedUserId = normalizeMongoId(userId);
    const normalizedJobId = normalizeMongoId(jobId);
    return this.repository.transaction(async (connection) => {
      await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [normalizedUserId]);
      const [existing] = await connection.execute(
        'SELECT id FROM saved_jobs WHERE user_id = ? AND job_id = ? LIMIT 1',
        [normalizedUserId, normalizedJobId],
      );
      if (existing.length) {
        await connection.execute(
          'DELETE FROM saved_jobs WHERE user_id = ? AND job_id = ?',
          [normalizedUserId, normalizedJobId],
        );
        return false;
      }
      await connection.execute(
        'INSERT INTO saved_jobs (id, user_id, job_id) VALUES (?, ?, ?)',
        [createMongoId(), normalizedUserId, normalizedJobId],
      );
      return true;
    });
  }

  async listSavedJobs(userId) {
    const rows = await this.repository.query(
      `SELECT j.id AS _id, j.title, j.company, j.location,
          j.job_type AS jobType, j.category, j.salary, j.created_at AS createdAt,
          j.description, j.posted_by AS postedById, u.avatar AS postedByAvatar
       FROM saved_jobs s
       INNER JOIN jobs j ON j.id = s.job_id AND j.status = 'active'
       INNER JOIN users u ON u.id = j.posted_by
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC, s.id DESC`,
      [normalizeMongoId(userId)],
    );
    return rows.map((row) => ({
      _id: row._id,
      title: row.title,
      company: row.company,
      location: row.location,
      jobType: row.jobType,
      category: row.category,
      salary: row.salary,
      createdAt: row.createdAt,
      description: row.description,
      logoUrl: row.postedByAvatar || '',
      postedBy: { _id: row.postedById, avatar: row.postedByAvatar || '' },
    }));
  }

  async closeExpiredJobs(cairoDate) {
    const expiredJobs = await this.repository.query(
      `SELECT id
       FROM jobs
       WHERE status = 'active'
         AND closing_date IS NOT NULL
         AND closing_date <> ''
         AND closing_date < ?
       ORDER BY id`,
      [cairoDate],
    );
    let modifiedCount = 0;
    for (const { id } of expiredJobs) {
      const result = await this.repository.execute(
        `UPDATE jobs
         SET status = 'closed', updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?
           AND status = 'active'
           AND closing_date IS NOT NULL
           AND closing_date <> ''
           AND closing_date < ?`,
        [id, cairoDate],
      );
      modifiedCount += result.affectedRows;
    }
    return { modifiedCount };
  }

  async createNotification({ userId, jobId, title, message, type }) {
    await this.repository.execute(
      `INSERT INTO notifications (
        id, user_id, title, message, type, job_id,
        interview_date, interview_time, interview_location, interview_notes, decision_message
      ) VALUES (?, ?, ?, ?, ?, ?, '', '', '', '', '')`,
      [createMongoId(), normalizeMongoId(userId), title, message, type, normalizeMongoId(jobId)],
    );
  }

  async getRequirements(jobIds) {
    const ids = [...new Set(jobIds.map(normalizeMongoId))];
    if (!ids.length) return new Map();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await this.repository.query(
      `SELECT job_id AS jobId, requirement
       FROM job_requirements
       WHERE job_id IN (${placeholders})
       ORDER BY job_id, position`,
      ids,
    );
    const grouped = new Map(ids.map((id) => [id, []]));
    for (const row of rows) grouped.get(row.jobId).push(row.requirement);
    return grouped;
  }

  async replaceRequirements(connection, jobId, requirements = []) {
    if (!Array.isArray(requirements)) {
      throw new TypeError('Job requirements must be an array');
    }
    await connection.execute('DELETE FROM job_requirements WHERE job_id = ?', [jobId]);
    await this.insertRequirements(connection, jobId, requirements);
  }

  async insertRequirements(connection, jobId, requirements = []) {
    if (!Array.isArray(requirements)) {
      throw new TypeError('Job requirements must be an array');
    }
    for (const [position, requirement] of requirements.entries()) {
      await connection.execute(
        'INSERT INTO job_requirements (job_id, position, requirement) VALUES (?, ?, ?)',
        [jobId, position, String(requirement)],
      );
    }
  }
}

module.exports = { MysqlJobRepository };
