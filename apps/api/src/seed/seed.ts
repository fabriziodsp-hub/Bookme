/**
 * Deterministic demo data: same seed + same start date → same data.
 * - platform admin, two salons (isolation demo), staff accounts, price list
 * - appointments for the next 3 months filling ~70 % of busy capacity, all created through the
 *   domain layer, so every business rule is respected by construction.
 * All names are invented; e-mails use the reserved example.com domain.
 */
import { addDays, buildBlocks, findService, hoursOn, offeredServices, type Selection } from '@salon/engine';
import { hashPassword } from '../auth/auth.js';
import { createAppointment } from '../domain/appointments.js';
import { tenantCtx, type Deps } from '../domain/context.js';
import { AppError } from '../domain/errors.js';
import { setPrices } from '../domain/prices.js';
import { createStaff } from '../domain/staff.js';
import { createTenant, tenantById } from '../domain/tenants.js';

/** mulberry32 – tiny deterministic PRNG. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Anna', 'Lena', 'Mia', 'Sofia', 'Clara', 'Laura', 'Emma', 'Hannah', 'Lea', 'Marie', 'Jonas', 'Elias', 'Paul', 'Noah', 'Felix', 'Leon', 'Ben', 'Tim', 'Luca', 'Giulia'];
const LAST = ['Müller', 'Schmidt', 'Weber', 'Fischer', 'Becker', 'Hoffmann', 'Schulz', 'Wagner', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Braun', 'Krüger', 'Hartmann', 'Lange', 'Werner', 'Rossi', 'Bianchi'];
const WEIGHT: Record<string, number> = { cut: 6, wash_set: 1, color_root: 2, color_full: 1.5, highlights: 1, balayage: 0.4, perm: 0.4 };

export interface SeedOptions {
  today: string; // local date in Europe/Berlin
  seed?: number;
  days?: number;
  fill?: number; // target share of busy capacity
  password?: string;
  log?: (m: string) => void;
}

export async function seedDemo(deps: Deps, opts: SeedOptions) {
  const rnd = prng(opts.seed ?? 20261027);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
  const password = opts.password ?? 'demo-passwort-2026';
  const log = opts.log ?? (() => undefined);
  const days = opts.days ?? 91;
  const fill = opts.fill ?? 0.7;

  await deps.db.query(
    `INSERT INTO staff_user (email, password_hash, role, display_name) VALUES ('admin@plattform.example.com', $1, 'platform_admin', 'Plattform-Admin')
     ON CONFLICT (email) DO NOTHING`,
    [await hashPassword(password)],
  );
  // D-049: demo user names (also for databases seeded before user names existed).
  await deps.db.query(`UPDATE staff_user SET username = 'admin' WHERE email = 'admin@plattform.example.com' AND username IS NULL`);

  const salons = [
    { slug: 'salon-beispiel', name: 'Salon Beispiel', staff: [['Maria Weber', 'owner'], ['Sophie Lang', 'stylist'], ['Deniz Kaya', 'stylist']] as const },
    { slug: 'studio-nord', name: 'Studio Nord', staff: [['Jana Petersen', 'owner']] as const },
  ];
  const summary: Record<string, number> = {};

  for (const s of salons) {
    const existing = await deps.db.query('SELECT 1 FROM tenant WHERE slug = $1', [s.slug]);
    if (existing.rowCount) {
      // D-049: demo databases seeded before user names existed get them now (only if still empty).
      for (const [name] of s.staff) {
        const first = name.split(' ')[0]!.toLowerCase();
        await deps.db.query('UPDATE staff_user SET username = $1 WHERE email = $2 AND username IS NULL', [first, `${first}@${s.slug}.example.com`]);
      }
      log(`salon ${s.slug} exists – skipped`);
      continue;
    }
    const t = await createTenant(deps, { slug: s.slug, name: s.name, stylistName: 'tmp', profile: { name: s.name } });
    await deps.db.query('DELETE FROM stylist WHERE tenant_id = $1', [t.id]);
    for (const [name, role] of s.staff) {
      const email = `${name.split(' ')[0]!.toLowerCase()}@${s.slug}.example.com`;
      await createStaff(deps.db, t.id, { displayName: name, email, username: name.split(' ')[0]!.toLowerCase(), password, role });
    }
    const ctx = tenantCtx(deps, await tenantById(deps, t.id));
    await setPrices(ctx, [
      { serviceId: 'cut', variant: 'dry', priceCents: 2800, isFrom: false, finishSurchargeCents: null },
      { serviceId: 'cut', variant: 'wash', priceCents: 3800, isFrom: true, finishSurchargeCents: null },
      { serviceId: 'cut_senior', variant: '', priceCents: 2000, isFrom: false, finishSurchargeCents: null },
      { serviceId: 'cut_kids', variant: '', priceCents: 2500, isFrom: false, finishSurchargeCents: null },
      { serviceId: 'wash_set', variant: '', priceCents: 3200, isFrom: false, finishSurchargeCents: null },
      { serviceId: 'color_root', variant: '', priceCents: 6900, isFrom: true, finishSurchargeCents: 1500 },
      { serviceId: 'color_full', variant: '', priceCents: 8900, isFrom: true, finishSurchargeCents: 1500 },
      { serviceId: 'highlights', variant: 'partial', priceCents: 7900, isFrom: true, finishSurchargeCents: 1500 },
      { serviceId: 'highlights', variant: 'full', priceCents: 9500, isFrom: true, finishSurchargeCents: 1500 },
      { serviceId: 'balayage', variant: '', priceCents: 19000, isFrom: true, finishSurchargeCents: null },
      { serviceId: 'perm', variant: '', priceCents: 9900, isFrom: true, finishSurchargeCents: null },
    ]);

    const { rows: stylists } = await deps.db.query<{ id: string }>('SELECT id FROM stylist WHERE tenant_id = $1 ORDER BY sort_order', [t.id]);
    let created = 0;
    let busyTotal = 0;
    let capTotal = 0;
    for (let i = 0; i < days; i++) {
      const date = addDays(opts.today, i);
      const h = hoursOn(ctx.cfg, date);
      if (!h) continue;
      const cap = h.close - h.open - h.breaks.reduce((a, b) => a + b.end - b.start, 0);
      for (const st of stylists) {
        capTotal += cap;
        // Sequential day plan: appointments back-to-back with gaps spread over the day, so ~30 %
        // stays free in realistic chunks (15–120 min) – long services remain bookable in the demo.
        let busy = 0;
        let gapBudget = cap * (1 - fill) * 0.75; // empirical: unusable 15′ remnants add to the free time
        let t = h.open;
        // Some afternoons stay completely free so 4-hour services (Balayage) are bookable in the demo.
        const freeAfternoon = h.breaks.length > 0 && rnd() < 0.12;
        const dayEnd = freeAfternoon ? h.breaks[0]!.start : h.close;
        if (freeAfternoon) gapBudget = Math.max(0, gapBudget - (h.close - h.breaks[0]!.end));
        const segEnd = (x: number) => h.breaks.find((b) => x < b.start)?.start ?? h.close;
        while (t < dayEnd) {
          const br = h.breaks.find((b) => t >= b.start && t < b.end);
          if (br) {
            t = br.end;
            continue;
          }
          const remaining = h.close - t;
          if (gapBudget > 0 && rnd() < Math.min(0.9, (1.6 * gapBudget) / Math.max(1, remaining))) {
            const g = Math.min(gapBudget, pick([15, 15, 30, 30, 45, 60, 90, 120]));
            t += g;
            gapBudget -= g;
            continue;
          }
          const audience = rnd() < 0.4 ? 'men' : 'women';
          const pool = offeredServices(ctx.cfg, audience, true);
          let r = rnd() * pool.reduce((a, x) => a + (WEIGHT[x.id] ?? 1), 0);
          let svc = pool[0]!;
          for (const x of pool) {
            r -= WEIGHT[x.id] ?? 1;
            if (r <= 0) {
              svc = x;
              break;
            }
          }
          const sel: Selection = {
            serviceId: svc.id,
            audience,
            adult: true,
            variant: svc.variants ? pick(svc.variants) : undefined,
            finish: svc.finishOption ? rnd() < 0.3 : undefined,
          };
          const start = svc.fixedStarts ? h.open : Math.ceil(t / 15) * 15;
          const blocks = buildBlocks(findService(ctx.cfg, svc.id)!, sel, start);
          if (start < t || blocks.at(-1)!.end > segEnd(start)) {
            // does not fit before the break/closing: try a short haircut, else leave a gap
            const cut: Selection = { serviceId: 'cut', audience, adult: true, variant: 'dry' };
            const cb = buildBlocks(findService(ctx.cfg, 'cut')!, cut, Math.ceil(t / 15) * 15);
            if (cb.at(-1)!.end <= segEnd(cb[0]!.start) && (await tryCreate(cut, cb[0]!.start))) {
              busy += cb.at(-1)!.end - cb[0]!.start;
              t = cb.at(-1)!.end;
            } else {
              t += 15;
              gapBudget -= 15;
            }
            continue;
          }
          if (await tryCreate(sel, start)) {
            busy += blocks.at(-1)!.end - blocks[0]!.start; // occupied time incl. Einwirkzeit
            t = blocks.at(-1)!.end;
          } else {
            t += 15;
            gapBudget -= 15;
          }
        }
        busyTotal += busy;

        async function tryCreate(sel: Selection, start: number): Promise<boolean> {
          const first = pick(FIRST);
          const last = pick(LAST);
          try {
            await createAppointment(ctx, {
              selection: sel,
              date,
              start,
              stylistId: st!.id,
              customer: {
                firstName: first,
                lastName: last,
                email: `${first}.${last}`.toLowerCase().replace(/ü/g, 'ue').replace(/ö/g, 'oe').replace(/ä/g, 'ae') + '@example.com',
                phone: rnd() < 0.5 ? `+4915${String(100000000 + Math.floor(rnd() * 899999999))}` : undefined,
              },
              source: 'staff',
              actor: 'system',
              notifyCustomer: false,
            });
            created++;
            return true;
          } catch (e) {
            if (!(e instanceof AppError)) throw e;
            return false;
          }
        }
      }
    }
    // A few open requests in the next days so the inbox and the approval flow can be demonstrated.
    await deps.db.query(
      `UPDATE appointment SET status = 'requested', source = 'online', expires_at = LEAST(created_at + interval '48 hours', start_at)
        WHERE id IN (SELECT id FROM appointment WHERE tenant_id = $1 AND start_at > now() ORDER BY start_at LIMIT 4 OFFSET 6)`,
      [t.id],
    );
    await deps.db.query(
      `UPDATE appointment SET status = 'discuss', source = 'online'
        WHERE id IN (SELECT id FROM appointment WHERE tenant_id = $1 AND status = 'confirmed' AND start_at > now() ORDER BY start_at LIMIT 1 OFFSET 12)`,
      [t.id],
    );
    summary[s.slug] = created;
    log(`${s.slug}: ${created} appointments, ${Math.round((100 * busyTotal) / Math.max(1, capTotal))} % of working time occupied`);
  }
  return summary;
}
