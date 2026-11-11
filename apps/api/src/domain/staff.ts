/** Stylists and staff accounts of a salon. */
import { hashPassword, validatePassword } from '../auth/auth.js';
import { withTx, PG, pgCode, type Queryable } from '../db/pool.js';
import { AppError, Errors } from './errors.js';

export async function listStaff(q: Queryable, tenantId: string) {
  const { rows } = await q.query<{ id: string; display_name: string; color: string; active: boolean; public_name: string | null; show_public: boolean; email: string | null; username: string | null; role: string | null }>(
    `SELECT s.id, s.display_name, s.color, s.active, s.public_name, s.show_public, u.email, u.username, u.role
       FROM stylist s LEFT JOIN staff_user u ON u.stylist_id = s.id
      WHERE s.tenant_id = $1 AND s.deleted_at IS NULL ORDER BY s.sort_order, s.display_name`,
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
export async function publicTeam(q: Queryable, tenantId: string): Promise<{ id: string; publicName: string }[]> {
  const { rows } = await q.query<{ id: string; public_name: string }>(
    'SELECT id, public_name FROM stylist WHERE tenant_id = $1 AND active AND show_public AND deleted_at IS NULL ORDER BY sort_order, public_name',
    [tenantId],
  );
  return rows.map((r) => ({ id: r.id, publicName: r.public_name }));
}

/**
 * Owner: delete a staff profile (D-054). Refused for the owner's own profile and for the last owner.
 * Upcoming appointments become "Rücksprache" and wait for reassignment (needs_reassign).
 * Without any history the stylist and the login are deleted; otherwise the stylist row is kept
 * (display name only, inactive, hidden everywhere) and the login data are erased.
 */
export async function deleteStaff(
  db: Queryable & { connect?: unknown },
  ctx: { tenantId: string; now: Date },
  stylistId: string,
  actorUserId: string,
): Promise<{ removed: 'deleted' | 'anonymized'; toReassign: number }> {
  return withTx(db as never, async (tx) => {
    const s = await tx.query<{ id: string }>('SELECT id FROM stylist WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE', [ctx.tenantId, stylistId]);
    if (!s.rowCount) throw Errors.notFound();
    const u = await tx.query<{ id: string; role: string }>('SELECT id, role FROM staff_user WHERE tenant_id = $1 AND stylist_id = $2 AND deleted_at IS NULL', [ctx.tenantId, stylistId]);
    const user = u.rows[0];
    if (user?.id === actorUserId) throw new AppError('DELETE_SELF', 409, 'Das eigene Profil kann nicht gelöscht werden.');
    if (user?.role === 'owner') {
      const owners = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM staff_user WHERE tenant_id = $1 AND role = 'owner' AND deleted_at IS NULL", [ctx.tenantId]);
      if (owners.rows[0]!.n <= 1) throw new AppError('LAST_OWNER', 409, 'Der Salon braucht mindestens eine Inhaberin bzw. einen Inhaber.');
    }
    // Upcoming appointments are no longer confirmed: "Rücksprache", waiting for staff to give them
    // to a colleague or to decline them (requests inbox). Past ones stay in the history.
    const moved = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM appointment
        WHERE tenant_id = $1 AND stylist_id = $2 AND start_at >= $3 AND status IN ('requested','discuss','confirmed') FOR UPDATE`,
      [ctx.tenantId, stylistId, ctx.now],
    );
    if (moved.rowCount) {
      await tx.query(
        "UPDATE appointment SET status = 'discuss', expires_at = NULL, needs_reassign = true, version = version + 1, updated_at = $3 WHERE tenant_id = $1 AND id = ANY($2::uuid[])",
        [ctx.tenantId, moved.rows.map((a) => a.id), ctx.now],
      );
    }
    for (const a of moved.rows) {
      await tx.query('INSERT INTO appointment_event (tenant_id, appointment_id, actor, type, payload) VALUES ($1, $2, $3, $4, $5)', [
        ctx.tenantId, a.id, `staff:${actorUserId}`, 'stylist_deleted', JSON.stringify({ previousStatus: a.status }),
      ]);
    }
    // Complete removal when nothing refers to the person (savepoint: a foreign key means history).
    await tx.query('SAVEPOINT del_staff');
    try {
      if (user) {
        await tx.query('DELETE FROM session WHERE staff_user_id = $1', [user.id]);
        await tx.query('DELETE FROM staff_user WHERE id = $1', [user.id]);
      }
      await tx.query('DELETE FROM stylist WHERE tenant_id = $1 AND id = $2', [ctx.tenantId, stylistId]);
      await tx.query('RELEASE SAVEPOINT del_staff');
      return { removed: 'deleted' as const, toReassign: 0 };
    } catch (e) {
      if (pgCode(e) !== PG.FOREIGN_KEY_VIOLATION) throw e;
      await tx.query('ROLLBACK TO SAVEPOINT del_staff');
    }
    if (user) {
      await tx.query('DELETE FROM session WHERE staff_user_id = $1', [user.id]);
      await tx.query(
        "UPDATE staff_user SET deleted_at = $2, email = 'deleted-' || id || '@invalid', username = NULL, password_hash = '!' WHERE id = $1",
        [user.id, ctx.now],
      );
    }
    await tx.query('UPDATE stylist SET deleted_at = $3, active = false, show_public = false, public_name = NULL WHERE tenant_id = $1 AND id = $2', [ctx.tenantId, stylistId, ctx.now]);
    return { removed: 'anonymized' as const, toReassign: moved.rowCount ?? 0 };
  });
}

/** Colleagues with a login, for "Profil wechseln" (D-055): names and user names only, no e-mails. */
export async function teamLogins(q: Queryable, tenantId: string) {
  const { rows } = await q.query<{ id: string; display_name: string; username: string | null }>(
    `SELECT u.id, u.display_name, u.username FROM staff_user u JOIN stylist s ON s.id = u.stylist_id
      WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND s.active ORDER BY s.sort_order, u.display_name`,
    [tenantId],
  );
  return rows.map((r) => ({ id: r.id, displayName: r.display_name, username: r.username }));
}
