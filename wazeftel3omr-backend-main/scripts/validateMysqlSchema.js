require('dotenv').config({ quiet: true });

const { getMysqlPool } = require('../src/config/mysql');

const requiredTables = [
  'users',
  'user_skills',
  'user_experiences',
  'company_documents',
  'jobs',
  'job_requirements',
  'applications',
  'notifications',
  'messages',
  'reports',
  'saved_jobs',
  'admin_notification_states',
];

const requiredIndexes = {
  users: [
    'uq_users_email',
    'idx_users_phone_role',
    'idx_users_role_status_created',
    'idx_users_role_created',
    'idx_users_role_name',
    'idx_users_role_company',
    'idx_users_role_job_title',
  ],
  jobs: [
    'idx_jobs_status_created_id',
    'idx_jobs_posted_created',
    'idx_jobs_posted_status',
    'idx_jobs_category_status',
    'idx_jobs_location_status',
    'idx_jobs_status_closing_date',
    'idx_jobs_job_type',
    'idx_jobs_level',
    'idx_jobs_salary',
    'idx_jobs_title',
    'idx_jobs_company',
  ],
  applications: [
    'uq_applications_user_job',
    'uq_applications_id_job',
    'idx_applications_user_status_created',
    'idx_applications_job_status_created',
  ],
  notifications: [
    'idx_notifications_user_created',
    'idx_notifications_user_read',
    'idx_notifications_user_created_id',
    'idx_notifications_application_job',
  ],
  messages: [
    'idx_messages_application_created',
    'idx_messages_application_created_id',
    'idx_messages_sender_read',
  ],
  reports: [
    'idx_reports_status_created',
    'idx_reports_type_created',
    'idx_reports_user_created',
    'idx_reports_status_type_created',
  ],
  saved_jobs: [
    'uq_saved_jobs_user_job',
    'idx_saved_jobs_user_created',
  ],
  admin_notification_states: [
    'uq_admin_notification_state_key',
    'idx_admin_notification_deleted',
    'idx_admin_notification_lookup',
  ],
};

const requiredConstraints = [
  'fk_user_skills_user',
  'fk_user_experiences_user',
  'fk_company_documents_user',
  'fk_jobs_posted_by',
  'fk_job_requirements_job',
  'fk_applications_user',
  'fk_applications_job',
  'fk_notifications_user',
  'fk_notifications_job',
  'fk_notifications_application',
  'fk_notifications_application_job',
  'fk_messages_application',
  'fk_messages_job',
  'fk_messages_sender',
  'fk_messages_application_job',
  'fk_reports_user',
  'fk_reports_related_job',
  'fk_saved_jobs_user',
  'fk_saved_jobs_job',
  'fk_admin_notification_states_admin',
];

const requiredColumns = {
  users: [
    'id', 'name', 'email', 'password_hash', 'role', 'job_title', 'company',
    'company_website', 'company_industry', 'location', 'detailed_address',
    'phone', 'bio', 'cv_url', 'google_id', 'gmail_sender_email',
    'gmail_refresh_token_encrypted', 'gmail_connected_at', 'avatar',
    'otp_code', 'otp_expire', 'is_verified', 'reset_password_token',
    'reset_password_expire', 'last_login', 'account_status', 'created_at',
    'updated_at',
  ],
  user_skills: ['user_id', 'position', 'skill'],
  user_experiences: ['user_id', 'position', 'title', 'company', 'period'],
  company_documents: [
    'user_id', 'document_type', 'file_name', 'mime_type', 'data_url',
    'uploaded_at',
  ],
  jobs: [
    'id', 'title', 'company', 'logo_url', 'location', 'job_type', 'category',
    'description', 'salary', 'level', 'experience', 'qualifications',
    'specialty', 'degree', 'work_time', 'closing_date', 'status',
    'deletion_requested', 'posted_by', 'created_at', 'updated_at',
  ],
  job_requirements: ['job_id', 'position', 'requirement'],
  applications: [
    'id', 'user_id', 'job_id', 'status', 'name', 'email', 'phone', 'location',
    'experience', 'skills', 'cv_url', 'linkedin_url', 'portfolio_url',
    'github_url', 'expected_salary', 'availability', 'notes',
    'interview_date', 'interview_time', 'interview_format',
    'interview_location', 'interview_notes', 'decision_message',
    'decision_processing', 'decision_processing_at',
    'decision_notification_sent', 'decision_email_sent', 'applied_at',
    'created_at', 'updated_at',
  ],
  notifications: [
    'id', 'user_id', 'title', 'message', 'type', 'is_read', 'job_id',
    'application_id', 'interview_date', 'interview_time', 'interview_format',
    'interview_location', 'interview_notes', 'decision_message',
    'created_at', 'updated_at',
  ],
  messages: [
    'id', 'application_id', 'job_id', 'sender_id', 'sender_role', 'content',
    'is_read', 'created_at', 'updated_at',
  ],
  reports: [
    'id', 'user_id', 'type', 'subject', 'message', 'related_job_id', 'status',
    'admin_reply', 'created_at', 'updated_at',
  ],
  saved_jobs: ['id', 'user_id', 'job_id', 'created_at', 'updated_at'],
  admin_notification_states: [
    'id', 'admin_id', 'notification_key', 'is_read', 'is_deleted',
    'created_at', 'updated_at',
  ],
};

