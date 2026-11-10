/**
 * Services editor (D-048): the salon owner and the platform admin edit services, phases and
 * durations. Rules:
 * - existing appointments keep their stored blocks (time_block) – new durations apply to new bookings;
 * - a service (or variant) that has appointments cannot be removed, only hidden;
 * - optimistic lock: the client sends the version it edited, a parallel save wins only once.
 */
import { de } from '@salon/i18n';
import { loadSalonConfig, ServiceSchema, type SalonConfig, type Service } from '@salon/engine';
import { z } from 'zod';
import { withTx, type Queryable } from '../db/pool.js';
import type { Ctx } from './context.js';
import { AppError } from './errors.js';
import { invalidateTenant } from './tenants.js';
import { sha256 } from './util.js';

export const catalogVersion = (cfg: SalonConfig) => sha256(JSON.stringify(cfg.services)).slice(0, 16);

const serviceName = (s: Pick<Service, 'id' | 'label'>) => s.label ?? (de.service as Record<string, string>)[s.id] ?? s.id;
const phaseName = (p: { key: string; label?: string | undefined }) => p.label ?? (de.phase as Record<string, string>)[p.key] ?? p.key;
const invalid = (msg: string) => new AppError('CATALOG_INVALID', 422, msg);

/** Service ids (and variants) referenced by any appointment of the salon, past or future. */
async function usage(q: Queryable, tenantId: string): Promise<{ serviceId: string; variant: string | null }[]> {
  const { rows } = await q.query<{ service_id: string; variant: string | null }>(
    'SELECT DISTINCT service_id, variant FROM appointment WHERE tenant_id = $1',
    [tenantId],
  );
  return rows.map((r) => ({ serviceId: r.service_id, variant: r.variant }));
}

export async function getCatalog(ctx: Ctx) {
  const used = await usage(ctx.db, ctx.tenantId);
  return { services: ctx.cfg.services, version: catalogVersion(ctx.cfg), inUse: [...new Set(used.map((u) => u.serviceId))], step: ctx.cfg.staffStepMinutes };
}

/** Readable German checks for what the editor lets people change; the engine validates the rest. */
function checkServices(services: Service[], step: number): void {
  const ids = new Set<string>();
  for (const s of services) {
    const name = `„${serviceName(s)}“`;
    if (ids.has(s.id)) throw invalid(`${name} gibt es doppelt.`);
    ids.add(s.id);
    if (!s.audiences.length) throw invalid(`${name}: Bitte mindestens Damen oder Herren wählen.`);
    if (!s.phases.length) throw invalid(`${name}: Mindestens ein Arbeitsschritt ist nötig.`);
    for (const p of s.phases) {
      const all = [p.minutes, p.finishMinutes, ...Object.values(p.variantMinutes ?? {}), ...Object.values(p.audienceVariantMinutes?.women ?? {}), ...Object.values(p.audienceVariantMinutes?.men ?? {})];
      if (all.some((m) => m !== undefined && (m <= 0 || m % step !== 0))) {
        throw invalid(`${name}, Schritt „${phaseName(p)}“: Die Dauer muss ein Vielfaches von ${step} Minuten sein.`);
      }
      if (all.some((m) => m !== undefined && m > 600)) throw invalid(`${name}, Schritt „${phaseName(p)}“: Höchstens 600 Minuten.`);
    }
    if (s.phases[0]!.kind !== 'busy' || s.phases.at(-1)!.kind !== 'busy') {
      throw invalid(`${name}: Der erste und der letzte Schritt müssen Arbeitszeit sein (keine Einwirkzeit).`);
    }
  }
}

/** A service or variant that has appointments must stay in the catalogue (hide instead of delete). */
async function assertUsage(q: Queryable, ctx: Ctx, current: SalonConfig, cfg: SalonConfig): Promise<void> {
  for (const u of await usage(q, ctx.tenantId)) {
    const before = current.services.find((s) => s.id === u.serviceId);
    const after = cfg.services.find((s) => s.id === u.serviceId);
    const name = `„${serviceName(after ?? before ?? { id: u.serviceId })}“`;
    if (!after) throw new AppError('SERVICE_IN_USE', 409, `${name} hat bereits Termine und kann nicht gelöscht werden. Bitte stattdessen ausblenden.`);
    if (u.variant && !after.variants?.includes(u.variant)) {
      throw new AppError('SERVICE_IN_USE', 409, `${name}: Die Variante „${(de.variant as Record<string, string>)[u.variant] ?? u.variant}“ hat bereits Termine und kann nicht entfernt werden.`);
    }
  }
}

