const crypto = require('crypto');

const mongoIdPattern = /^[a-f\d]{24}$/i;
const sensitiveFields = new Set([
  'password',
  'passwordHash',
  'gmailRefreshTokenEncrypted',
  'otpCode',
  'resetPasswordToken',
]);

const isMongoId = (value) => typeof value === 'string' && mongoIdPattern.test(value);

const normalizeMongoId = (value) => {
  const id = typeof value === 'string' ? value : value?.toHexString?.();
  if (!isMongoId(id)) {
    throw new TypeError('Expected a 24-character hexadecimal Mongo-compatible ID');
  }
  return id.toLowerCase();
};

const createMongoId = () => crypto.randomBytes(12).toString('hex');

const toCamelCase = (value) => value.replace(/_([a-z\d])/g, (_, character) => character.toUpperCase());

const assignPath = (target, path, value) => {
  const [segment, ...remaining] = path;
  const key = segment === 'id' ? '_id' : toCamelCase(segment);

  if (remaining.length === 0) {
    target[key] = value;
    return;
  }

  if (!target[key] || typeof target[key] !== 'object') {
    target[key] = {};
  }
  assignPath(target[key], remaining, value);
};

const removeEmptyPopulatedRelations = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') {
      removeEmptyPopulatedRelations(child);
      if (Object.hasOwn(child, '_id') && child._id === null) {
        value[key] = null;
      }
    }
  }
  return value;
};

const mapMysqlRow = (row, { omit = sensitiveFields } = {}) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new TypeError('Expected a MySQL result row object');
  }

  const mapped = {};
  for (const [column, value] of Object.entries(row)) {
    const path = column.split('__');
    const finalField = toCamelCase(path[path.length - 1]);
    if (omit.has(finalField)) continue;
    assignPath(mapped, path, value);
  }
  return removeEmptyPopulatedRelations(mapped);
};

class MysqlRepository {
  constructor(pool) {
    if (!pool || typeof pool.execute !== 'function' || typeof pool.getConnection !== 'function') {
      throw new TypeError('MysqlRepository requires a mysql2 promise pool');
    }
    this.pool = pool;
  }

  async query(sql, parameters = []) {
    const [rows] = await this.pool.execute(sql, parameters);
    return rows;
  }

  async execute(sql, parameters = []) {
    const [result] = await this.pool.execute(sql, parameters);
    return result;
  }

  async transaction(work) {
    if (typeof work !== 'function') {
      throw new TypeError('MysqlRepository.transaction requires a callback');
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
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
  }
}

module.exports = {
  MysqlRepository,
  createMongoId,
  isMongoId,
  mapMysqlRow,
  normalizeMongoId,
};
