/** Stylists and staff accounts of a salon. */
import { hashPassword, validatePassword } from '../auth/auth.js';
import { withTx, PG, pgCode, type Queryable } from '../db/pool.js';
import { AppError, Errors } from './errors.js';

export async function listStaff(q: Queryable, tenantId: string) {
  const { rows } = await q.query<{ id: string; display_name: string; color: string; active: boolean; public_name: string | null; show_public: boolean; email: string | null; username: string | null; role: string | null }>(
    `SELECT s.id, s.display_name, s.color, s.active, s.public_name, s.show_public, u.email, u.username, u.role
       FROM stylist s LEFT JOIN staff_user u ON u.stylist_id = s.id
      WHERE s.tenant_id = $1 ORDER BY s.sort_order, s.display_name`,
    [tenantId],
  );
  return rows.map((r) => ({ id: r.id, displayName: r.display_name, color: r.color, active: r.active, publicName: r.public_name, showPublic: r.show_public, email: r.email, username: r.username, role: r.role }));
}

const COLORS = ['#34d399', '#a78bfa', '#f472b6', '#fbbf24', '#38bdf8', '#fb923c', '#94a3b8'];

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;

/** User name rules (D-049): 3–30 characters, a–z, 0–9, dot, dash, underscore; no "@" (that means e-mail). */
export function normalizeUsername(input: string | null | undefined): string | null {
  const u = input?.trim().toLowerCase();
  if (!u) return null;
  if (!USERNAME.test(u)) {
    throw new AppError('USERNAME_INVALID', 422, 'Benutzername: 3–30 Zeichen, nur Buchstaben a–z, Ziffern, Punkt, Bindestrich oder Unterstrich.');
  }
  return u;
}

const usernameTaken = () => new AppError('USERNAME_TAKEN', 409, 'Dieser Benutzername ist in diesem Salon bereits vergeben.');
const isUsernameConflict = (e: unknown) => pgCode(e) === PG.UNIQUE_VIOLATION && /username/.test((e as { constraint?: string }).constraint ?? '');

/**
 * Create a stylist with an optional login (role stylist or owner).
 * A login always needs an e-mail and a password; the user name is an optional second way to log in.
 */
export async function createStaff(
  db: Queryable & { connect?: unknown },
  tenantId: string,
  input: { displayName: string; email?: string | undefined; username?: string | undefined; password?: string | undefined; role?: 'owner' | 'stylist' },
) {
  if (input.email && !input.password) throw Errors.validation({ password: 'Passwort erforderlich.' });
  if (!input.email && (input.password || input.username)) {
    throw new AppError('EMAIL_REQUIRED', 422, 'Für einen Zugang zur App ist eine E-Mail-Adresse nötig.');
  }
  const username = normalizeUsername(input.username);
  if (input.password) validatePassword(input.password);
  const hash = input.password ? await hashPassword(input.password) : null;
  return withTx(db as never, async (tx) => {
    const n = await tx.query<{ n: number }>('SELECT count(*) AS n FROM stylist WHERE tenant_id = $1', [tenantId]);
    const s = await tx.query<{ id: string }>(
      'INSERT INTO stylist (tenant_id, display_name, color, sort_order) VALUES ($1, $2, $3, $4) RETURNING id',
      [tenantId, input.displayName.trim(), COLORS[n.rows[0]!.n % COLORS.length], n.rows[0]!.n],
    );
    if (input.email) {
      try {
        await tx.query(
          'INSERT INTO staff_user (tenant_id, stylist_id, email, username, password_hash, role, display_name) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [tenantId, s.rows[0]!.id, input.email.trim().toLowerCase(), username, hash, input.role ?? 'stylist', input.displayName.trim()],
        );
      } catch (e) {
        if (isUsernameConflict(e)) throw usernameTaken();
        if (pgCode(e) === PG.UNIQUE_VIOLATION) throw new AppError('EMAIL_TAKEN', 409, 'Diese E-Mail-Adresse wird bereits verwendet.');
        throw e;
      }
    }
    return { id: s.rows[0]!.id };
  });
}

export async function setStylistActive(q: Queryable, tenantId: string, id: string, active: boolean) {
  const r = await q.query('UPDATE stylist SET active = $3 WHERE tenant_id = $1 AND id = $2', [tenantId, id, active]);
  if (!r.rowCount) throw Errors.notFound();
}

/** Owner: set or remove (null) the user name of a stylist's login. */
export async function setUsername(q: Queryable, tenantId: string, stylistId: string, input: string | null): Promise<{ username: string | null }> {
  const username = normalizeUsername(input);
  try {
    const r = await q.query('UPDATE staff_user SET username = $3 WHERE tenant_id = $1 AND stylist_id = $2', [tenantId, stylistId, username]);
    if (!r.rowCount) throw new AppError('NO_LOGIN', 404, 'Diese Person hat keinen Zugang zur App.');
  } catch (e) {
    if (isUsernameConflict(e)) throw usernameTaken();
    throw e;
  }
  return { username };
}

/**
 * Owner: show a stylist on the public homepage (D-052) – only with the person's consent and only
 * under the public name they chose (first name or nickname), never the full name.
 */
export async function setStylistPublic(q: Queryable, tenantId: string, id: string, input: { show: boolean; publicName: string | null }) {
  const publicName = input.publicName?.trim() || null;
  if (input.show && !publicName) throw new AppError('PUBLIC_NAME_REQUIRED', 422, 'Bitte einen Namen für die Startseite eingeben (z. B. nur den Vornamen).');
  if (publicName && publicName.length > 40) throw new AppError('PUBLIC_NAME_TOO_LONG', 422, 'Höchstens 40 Zeichen.');
  const r = await q.query('UPDATE stylist SET show_public = $3, public_name = $4 WHERE tenant_id = $1 AND id = $2', [tenantId, id, input.show, publicName]);
  if (!r.rowCount) throw Errors.notFound();
  return { show: input.show, publicName };
}

/** Public homepage: only active stylists who agreed, only their public name. */
export async function publicTeam(q: Queryable, tenantId: string): Promise<{ publicName: string }[]> {
  const { rows } = await q.query<{ public_name: string }>(
    'SELECT public_name FROM stylist WHERE tenant_id = $1 AND active AND show_public ORDER BY sort_order, public_name',
    [tenantId],
  );
  return rows.map((r) => ({ publicName: r.public_name }));
}
