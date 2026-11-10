import pg from 'pg';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/salon_test';

/** Fresh schema once per test run. */
export default async function setup() {
  const admin = new pg.Client({ connectionString: TEST_DB.replace(/\/[^/]+$/, '/postgres') });
  await admin.connect();
  const name = new URL(TEST_DB).pathname.slice(1);
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const db = createPool(TEST_DB, 1);
  await migrate(db);
  await db.end();
}
