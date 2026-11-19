# Backend setup

## Local MySQL backend

The local development command now runs the backend against the dedicated local MySQL staging database:

```powershell
npm run dev
```

The local server binds only to `127.0.0.1`, requires `MYSQL_URL` to point to a loopback MySQL host and a database whose name contains `staging`, checks the database identity and required tables before listening, and never runs schema migrations automatically. Run `npm run validate:mysql` before use.

To run without the file watcher, use `npm run start:mysql-local`. To roll the local backend back to the original MongoDB runtime, use `npm run dev:mongo`; `npm start` and `server.js` also retain the original MongoDB startup path. The Vercel entry point and production database configuration are unchanged.

## MySQL foundation

The MySQL runtime uses the existing repositories and schema. No existing data is copied or removed by the local startup command.

Configure `MYSQL_URL` as a server-side environment variable for a dedicated staging database. On Vercel, also set `MYSQL_SSL=true`; `MYSQL_POOL_LIMIT` is optional and defaults to `5` (allowed range: `1` to `10`).

Review the target database carefully before applying the initial schema:

```powershell
npm run migrate:mysql -- --dry-run
npm run migrate:mysql
npm run validate:mysql
```

The migration command is manual and must only be run against the separate staging database. Do not run it against production. The schema preserves Mongo ObjectId-shaped identifiers and defines relational foreign keys; applying it does not migrate data or change the regular backend. The validator reads schema metadata and checks relationship consistency and duplicate application/saved-job pairs; it does not modify data.

The regular controllers and routes continue to use MongoDB. MySQL authentication, profile, jobs, search, closing, and saved-job handlers are exposed only by the local staging API. `npm test` runs contract/repository tests; staging integration tests are opt-in and write only temporary records to local MySQL.

### MySQL authentication

The original MongoDB runtime remains available through `server.js` and `npm run dev:mongo`. The MySQL runtime is local-only and refuses Vercel/production startup.

The integration test writes temporary users only to the configured MySQL staging database, injects a test-only OTP sender, and deletes its users when complete. It validates OTP generation, delivery invocation, expiration, resend, verification, password reset, and profiles without sending real email. The staging mailer defaults to SMTP port 465 (or honors `EMAIL_PORT` and `EMAIL_SECURE`); the regular Mongo-backed mailer is unchanged.

```powershell
$env:MYSQL_STAGING_AUTH_TESTS = 'true'
npm test
```

Do not run this test against production. The test expects local `MYSQL_URL`, `MONGO_URI`, and `JWT_SECRET` to be configured; it does not connect to or read/write MongoDB.

### Isolated MySQL jobs staging

The staging API also exposes the existing `/api/jobs` routes and `/api/users/saved` routes against MySQL, including approval/review, employer deletion requests, deadline closing in the `Africa/Cairo` timezone, search filters, sorting, and pagination. The regular MongoDB controllers are not modified or mounted by the staging app.

To run the jobs integration tests, first verify `MYSQL_URL` points to a local database with `staging` in its name. The test creates temporary users and jobs, checks CRUD, authorization, search/filter/sort/page, expiry and saved-job behavior, and cleans up its records:

```powershell
$env:MYSQL_STAGING_JOBS_TESTS = 'true'
npm test -- --test-name-pattern="MySQL staging jobs"
```

The job integration test uses actual MySQL rows and does not send email to a real recipient. Do not run it against production.

### Isolated MySQL application staging

The staging API also exposes the existing `/api/applications` and application-related `/api/admin` endpoints through MySQL. Application submission, unique user/job pairs, employer review, status decisions, interview details, notifications, and seeker/employer/admin statistics use the relational staging tables. The ordinary MongoDB application and admin routes remain unchanged.

Run the application lifecycle integration against the local staging database with temporary users, jobs, applications, and notifications:

```powershell
$env:MYSQL_STAGING_APPLICATIONS_TESTS = 'true'
npm test -- --test-name-pattern="MySQL staging application lifecycle"
```

Email delivery is injected during this test to exercise successful and failed delivery/retry handling without sending mail outside the explicitly configured test. The test verifies application email recipients, subjects, and interview details. The integration test cleans up all created database records and must not run against production.

