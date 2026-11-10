import { fromInstant } from '@salon/engine';
import { fixedClock, systemClock } from '../clock.js';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { loadEnv } from '../env.js';
import { seedDemo } from './seed.js';

const env = loadEnv();
if (env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
  throw new Error('Refusing to seed demo data in production (set ALLOW_DEMO_SEED=true to override).');
}
const db = createPool(env.DATABASE_URL, 4);
const clock = env.FAKE_NOW ? fixedClock(env.FAKE_NOW) : systemClock;
try {
  await migrate(db, console.log);
  const t0 = Date.now();
  await seedDemo(
    { db, clock, publicBaseUrl: env.PUBLIC_BASE_URL, whatsappEnabled: false, secret: env.APP_SECRET },
    { today: fromInstant(clock.now(), 'Europe/Berlin').date, password: process.env.SEED_PASSWORD, log: console.log },
  );
  console.log(`seed finished in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log('Logins (e-mail or user name; password: SEED_PASSWORD or "demo-passwort-2026"): maria / maria@salon-beispiel.example.com (Inhaberin), sophie, deniz at /salon-beispiel/team; admin / admin@plattform.example.com at /admin');
} finally {
  await db.end();
}
