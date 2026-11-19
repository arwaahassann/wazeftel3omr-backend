const mysql = require('mysql2/promise');

const poolKey = Symbol.for('wazeft-el3omr.mysql-pool');

const readMysqlConfig = () => {
  const connectionString = process.env.MYSQL_URL;
  if (!connectionString) {
    throw new Error('MYSQL_URL is not defined in environment variables');
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('MYSQL_URL must be a valid MySQL connection URL');
  }

  if (url.protocol !== 'mysql:' || !url.hostname || !url.username || !url.pathname.slice(1)) {
    throw new Error('MYSQL_URL must include mysql://, a host, username, and database name');
  }

  const poolLimit = Number(process.env.MYSQL_POOL_LIMIT || 5);
  if (!Number.isInteger(poolLimit) || poolLimit < 1 || poolLimit > 10) {
    throw new Error('MYSQL_POOL_LIMIT must be an integer between 1 and 10');
  }

  const isLoopbackHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
  const requiresTls = Boolean(process.env.VERCEL)
    || (process.env.NODE_ENV === 'production' && !isLoopbackHost);
  if (requiresTls && process.env.MYSQL_SSL !== 'true') {
    throw new Error('MYSQL_SSL=true is required for production and Vercel MySQL connections');
  }

  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    waitForConnections: true,
    connectionLimit: poolLimit,
    queueLimit: 0,
    connectTimeout: 15000,
    timezone: 'Z',
    ...(process.env.MYSQL_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
  };
};

const getMysqlPool = () => {
  if (!global[poolKey]) {
    global[poolKey] = mysql.createPool(readMysqlConfig());
  }
  return global[poolKey];
};

module.exports = { getMysqlPool };
