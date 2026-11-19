require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { getMysqlPool } = require('../src/config/mysql');

const migrationsDirectory = path.join(__dirname, 'migrations');
const migrationFiles = fs.readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const readStatements = (file) => fs.readFileSync(
  path.join(migrationsDirectory, file),
  'utf8',
)
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

const run = async () => {
  if (process.argv.includes('--dry-run')) {
    migrationFiles.forEach((file) => {
      console.log(`${file}: ${readStatements(file).length} SQL statements`);
    });
    return;
  }

  if (migrationFiles.length === 0) {
    throw new Error('No MySQL migration files were found');
  }

  const pool = getMysqlPool();
  let connection;
  let lockAcquired = false;

  try {
    connection = await pool.getConnection();
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (version)
      ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [lockRows] = await connection.query(
      "SELECT GET_LOCK('wazeft_el3omr_schema_migrations', 30) AS acquired",
    );
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error('Could not acquire the MySQL migration lock within 30 seconds');
    }

    for (const file of migrationFiles) {
      const [appliedRows] = await connection.execute(
        'SELECT version FROM schema_migrations WHERE version = ?',
        [file],
      );
      if (appliedRows.length > 0) {
        console.log(`Skipping already-applied migration: ${file}`);
        continue;
      }

      for (const statement of readStatements(file)) {
        await connection.query(statement);
      }

      await connection.execute(
        'INSERT INTO schema_migrations (version) VALUES (?)',
        [file],
      );
      console.log(`Applied migration: ${file}`);
    }
  } finally {
    try {
      if (connection && lockAcquired) {
        await connection.query("SELECT RELEASE_LOCK('wazeft_el3omr_schema_migrations')");
      }
    } finally {
      if (connection) connection.release();
      await pool.end();
    }
  }
};

run().catch((error) => {
  console.error('MySQL migration failed:', error.message);
  process.exitCode = 1;
});
