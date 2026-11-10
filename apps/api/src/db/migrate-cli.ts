import { loadEnv } from '../env.js';
import { migrate } from './migrate.js';
import { createPool } from './pool.js';

const env = loadEnv();
const db = createPool(env.DATABASE_URL, 1);
try {
  const applied = await migrate(db, console.log);
  console.log(applied.length ? `${applied.length} migration(s) applied` : 'database up to date');
} finally {
  await db.end();
}