### Isolated MySQL communication staging

The local staging API also exposes notifications, application conversations/messages, user reports, admin report status updates, and admin notification states through MySQL. The existing MongoDB routes and production behavior remain unchanged. Message and report notification writes use the related staging records and preserve role/ownership checks.

Run the notification, messaging, report, and admin workflow integration tests against the local staging database:

```powershell
$env:MYSQL_STAGING_COMMUNICATION_TESTS = 'true'
npm test -- --test-name-pattern="MySQL staging notifications"
```

The integration test uses actual temporary MySQL records, injects a test-only email sender (no mail is sent), and removes its users, jobs, applications, reports, notifications, and admin notification states. Do not run it against production.

### Isolated MySQL Phase 7 dashboard and search verification

The staging API provides the admin account-search endpoint using real MySQL user records. It mounts the existing seeker/employer route aliases used by the frontend alongside their base API paths. Dashboard verification covers admin platform/application statistics, job-seeker application/profile data, employer-owned jobs and applications, role authorization, job filters, ordering, and pagination.

```powershell
$env:MYSQL_STAGING_PHASE7_TESTS = 'true'
npm test -- --test-name-pattern="MySQL staging Phase 7"
```

The test uses temporary local MySQL rows and cleans them up. The MySQL runtime mounts admin company, seeker, and job management routes, plus the AI and employer Gmail routes. Their local route and behavior tests do not constitute verification against live Google or AI providers. Account search uses literal substring matching and is capped at eight results, consistent with the Mongo-backed route; substring matching may need performance review for a large dataset.

## Automatic job closing

Jobs with a closing date remain open through that date in the `Africa/Cairo` timezone, then move to **closed**. The API also closes expired jobs while listing jobs or processing applications, so they are not visible to applicants or accepted after their deadline.

Vercel runs the expiry endpoint daily. Set a server-side `CRON_SECRET` environment variable in the Vercel project; Vercel sends it as a Bearer token to authenticate the scheduled request. The employer's jobs list will then show expired jobs in the **closed** tab.

## Production admin performance

The admin jobs list uses keyset pagination, so moving forward through large datasets does not use increasingly expensive `skip` queries or wait for a full collection count. Job descriptions and employer contact details are loaded only when an admin opens a job's details.

The admin jobs free-text filter still uses a case-insensitive substring search; on very large collections, that search can scan many records. Cursor pagination speeds up browsing but does not make substring search index-backed.

Create the supporting MongoDB indexes once per database before deploying the updated backend:

```powershell
npm run ensure:admin-indexes
```

The command uses `MONGO_URI` from the backend environment, creates indexes idempotently, and must be run with a database user permitted to create indexes. Index creation on a production-sized collection can consume database resources; schedule it during a low-traffic period and monitor the database while it runs.

## Company Gmail

Interview invitations and application status decisions are sent from the employer's Gmail account connected in **Settings → Company email**. Enable the Gmail API in the Google Cloud project used by a Google OAuth web client and add the exact backend callback URL to its authorized redirect URIs:

```text
http://localhost:5000/api/employer/gmail/oauth/callback
```

For production, use the deployed backend's callback URL. The OAuth consent screen must include `gmail.send`, `email`, and `openid`. While the consent screen is in testing mode, add each company account that will connect as a test user. Verification may be required for general availability; refresh tokens for unverified testing apps may expire.

Configure these server-side environment variables. Do not put secrets in frontend environment files or commit them:

```text
GOOGLE_CLIENT_ID=<Google OAuth web client ID>
GOOGLE_CLIENT_SECRET=<Google OAuth web client secret>
GOOGLE_GMAIL_REDIRECT_URI=<exact authorized callback URL>
GMAIL_TOKEN_ENCRYPTION_KEY=<base64-encoded 32-byte random key>
```

Generate an encryption key with Node.js:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep the encryption key stable and backed up. Changing or losing it makes connected Gmail accounts require reconnection. Refresh tokens are encrypted on the server and are never sent to the browser. `CLIENT_URL` must be the frontend origin; local development also accepts `http://localhost:5173` and `http://localhost:3000`.
