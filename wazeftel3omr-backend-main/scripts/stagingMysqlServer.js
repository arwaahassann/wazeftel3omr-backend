require('dotenv').config({ quiet: true });

if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to start the MySQL staging server in production');
}
if (process.env.MYSQL_STAGING_AUTH !== 'true') {
  throw new Error('Set MYSQL_STAGING_AUTH=true in the local backend environment to start MySQL staging');
}

const { createMysqlStagingApp } = require('../src/createMysqlStagingApp');
const { getMysqlPool } = require('../src/config/mysql');
const app = createMysqlStagingApp();
const port = Number(process.env.MYSQL_STAGING_PORT || 5001);
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Local MySQL staging API listening on http://127.0.0.1:${port}`);
});

const shutdown = async () => {
  server.close(async () => {
    await getMysqlPool().end();
    process.exit(0);
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
