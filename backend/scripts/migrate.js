/**
 * Migration runner.
 * Applies every unapplied backend/migrations/*.sql file against DATABASE_URL,
 * in filename order, each inside its own transaction.
 * Tracks applied migrations in the schema_migrations table.
 *
 * Usage: npm run db:migrate  (reads DATABASE_URL from backend/.env)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Add it to backend/.env');
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }, // required for Neon / managed Postgres
  });

  await client.connect();
  console.log('Connected to database.');

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name)
  );

  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`apply ${file} ...`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`done  ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }

  await client.end();
  console.log('All migrations applied.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
