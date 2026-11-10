// Starts a production-like server for e2e: fresh DB, deterministic seed at a frozen "now",
// built web app served by the API (same CSP as production).
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5432/salon_e2e';
const PORT = process.env.E2E_PORT ?? '4310';
export const FAKE_NOW = process.env.E2E_NOW ?? '2026-11-02T06:00:00.000Z'; // Monday 07:00 in Berlin

const admin = new pg.Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
await admin.connect();
const name = new URL(DB).pathname.slice(1);
await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${name}`);
await admin.end();

const env = { ...process.env, DATABASE_URL: DB, FAKE_NOW, NODE_ENV: 'test', PUBLIC_BASE_URL: `http://localhost:${PORT}`, PORT, WORKERS: 'false', DEV_ROUTES: 'true', RATE_LIMIT_SCALE: '50' };
if (!process.env.E2E_SKIP_BUILD) {
  const b = spawnSync('pnpm', ['--filter', '@salon/web', 'build'], { cwd: root, stdio: 'inherit', env: process.env });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
const seed = spawnSync('pnpm', ['--filter', '@salon/api', 'exec', 'tsx', 'src/seed/seed-cli.ts'], { cwd: root, stdio: 'inherit', env: { ...env, SEED_PASSWORD: 'demo-passwort-2026' } });
if (seed.status !== 0) process.exit(seed.status ?? 1);
const server = spawn('pnpm', ['--filter', '@salon/api', 'exec', 'tsx', 'src/server.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...env, STATIC_DIR: join(root, 'apps/web/dist') },
});
process.on('SIGTERM', () => server.kill('SIGTERM'));
process.on('SIGINT', () => server.kill('SIGINT'));
server.on('exit', (c) => process.exit(c ?? 0));
