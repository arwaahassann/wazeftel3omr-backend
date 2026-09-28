# Backend setup

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