/** Prices of services/variants that no longer exist are removed with the catalogue change. */
async function dropOrphanPrices(q: Queryable, ctx: Ctx, cfg: SalonConfig): Promise<void> {
  const prices = await q.query<{ service_id: string; variant: string }>('SELECT service_id, variant FROM price WHERE tenant_id = $1', [ctx.tenantId]);
  for (const p of prices.rows) {
    const s = cfg.services.find((x) => x.id === p.service_id);
    if (!s || (p.variant && !s.variants?.includes(p.variant))) {
      await q.query('DELETE FROM price WHERE tenant_id = $1 AND service_id = $2 AND variant = $3', [ctx.tenantId, p.service_id, p.variant]);
    }
  }
}

const lockConfig = async (q: Queryable, ctx: Ctx) => {
  const row = await q.query<{ config: unknown }>('SELECT config FROM tenant WHERE id = $1 FOR UPDATE', [ctx.tenantId]);
  return loadSalonConfig(row.rows[0]!.config, ctx.clock.now().toISOString().slice(0, 10));
};

/** Validates a new catalogue against the current config and the appointments that use it. */
async function validate(q: Queryable, ctx: Ctx, current: SalonConfig, input: unknown): Promise<SalonConfig> {
  const parsed = z.array(ServiceSchema).min(1).max(60).safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0]!;
    if (i.path.length === 0) throw invalid('Mindestens eine Leistung ist nötig.');
    // Translate the issues the editor can produce; anything else is a programming error.
    const raw = (input as { id?: string; label?: string }[])[i.path[0] as number];
    const name = `„${raw?.label?.trim() || (raw?.id ? serviceName({ id: raw.id }) : `Leistung ${Number(i.path[0]) + 1}`)}“`;
    const field = i.path[1];
    if (field === 'audiences') throw invalid(`${name}: Bitte mindestens Damen oder Herren wählen.`);
    if (field === 'phases' && i.path.length === 2) throw invalid(`${name}: Mindestens ein Arbeitsschritt ist nötig.`);
    if (field === 'label' || (field === 'phases' && i.path[3] === 'label')) throw invalid(`${name}: Bitte einen Namen eingeben (Leistung höchstens 60, Schritt höchstens 40 Zeichen).`);
    if (field === 'phases') throw invalid(`${name}: Bitte die Dauer jedes Schritts prüfen (ganze Minuten, größer als 0).`);
    throw invalid(`${name}: Ungültige Angabe (${i.path.slice(1).join('.')}).`);
  }
  checkServices(parsed.data, current.staffStepMinutes);
  let cfg: SalonConfig;
  try {
    cfg = loadSalonConfig({ ...current, services: parsed.data }, ctx.clock.now().toISOString().slice(0, 10));
  } catch (e) {
    throw invalid(`Die Leistungen sind so nicht gültig. ${(e as Error).message.split('\n').slice(1, 2).join('')}`.trim());
  }
  await assertUsage(q, ctx, current, cfg);
  return cfg;
}

/**
 * Replace the salon's services. `version` must be the one the editor loaded (optimistic lock).
 * Prices of removed services/variants are deleted in the same transaction.
 */
export async function setCatalog(ctx: Ctx, services: unknown, version: string) {
  const cfg = await withTx(ctx.db, async (tx) => {
    const current = await lockConfig(tx, ctx);
    if (catalogVersion(current) !== version) {
      throw new AppError('CATALOG_CONFLICT', 409, 'Die Leistungen wurden inzwischen geändert (z. B. von einer anderen Person). Bitte die Seite neu laden.');
    }
    const next = await validate(tx, ctx, current, services);
    await tx.query('UPDATE tenant SET config = $2 WHERE id = $1', [ctx.tenantId, JSON.stringify(next)]);
    await dropOrphanPrices(tx, ctx, next);
    return next;
  });
  invalidateTenant(ctx.tenant.slug);
  const used = await usage(ctx.db, ctx.tenantId);
  return { services: cfg.services, version: catalogVersion(cfg), inUse: [...new Set(used.map((u) => u.serviceId))], step: cfg.staffStepMinutes };
}

/**
 * Platform admin: replace services and rules from a full config (opening hours stay the salon's).
 * Same usage rules as the editor.
 */
export async function setServicesConfig(ctx: Ctx, input: unknown): Promise<void> {
  await withTx(ctx.db, async (tx) => {
    const current = await lockConfig(tx, ctx);
    let cfg: SalonConfig;
    try {
      cfg = loadSalonConfig({ ...(input as object), weeklyHours: current.weeklyHours }, ctx.clock.now().toISOString().slice(0, 10));
    } catch (e) {
      throw invalid(`Die Konfiguration ist so nicht gültig. ${(e as Error).message.split('\n').slice(1, 2).join('')}`.trim());
    }
    await assertUsage(tx, ctx, current, cfg);
    await tx.query('UPDATE tenant SET config = $2 WHERE id = $1', [ctx.tenantId, JSON.stringify(cfg)]);
    await dropOrphanPrices(tx, ctx, cfg);
  });
  invalidateTenant(ctx.tenant.slug);
}
