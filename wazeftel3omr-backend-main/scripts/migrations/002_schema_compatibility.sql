ALTER TABLE users
  DROP INDEX idx_users_phone_role;

ALTER TABLE users
  MODIFY COLUMN password_hash MEDIUMTEXT NOT NULL,
  MODIFY COLUMN email VARCHAR(320) NOT NULL,
  MODIFY COLUMN job_title MEDIUMTEXT NOT NULL,
  MODIFY COLUMN company MEDIUMTEXT NOT NULL,
  MODIFY COLUMN company_website MEDIUMTEXT NOT NULL,
  MODIFY COLUMN company_industry MEDIUMTEXT NOT NULL,
  MODIFY COLUMN location MEDIUMTEXT NOT NULL,
  MODIFY COLUMN phone MEDIUMTEXT NOT NULL,
  MODIFY COLUMN cv_url MEDIUMTEXT NOT NULL,
  MODIFY COLUMN google_id MEDIUMTEXT NULL,
  MODIFY COLUMN gmail_sender_email MEDIUMTEXT NULL,
  MODIFY COLUMN gmail_refresh_token_encrypted MEDIUMTEXT NULL,
  MODIFY COLUMN avatar MEDIUMTEXT NULL,
  MODIFY COLUMN otp_code MEDIUMTEXT NULL,
  MODIFY COLUMN reset_password_token MEDIUMTEXT NULL;

ALTER TABLE users
  ADD KEY idx_users_phone_role (phone(32), role),
  ADD KEY idx_users_role_name (role, name, created_at),
  ADD KEY idx_users_role_company (role, company(64)),
  ADD KEY idx_users_role_job_title (role, job_title(64));

ALTER TABLE company_documents
  MODIFY COLUMN file_name VARCHAR(160) NULL,
  MODIFY COLUMN mime_type ENUM('application/pdf', 'image/jpeg', 'image/png') NULL,
  MODIFY COLUMN data_url LONGTEXT NULL;

ALTER TABLE user_skills
  MODIFY COLUMN skill MEDIUMTEXT NOT NULL;

ALTER TABLE user_experiences
  MODIFY COLUMN title MEDIUMTEXT NOT NULL,
  MODIFY COLUMN company MEDIUMTEXT NOT NULL,
  MODIFY COLUMN period MEDIUMTEXT NOT NULL;

ALTER TABLE jobs
  DROP INDEX idx_jobs_category_status,
  DROP INDEX idx_jobs_location_status,
  DROP INDEX idx_jobs_status_closing_date;

ALTER TABLE jobs
  MODIFY COLUMN logo_url MEDIUMTEXT NOT NULL,
  MODIFY COLUMN location MEDIUMTEXT NOT NULL,
  MODIFY COLUMN job_type MEDIUMTEXT NOT NULL,
  MODIFY COLUMN category MEDIUMTEXT NOT NULL,
  MODIFY COLUMN salary MEDIUMTEXT NOT NULL,
  MODIFY COLUMN level MEDIUMTEXT NOT NULL,
  MODIFY COLUMN experience MEDIUMTEXT NOT NULL,
  MODIFY COLUMN qualifications MEDIUMTEXT NOT NULL,
  MODIFY COLUMN specialty MEDIUMTEXT NOT NULL,
  MODIFY COLUMN degree MEDIUMTEXT NOT NULL,
  MODIFY COLUMN work_time MEDIUMTEXT NOT NULL,
  MODIFY COLUMN closing_date MEDIUMTEXT NULL;

ALTER TABLE jobs
  ADD KEY idx_jobs_category_status (category(64), status),
  ADD KEY idx_jobs_location_status (location(64), status),
  ADD KEY idx_jobs_status_closing_date (status, closing_date(32)),
  ADD KEY idx_jobs_job_type (job_type(64)),
  ADD KEY idx_jobs_level (level(64)),
  ADD KEY idx_jobs_salary (salary(64)),
  ADD KEY idx_jobs_title (title),
  ADD KEY idx_jobs_company (company);

ALTER TABLE job_requirements
  MODIFY COLUMN requirement MEDIUMTEXT NOT NULL;

ALTER TABLE applications
  MODIFY COLUMN name MEDIUMTEXT NULL,
  MODIFY COLUMN email MEDIUMTEXT NULL,
  MODIFY COLUMN phone MEDIUMTEXT NULL,
  MODIFY COLUMN location MEDIUMTEXT NULL,
  MODIFY COLUMN experience MEDIUMTEXT NULL,
  MODIFY COLUMN skills MEDIUMTEXT NULL,
  MODIFY COLUMN cv_url MEDIUMTEXT NULL,
  MODIFY COLUMN linkedin_url MEDIUMTEXT NOT NULL,
  MODIFY COLUMN portfolio_url MEDIUMTEXT NOT NULL,
  MODIFY COLUMN github_url MEDIUMTEXT NOT NULL,
  MODIFY COLUMN expected_salary MEDIUMTEXT NOT NULL,
  MODIFY COLUMN availability MEDIUMTEXT NOT NULL,
  MODIFY COLUMN notes MEDIUMTEXT NOT NULL,
  MODIFY COLUMN interview_date MEDIUMTEXT NOT NULL,
  MODIFY COLUMN interview_time MEDIUMTEXT NOT NULL,
  MODIFY COLUMN interview_location MEDIUMTEXT NOT NULL,
  MODIFY COLUMN interview_notes MEDIUMTEXT NOT NULL,
  MODIFY COLUMN decision_message MEDIUMTEXT NOT NULL;

ALTER TABLE applications
  ADD UNIQUE KEY uq_applications_id_job (id, job_id),
  ADD KEY idx_applications_user_status_created (user_id, status, created_at, id);

ALTER TABLE notifications
  MODIFY COLUMN title MEDIUMTEXT NOT NULL,
  MODIFY COLUMN interview_date MEDIUMTEXT NOT NULL,
  MODIFY COLUMN interview_time MEDIUMTEXT NOT NULL,
  MODIFY COLUMN interview_location MEDIUMTEXT NOT NULL,
  MODIFY COLUMN interview_notes MEDIUMTEXT NOT NULL,
  MODIFY COLUMN decision_message MEDIUMTEXT NOT NULL;

ALTER TABLE notifications
  ADD KEY idx_notifications_user_created_id (user_id, created_at, id),
  ADD KEY idx_notifications_application_job (application_id, job_id),
  ADD CONSTRAINT fk_notifications_application_job
    FOREIGN KEY (application_id, job_id)
    REFERENCES applications (id, job_id)
    ON DELETE CASCADE;

ALTER TABLE messages
  ADD KEY idx_messages_application_created_id (application_id, created_at, id),
  ADD CONSTRAINT fk_messages_application_job
    FOREIGN KEY (application_id, job_id)
    REFERENCES applications (id, job_id)
    ON DELETE CASCADE;

ALTER TABLE reports
  ADD KEY idx_reports_status_type_created (status, type, created_at, id);

ALTER TABLE admin_notification_states
  ADD KEY idx_admin_notification_lookup (admin_id, is_deleted, notification_key);
