const bcrypt = require('bcryptjs');
const { MysqlRepository, createMongoId, normalizeMongoId } = require('./mysqlRepository');

const userColumns = `
  id AS _id,
  name,
  email,
  password_hash AS password,
  role,
  job_title AS jobTitle,
  company,
  company_website AS companyWebsite,
  company_industry AS companyIndustry,
  location,
  detailed_address AS detailedAddress,
  phone,
  bio,
  cv_url AS cvUrl,
  google_id AS googleId,
  gmail_sender_email AS gmailSenderEmail,
  gmail_refresh_token_encrypted AS gmailRefreshTokenEncrypted,
  gmail_connected_at AS gmailConnectedAt,
  avatar,
  otp_code AS otpCode,
  otp_expire AS otpExpire,
  is_verified AS isVerified,
  reset_password_token AS resetPasswordToken,
  reset_password_expire AS resetPasswordExpire,
  last_login AS lastLogin,
  account_status AS accountStatus,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const profileFields = [
  'name',
  'jobTitle',
  'company',
  'companyWebsite',
  'companyIndustry',
  'location',
  'detailedAddress',
  'phone',
  'bio',
  'cvUrl',
  'avatar',
];

const nullableText = (value) => (value === undefined ? null : value);

class MysqlUserRepository {
  constructor(pool) {
    this.repository = pool instanceof MysqlRepository ? pool : new MysqlRepository(pool);
  }

  async findById(id) {
    const [user] = await this.repository.query(
      `SELECT ${userColumns} FROM users WHERE id = ? LIMIT 1`,
      [normalizeMongoId(id)],
    );
    if (!user) return null;

    const [skills, experiences, savedJobs, documents] = await Promise.all([
      this.repository.query(
        'SELECT skill FROM user_skills WHERE user_id = ? ORDER BY position',
        [user._id],
      ),
      this.repository.query(
        'SELECT title, company, period FROM user_experiences WHERE user_id = ? ORDER BY position',
        [user._id],
      ),
      this.repository.query(
        'SELECT job_id AS job FROM saved_jobs WHERE user_id = ? ORDER BY created_at DESC',
        [user._id],
      ),
      this.repository.query(
        `SELECT document_type AS documentType, file_name AS fileName,
          mime_type AS mimeType, data_url AS dataUrl, uploaded_at AS uploadedAt
         FROM company_documents WHERE user_id = ?`,
        [user._id],
      ),
    ]);

    delete user.password;
    delete user.otpCode;
    delete user.otpExpire;
    delete user.resetPasswordToken;
    delete user.resetPasswordExpire;
    delete user.gmailSenderEmail;
    delete user.gmailRefreshTokenEncrypted;
    delete user.gmailConnectedAt;
    user.id = user._id;
    user.skills = skills.map((row) => row.skill);
    user.experiences = experiences;
    user.savedJobs = savedJobs.map((row) => row.job);

    if (user.role === 'employer') {
      user.companyDocuments = {};
      for (const document of documents) {
        user.companyDocuments[document.documentType] = {
          fileName: document.fileName,
          mimeType: document.mimeType,
          ...(document.dataUrl ? { dataUrl: document.dataUrl } : {}),
          uploadedAt: document.uploadedAt,
        };
      }
    }

    return user;
  }

  async findByEmail(email) {
    const [user] = await this.repository.query(
      `SELECT ${userColumns} FROM users WHERE email = ? LIMIT 1`,
      [String(email).trim().toLowerCase()],
    );
    return user || null;
  }

  async getGmailConnection(id) {
    const [user] = await this.repository.query(
      `SELECT id AS _id, role, gmail_sender_email AS gmailSenderEmail,
         gmail_refresh_token_encrypted AS gmailRefreshTokenEncrypted,
         gmail_connected_at AS gmailConnectedAt
       FROM users WHERE id = ? LIMIT 1`,
      [normalizeMongoId(id)],
    );
    return user || null;
  }

  async searchAdminAccounts(search) {
    const term = String(search).trim();
    const rows = await this.repository.query(
      `SELECT
         id AS _id,
         name,
         email,
         role,
         phone,
         company,
         account_status AS accountStatus,
         created_at AS createdAt,
         avatar,
         is_verified AS isVerified
       FROM users
       WHERE role IN ('job_seeker', 'employer')
         AND (
           LOCATE(LOWER(?), LOWER(name)) > 0
           OR LOCATE(LOWER(?), LOWER(email)) > 0
           OR LOCATE(LOWER(?), LOWER(phone)) > 0
           OR LOCATE(LOWER(?), LOWER(company)) > 0
         )
       ORDER BY created_at DESC, id DESC
       LIMIT 8`,
      [term, term, term, term],
    );
    return rows.map((row) => ({ ...row, isVerified: Boolean(row.isVerified) }));
  }

  async findPhoneConflict(phoneMatch, role, excludingId) {
    if (!phoneMatch) return null;
    const parameters = [role];
    let sql = 'SELECT id AS _id, role, phone FROM users WHERE role <> ? AND phone <> \'\'';
    if (excludingId) {
      sql += ' AND id <> ?';
      parameters.push(normalizeMongoId(excludingId));
    }

    const candidates = await this.repository.query(sql, parameters);
    return candidates.find((candidate) => phoneMatch.test(candidate.phone)) || null;
  }

  async create(data) {
    const id = data.id ? normalizeMongoId(data.id) : createMongoId();
    const password = String(data.password);
    const passwordHash = /^\$2[aby]\$/.test(password)
      ? password
      : await bcrypt.hash(password, await bcrypt.genSalt(12));
    const now = new Date();
    const values = {
      id,
      name: data.name,
      email: String(data.email).trim().toLowerCase(),
      password_hash: passwordHash,
      role: data.role || 'job_seeker',
      job_title: data.jobTitle || '',
      company: data.company || '',
      company_website: data.companyWebsite || '',
      company_industry: data.companyIndustry || '',
      location: data.location || '',
      detailed_address: data.detailedAddress || '',
      phone: data.phone || '',
      bio: data.bio || '',
      cv_url: data.cvUrl || '',
      google_id: data.googleId || null,
      gmail_sender_email: data.gmailSenderEmail || null,
      gmail_refresh_token_encrypted: data.gmailRefreshTokenEncrypted || null,
      gmail_connected_at: data.gmailConnectedAt || null,
      avatar: data.avatar || null,
      otp_code: data.otpCode || null,
      otp_expire: data.otpExpire || null,
      is_verified: Boolean(data.isVerified),
      reset_password_token: data.resetPasswordToken || null,
      reset_password_expire: data.resetPasswordExpire || null,
      last_login: data.lastLogin || null,
      account_status: data.accountStatus || 'active',
      created_at: data.createdAt || now,
      updated_at: data.updatedAt || now,
    };
    const fields = Object.keys(values);
    const placeholders = fields.map(() => '?').join(', ');
    await this.repository.execute(
      `INSERT INTO users (${fields.join(', ')}) VALUES (${placeholders})`,
      fields.map((field) => values[field]),
    );
    return this.findById(id);
  }

  async update(id, updates, { includeSensitive = false } = {}) {
    const userId = normalizeMongoId(id);
    const columns = {
      name: 'name',
      email: 'email',
      password: 'password_hash',
      role: 'role',
      jobTitle: 'job_title',
      company: 'company',
      companyWebsite: 'company_website',
      companyIndustry: 'company_industry',
      location: 'location',
      detailedAddress: 'detailed_address',
      phone: 'phone',
      bio: 'bio',
      cvUrl: 'cv_url',
      googleId: 'google_id',
      gmailSenderEmail: 'gmail_sender_email',
      gmailRefreshTokenEncrypted: 'gmail_refresh_token_encrypted',
      gmailConnectedAt: 'gmail_connected_at',
      avatar: 'avatar',
      otpCode: 'otp_code',
      otpExpire: 'otp_expire',
      isVerified: 'is_verified',
      resetPasswordToken: 'reset_password_token',
      resetPasswordExpire: 'reset_password_expire',
      lastLogin: 'last_login',
      accountStatus: 'account_status',
    };
    const assignments = [];
    const values = [];

    for (const [field, value] of Object.entries(updates)) {
      const column = columns[field];
      if (!column || (field === 'password' && !includeSensitive)) {
        throw new TypeError(`Unsupported user update field: ${field}`);
      }
      assignments.push(`${column} = ?`);
      values.push(field === 'email' ? String(value).trim().toLowerCase() : value);
    }

    if (assignments.length === 0) return this.findById(userId);
    assignments.push('updated_at = CURRENT_TIMESTAMP(3)');
    values.push(userId);
    await this.repository.execute(
      `UPDATE users SET ${assignments.join(', ')} WHERE id = ?`,
      values,
    );
    return this.findById(userId);
  }

  async updatePassword(id, password) {
    const hash = await bcrypt.hash(String(password), await bcrypt.genSalt(12));
    await this.update(id, { password: hash }, { includeSensitive: true });
  }

  async consumeOtp(id, otp, updates) {
    const userId = normalizeMongoId(id);
    const columns = {
      password: 'password_hash',
      isVerified: 'is_verified',
      lastLogin: 'last_login',
    };
    const assignments = [];
    const values = [];
    for (const [field, value] of Object.entries(updates)) {
      const column = columns[field];
      if (!column) throw new TypeError(`Unsupported OTP update field: ${field}`);
      assignments.push(`${column} = ?`);
      values.push(value);
    }

    assignments.push('otp_code = NULL', 'otp_expire = NULL', 'updated_at = CURRENT_TIMESTAMP(3)');
    const [result] = await this.repository.pool.execute(
      `UPDATE users SET ${assignments.join(', ')}
       WHERE id = ? AND otp_code = ? AND otp_expire IS NOT NULL
         AND otp_expire >= UTC_TIMESTAMP(3)`,
      [...values, userId, String(otp).trim()],
    );
    return result.affectedRows === 1;
  }

  async updateProfile(id, updates) {
    const userId = normalizeMongoId(id);
    const scalarUpdates = Object.fromEntries(
      Object.entries(updates).filter(([field]) => profileFields.includes(field)),
    );
    const connection = await this.repository.pool.getConnection();
    try {
      await connection.beginTransaction();

      const columns = {
        name: 'name',
        jobTitle: 'job_title',
        company: 'company',
        companyWebsite: 'company_website',
        companyIndustry: 'company_industry',
        location: 'location',
        detailedAddress: 'detailed_address',
        phone: 'phone',
        bio: 'bio',
        cvUrl: 'cv_url',
        avatar: 'avatar',
      };
      const assignments = [];
      const values = [];
      for (const [field, value] of Object.entries(scalarUpdates)) {
        assignments.push(`${columns[field]} = ?`);
        values.push(value);
      }
      if (assignments.length > 0) {
        assignments.push('updated_at = CURRENT_TIMESTAMP(3)');
        values.push(userId);
        await connection.execute(
          `UPDATE users SET ${assignments.join(', ')} WHERE id = ?`,
          values,
        );
      }

      if (updates.skills !== undefined) {
        if (!Array.isArray(updates.skills) || updates.skills.some((skill) => typeof skill !== 'string')) {
          throw new TypeError('Skills must be an array of strings');
        }
        await connection.execute('DELETE FROM user_skills WHERE user_id = ?', [userId]);
        if (updates.skills.length > 0) {
          await connection.query(
            'INSERT INTO user_skills (user_id, position, skill) VALUES ?',
            [updates.skills.map((skill, position) => [userId, position, skill])],
          );
        }
      }

      if (updates.experiences !== undefined) {
        if (!Array.isArray(updates.experiences)) {
          throw new TypeError('Experiences must be an array');
        }
        await connection.execute('DELETE FROM user_experiences WHERE user_id = ?', [userId]);
        if (updates.experiences.length > 0) {
          await connection.query(
            'INSERT INTO user_experiences (user_id, position, title, company, period) VALUES ?',
            [updates.experiences.map((experience, position) => [
              userId,
              position,
              experience.title,
              experience.company,
              experience.period,
            ])],
          );
        }
      }

      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    } finally {
      connection.release();
    }
    return this.findById(userId);
  }

  async upsertCompanyDocument(userId, documentType, document) {
    await this.repository.execute(
      `INSERT INTO company_documents
         (user_id, document_type, file_name, mime_type, data_url, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE file_name = VALUES(file_name),
         mime_type = VALUES(mime_type), data_url = VALUES(data_url),
         uploaded_at = VALUES(uploaded_at)`,
      [
        normalizeMongoId(userId),
        documentType,
        document.fileName,
        document.mimeType,
        document.dataUrl,
        document.uploadedAt,
      ],
    );
  }

  async getCompanyDocument(userId, documentType) {
    const [document] = await this.repository.query(
      `SELECT file_name AS fileName, mime_type AS mimeType,
         data_url AS dataUrl, uploaded_at AS uploadedAt
       FROM company_documents WHERE user_id = ? AND document_type = ?`,
      [normalizeMongoId(userId), documentType],
    );
    return document || null;
  }
}

const createMysqlUserRepository = (pool) => new MysqlUserRepository(pool);

module.exports = { MysqlUserRepository, createMysqlUserRepository };
