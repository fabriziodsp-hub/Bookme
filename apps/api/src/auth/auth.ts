import { hash, verify } from '@node-rs/argon2';
import type { Db, Queryable } from '../db/pool.js';
import { Errors } from '../domain/errors.js';
import { newToken, sha256 } from '../domain/util.js';
import type { Clock } from '../clock.js';

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 12 * 3_600_000; // one working day, sliding

export interface StaffUser {
  id: string;
  email: string;
  role: 'platform_admin' | 'owner' | 'stylist';
  displayName: string;
  stylistId: string | null;
  tenantId: string | null;
}

interface UserRow {
  id: string;
  email: string;
  role: StaffUser['role'];
  display_name: string;
  stylist_id: string | null;
  tenant_id: string | null;
}
const toUser = (u: UserRow): StaffUser => ({
  id: u.id,
  email: u.email,
  role: u.role,
  displayName: u.display_name,
  stylistId: u.stylist_id,
  tenantId: u.tenant_id,
});

// OWASP 2024+ recommendation for Argon2id: m=19 MiB, t=2, p=1.
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, ARGON);

// Pre-computed hash so unknown e-mails take as long as wrong passwords (no user enumeration by timing).
let dummyHash: Promise<string> | undefined;

// Per-account throttling against password guessing from many IPs (in-memory; single instance).
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
/** Test helper. */
export const resetLoginThrottle = () => failures.clear();

/**
 * Staff login with e-mail or user name in the same field (D-049).
 * An "@" means e-mail (unique on the platform). Otherwise it is a user name, unique within the
 * salon whose login page was used (`slug`); without a salon (/admin) only platform admins match.
 */
export async function login(db: Db, clock: Clock, identifier: string, password: string, slug?: string): Promise<{ token: string; user: StaffUser }> {
  const name = identifier.trim().toLowerCase();
  const byEmail = name.includes('@');
  const key = byEmail ? name : `${slug ?? ''}|${name}`;
  const f = failures.get(key);
  if (f && f.count >= MAX_FAILURES && f.until > Date.now()) throw Errors.rateLimited();
  const { rows } = byEmail
    ? await db.query<UserRow & { password_hash: string }>(
        `SELECT u.* FROM staff_user u LEFT JOIN tenant t ON t.id = u.tenant_id
          WHERE u.email = $1 AND (u.tenant_id IS NULL OR t.active)`,
        [name],
      )
    : slug
      ? await db.query<UserRow & { password_hash: string }>(
          `SELECT u.* FROM staff_user u JOIN tenant t ON t.id = u.tenant_id
            WHERE u.username = $1 AND t.slug = $2 AND t.active`,
          [name, slug],
        )
      : await db.query<UserRow & { password_hash: string }>('SELECT u.* FROM staff_user u WHERE u.username = $1 AND u.tenant_id IS NULL', [name]);
  const u = rows[0];
  dummyHash ??= hashPassword('not-a-real-password-placeholder');
  const ok = await verify(u?.password_hash ?? (await dummyHash), password).catch(() => false);
  if (!u || !ok) {
    const cur = failures.get(key);
    const count = cur && cur.until > Date.now() ? cur.count + 1 : 1;
    failures.set(key, { count, until: Date.now() + LOCK_MS });
    throw Errors.badCredentials();
  }
  failures.delete(key);
  const token = newToken();
  await db.query('INSERT INTO session (id_hash, staff_user_id, expires_at) VALUES ($1, $2, $3)', [
    sha256(token),
    u.id,
    new Date(clock.now().getTime() + SESSION_TTL_MS),
  ]);
  return { token, user: toUser(u) };
}

export async function userForSession(db: Queryable, clock: Clock, token: string | undefined): Promise<StaffUser | null> {
  if (!token || token.length > 100) return null;
  const now = clock.now();
  const { rows } = await db.query<UserRow>(
    `UPDATE session s SET expires_at = $3
       FROM staff_user u
      WHERE s.id_hash = $1 AND s.expires_at > $2 AND u.id = s.staff_user_id
      RETURNING u.id, u.email, u.role, u.display_name, u.stylist_id, u.tenant_id`,
    [sha256(token), now, new Date(now.getTime() + SESSION_TTL_MS)],
  );
  const u = rows[0];
  return u ? toUser(u) : null;
}

export async function logout(db: Queryable, token: string | undefined): Promise<void> {
  if (token) await db.query('DELETE FROM session WHERE id_hash = $1', [sha256(token)]);
}

export function validatePassword(pw: string): void {
  if (pw.length < 12) throw Errors.validation({ password: 'Mindestens 12 Zeichen.' });
}
