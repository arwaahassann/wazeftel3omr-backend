require('dotenv').config({ quiet: true });

if (process.env.VERCEL) {
  throw new Error('The local MySQL server cannot run on Vercel');
}

const mysqlUrl = process.env.MYSQL_URL;
if (!mysqlUrl) {
  throw new Error('MYSQL_URL is not configured for the local MySQL server');
}

let target;
try {
  target = new URL(mysqlUrl);
} catch {
  throw new Error('MYSQL_URL must be a valid MySQL connection URL');
}

const targetDatabase = decodeURIComponent(target.pathname.slice(1));
if (
  target.protocol !== 'mysql:'
  || !['localhost', '127.0.0.1', '::1'].includes(target.hostname.toLowerCase())
  || !/staging/i.test(targetDatabase)
) {
  throw new Error('Refusing local cutover: MYSQL_URL must target a loopback MySQL staging database');
}

process.env.NODE_ENV = 'development';

const { createMysqlStagingApp } = require('../src/createMysqlStagingApp');
const { getMysqlPool } = require('../src/config/mysql');
const requiredTables = [
  'users',
  'jobs',
  'job_requirements',
  'applications',
  'saved_jobs',
  'notifications',
  'messages',
  'reports',
  'admin_notification_states',
];
let pool;

const start = async () => {
  pool = getMysqlPool();
  const [[databaseRow]] = await pool.query('SELECT DATABASE() AS selectedDatabase');
  if (databaseRow?.selectedDatabase !== targetDatabase) {
    throw new Error('Connected MySQL database does not match the verified staging target');
  }

  const [tableRows] = await pool.execute(
    `SELECT TABLE_NAME
     FROM information_schema.tables
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME IN (${requiredTables.map(() => '?').join(', ')})`,
    requiredTables,
  );
  const existingTables = new Set(tableRows.map((row) => row.TABLE_NAME));
  const missingTables = requiredTables.filter((table) => !existingTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(`MySQL staging schema is incomplete (${missingTables.length} required tables missing)`);
  }

  const app = createMysqlStagingApp({ pool });
  const port = Number(process.env.PORT || 5000);
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Local backend is using MySQL on http://127.0.0.1:${port}`);
  });
  server.once('error', async (error) => {
    console.error('Local MySQL HTTP server failed:', error.code || error.name);
    try {
      await pool.end();
    } catch (closeError) {
      console.error('Failed to close the MySQL pool:', closeError.code || closeError.name);
    }
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async (error) => {
      if (error) {
        console.error('Failed to close the local MySQL HTTP server:', error.code || error.name);
        process.exitCode = 1;
      }
      try {
        await pool.end();
      } catch (closeError) {
        console.error('Failed to close the MySQL pool:', closeError.code || closeError.name);
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

start().catch(async (error) => {
  console.error('Local MySQL startup failed:', error.code || error.name || 'configuration error');
  if (pool) {
    try {
      await pool.end();
    } catch (closeError) {
      console.error('Failed to close the MySQL pool:', closeError.code || closeError.name);
    }
  }
  process.exitCode = 1;
});
