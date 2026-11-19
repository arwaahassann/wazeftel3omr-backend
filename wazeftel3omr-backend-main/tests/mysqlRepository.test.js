const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MysqlRepository,
  createMongoId,
  isMongoId,
  mapMysqlRow,
  normalizeMongoId,
} = require('../src/db/mysqlRepository');

test('Mongo-compatible IDs are generated, validated, and normalized', () => {
  const id = createMongoId();
  assert.match(id, /^[a-f\d]{24}$/);
  assert.equal(isMongoId(id.toUpperCase()), true);
  assert.equal(normalizeMongoId(id.toUpperCase()), id);
  assert.equal(isMongoId('not-an-id'), false);
  assert.throws(() => normalizeMongoId('not-an-id'), TypeError);
});

test('MySQL rows map to Mongo-style IDs, populated relations, and nested fields', () => {
  const mapped = mapMysqlRow({
    id: '64a000000000000000000001',
    posted_by: '64a000000000000000000002',
    job__id: '64a000000000000000000003',
    job__posted_by__id: '64a000000000000000000002',
    interviewDetails__date: '2026-11-11',
    is_read: 0,
    password_hash: 'must-not-be-returned',
    otp_code: 'must-not-be-returned',
  });

  assert.deepEqual(mapped, {
    _id: '64a000000000000000000001',
    postedBy: '64a000000000000000000002',
    job: {
      _id: '64a000000000000000000003',
      postedBy: { _id: '64a000000000000000000002' },
    },
    interviewDetails: { date: '2026-11-11' },
    isRead: 0,
  });
});

test('unpopulated nullable relations map to null', () => {
  assert.deepEqual(
    mapMysqlRow({ id: '64a000000000000000000001', job__id: null, job__title: null }),
    { _id: '64a000000000000000000001', job: null },
  );
});

test('repository query and execute use parameterized pool calls', async () => {
  const calls = [];
  const repository = new MysqlRepository({
    execute: async (...args) => {
      calls.push(args);
      return args[0].startsWith('SELECT')
        ? [[{ value: 1 }], []]
        : [{ affectedRows: 1 }, []];
    },
    getConnection: async () => ({}),
  });

  assert.deepEqual(await repository.query('SELECT ? AS value', [1]), [{ value: 1 }]);
  assert.deepEqual(await repository.execute('UPDATE users SET name = ?', ['A']), { affectedRows: 1 });
  assert.deepEqual(calls, [
    ['SELECT ? AS value', [1]],
    ['UPDATE users SET name = ?', ['A']],
  ]);
});

test('repository transactions commit on success and roll back on failure', async () => {
  const calls = [];
  const pool = {
    execute: async () => [[], []],
    getConnection: async () => ({
      beginTransaction: async () => calls.push('begin'),
      commit: async () => calls.push('commit'),
      rollback: async () => calls.push('rollback'),
      release: () => calls.push('release'),
    }),
  };
  const repository = new MysqlRepository(pool);

  assert.equal(await repository.transaction(async () => 'committed'), 'committed');
  assert.deepEqual(calls, ['begin', 'commit', 'release']);

  calls.length = 0;
  await assert.rejects(repository.transaction(async () => {
    throw new Error('test failure');
  }), /test failure/);
  assert.deepEqual(calls, ['begin', 'rollback', 'release']);
});
