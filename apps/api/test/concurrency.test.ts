/**
 * Double booking must be impossible even under concurrency (DoD).
 * Requests run truly in parallel against PostgreSQL (pool of 30 connections).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PG, pgCode } from '../src/db/pool.js';
import { asStaff, book, call, customer, db, login, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

const someone = (i: number) => ({ ...customer, lastName: `Kunde${i}`, email: `k${i}@example.com` });

describe('concurrency', () => {
  it('20 parallel requests for the same slot → exactly one succeeds', async () => {
    const { app, slug, tenantId } = await setup({ limitScale: 100 });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => book(app, slug, { customer: someone(i) })));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(19);
    expect(results.find((r) => r.status === 409)!.json.error.code).toBe('SLOT_TAKEN');
    const { rows } = await db().query("SELECT count(*)::int AS n FROM appointment WHERE tenant_id = $1 AND status <> 'cancelled'", [tenantId]);
    expect(rows[0].n).toBe(1);
  });

  it('parallel overlapping (not identical) starts → no overlapping busy blocks', async () => {
    const { app, slug, tenantId } = await setup({ limitScale: 100 });
    const starts = ['09:00', '09:15', '09:30', '09:45', '10:00', '09:00', '09:30', '10:15'];
    await Promise.all(
      starts.map((s, i) => book(app, slug, { start: s, selection: { serviceId: 'cut', audience: 'women', adult: true, variant: 'wash' }, customer: someone(i) })),
    );
    const { rows } = await db().query(
      `SELECT count(*)::int AS n FROM time_block a JOIN time_block b ON a.stylist_id = b.stylist_id AND a.id < b.id
        WHERE a.tenant_id = $1 AND a.kind = 'busy' AND b.kind = 'busy' AND a.active AND b.active
          AND tstzrange(a.start_at, a.end_at) && tstzrange(b.start_at, b.end_at)`,
      [tenantId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('the database itself rejects overlapping busy blocks (exclusion constraint), even bypassing the app', async () => {
    const { tenantId, stylistIds } = await setup();
    const c1 = await db().connect();
    const c2 = await db().connect();
    try {
      const { rows } = await c1.query(
        `INSERT INTO customer (tenant_id, first_name, last_name, email) VALUES ($1, 'X', 'Y', 'x@example.com') RETURNING id`,
        [tenantId],
      );
      const ins = (c: typeof c1, ref: string) =>
        c.query(
          `WITH a AS (INSERT INTO appointment (tenant_id, ref_code, stylist_id, customer_id, service_id, audience, adult_declared, source, start_at, end_at)
                      VALUES ($1, $2, $3, $4, 'cut', 'women', true, 'staff', '2026-11-03T08:00Z', '2026-11-03T08:30Z') RETURNING id)
           INSERT INTO time_block (tenant_id, stylist_id, appointment_id, phase_key, kind, start_at, end_at)
           SELECT $1, $3, id, 'cut', 'busy', '2026-11-03T08:00Z', '2026-11-03T08:30Z' FROM a`,
          [tenantId, ref, stylistIds[0], rows[0].id],
        );
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      await ins(c1, 'AAA-111');
      // blocks until c1 commits. The rejection handler is attached right away: the error can arrive
      // before `await COMMIT` resumes, and a late handler is reported by Vitest as an unhandled rejection.
      const second = ins(c2, 'BBB-222').then(() => null, (e: unknown) => e);
      await c1.query('COMMIT');
      const err = await second;
      expect(pgCode(err)).toBe(PG.EXCLUSION_VIOLATION);
      await c2.query('ROLLBACK');
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('free blocks (Einwirkzeit) may overlap busy blocks – the constraint only covers busy time', async () => {
    const { app, slug } = await setup({ limitScale: 100 });
    const color = await book(app, slug, { selection: { serviceId: 'color_root', audience: 'women', adult: true }, start: '09:00' });
    expect(color.status).toBe(201); // 09:00–09:45 work, 09:45–10:15 processing, 10:15–10:45 styling
    const inGap = await book(app, slug, { start: '09:45', customer: someone(2) }); // 20′ cut inside processing
    expect(inGap.status).toBe(201);
  });

  it('two staff members editing the same appointment → one wins, the other gets VERSION_CONFLICT', async () => {
    const { app, slug } = await setup({ stylists: 2 });
    await book(app, slug, {});
    const s1 = await login(app, `s1@${slug}.test`);
    const s2 = await login(app, `s2@${slug}.test`);
    const a = (await call(app, 'GET', '/api/staff/requests', undefined, asStaff(s1))).json.requests[0];
    const move = (sid: string, delta: number) =>
      call(app, 'PATCH', `/api/staff/appointments/${a.id}/blocks`, {
        version: a.version,
        date: a.date,
        blocks: a.blocks.map((b: any) => ({ ...b, start: b.start + delta, end: b.end + delta })),
      }, asStaff(sid));
    const [r1, r2] = await Promise.all([move(s1, 5), move(s2, 10)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect([r1, r2].find((r) => r.status === 409)!.json.error.code).toBe('VERSION_CONFLICT');
  });
});
