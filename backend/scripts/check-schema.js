/**
 * Quick schema verification.
 * Usage: npm run db:check
 */
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  console.log(`Tables (${tables.rows.length}):`);
  tables.rows.forEach((r) => console.log(' -', r.tablename));

  const roles = await client.query('SELECT count(*)::int AS n FROM roles');
  console.log('Roles seeded:', roles.rows[0].n);

  const orgs = await client.query('SELECT count(*)::int AS n FROM organizations');
  console.log('Organizations seeded:', orgs.rows[0].n);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