const requiredMediumTextColumns = [
  ['users', 'password_hash'],
  ['users', 'job_title'],
  ['users', 'company'],
  ['users', 'company_website'],
  ['users', 'company_industry'],
  ['users', 'location'],
  ['users', 'phone'],
  ['users', 'cv_url'],
  ['users', 'avatar'],
  ['jobs', 'location'],
  ['jobs', 'job_type'],
  ['jobs', 'category'],
  ['jobs', 'closing_date'],
  ['applications', 'email'],
  ['applications', 'linkedin_url'],
  ['applications', 'interview_date'],
  ['notifications', 'title'],
  ['notifications', 'interview_date'],
];

const integrityChecks = [
  {
    name: 'application job matches its message job',
    sql: `
      SELECT COUNT(*) AS count
      FROM messages m
      JOIN applications a ON a.id = m.application_id
      WHERE a.job_id <> m.job_id
    `,
  },
  {
    name: 'application job matches its notification job',
    sql: `
      SELECT COUNT(*) AS count
      FROM notifications n
      JOIN applications a ON a.id = n.application_id
      WHERE n.job_id IS NOT NULL AND a.job_id <> n.job_id
    `,
  },
  {
    name: 'duplicate applicant/job applications',
    sql: `
      SELECT COUNT(*) AS count FROM (
        SELECT user_id, job_id FROM applications
        GROUP BY user_id, job_id HAVING COUNT(*) > 1
      ) duplicates
    `,
  },
  {
    name: 'duplicate saved jobs',
    sql: `
      SELECT COUNT(*) AS count FROM (
        SELECT user_id, job_id FROM saved_jobs
        GROUP BY user_id, job_id HAVING COUNT(*) > 1
      ) duplicates
    `,
  },
];

const run = async () => {
  const pool = getMysqlPool();
  const failures = [];

  try {
    const [tableRows] = await pool.query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
    `);
    const actualTables = new Set(tableRows.map((row) => row.TABLE_NAME));
    for (const table of requiredTables) {
      if (!actualTables.has(table)) failures.push(`Missing table: ${table}`);
    }

    const [columnRows] = await pool.query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
    `);
    const columnMap = new Map(
      columnRows.map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]),
    );
    for (const [table, columns] of Object.entries(requiredColumns)) {
      for (const column of columns) {
        if (!columnMap.has(`${table}.${column}`)) {
          failures.push(`Missing column: ${table}.${column}`);
        }
      }
    }
    for (const [table, column] of requiredMediumTextColumns) {
      if (columnMap.get(`${table}.${column}`)?.DATA_TYPE !== 'mediumtext') {
        failures.push(`Expected MEDIUMTEXT: ${table}.${column}`);
      }
    }
    for (const [column, nullable] of [
      ['file_name', 'YES'],
      ['mime_type', 'YES'],
      ['data_url', 'YES'],
    ]) {
      if (columnMap.get(`company_documents.${column}`)?.IS_NULLABLE !== nullable) {
        failures.push(`Expected nullable company_documents.${column}`);
      }
    }

    const [indexRows] = await pool.query(`
      SELECT TABLE_NAME, INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      GROUP BY TABLE_NAME, INDEX_NAME
    `);
    const actualIndexes = new Set(indexRows.map(
      (row) => `${row.TABLE_NAME}.${row.INDEX_NAME}`,
    ));
    for (const [table, indexes] of Object.entries(requiredIndexes)) {
      for (const index of indexes) {
        if (!actualIndexes.has(`${table}.${index}`)) {
          failures.push(`Missing index: ${table}.${index}`);
        }
      }
    }

    const [constraintRows] = await pool.query(`
      SELECT CONSTRAINT_NAME
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
    `);
    const actualConstraints = new Set(
      constraintRows.map((row) => row.CONSTRAINT_NAME),
    );
    for (const constraint of requiredConstraints) {
      if (!actualConstraints.has(constraint)) {
        failures.push(`Missing foreign key: ${constraint}`);
      }
    }

    for (const check of integrityChecks) {
      const [rows] = await pool.query(check.sql);
      if (Number(rows[0].count) > 0) {
        failures.push(`Integrity check failed (${check.name}): ${rows[0].count}`);
      }
    }

    if (failures.length > 0) {
      failures.forEach((failure) => console.error(`FAIL ${failure}`));
      throw new Error(`${failures.length} MySQL schema validation check(s) failed`);
    }

    console.log(`MySQL schema validation passed for ${requiredTables.length} domain tables.`);
    console.log(`Verified ${requiredConstraints.length} foreign keys and required indexes.`);
    console.log(`Verified ${integrityChecks.length} relational and uniqueness checks.`);
  } finally {
    await pool.end();
  }
};

run().catch((error) => {
  console.error('MySQL schema validation failed:', error.message);
  process.exitCode = 1;
});
