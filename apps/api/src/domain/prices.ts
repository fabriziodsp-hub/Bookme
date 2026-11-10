/** Per-salon price list (owner admin). Prices are informative – nothing is paid in the app. */
import { findService, type Selection } from '@salon/engine';
import { withTx, type Queryable } from '../db/pool.js';
import type { Ctx } from './context.js';
import { Errors } from './errors.js';

export interface PriceEntry {
  serviceId: string;
  /** '' = valid for all variants of the service */
  variant: string;
  priceCents: number;
  isFrom: boolean;
  finishSurchargeCents: number | null;
}

export async function listPrices(q: Queryable, tenantId: string): Promise<PriceEntry[]> {
  const { rows } = await q.query<{ service_id: string; variant: string; price_cents: number; is_from: boolean; finish_surcharge_cents: number | null }>(
    'SELECT service_id, variant, price_cents, is_from, finish_surcharge_cents FROM price WHERE tenant_id = $1 ORDER BY service_id, variant',
    [tenantId],
  );
  return rows.map((r) => ({ serviceId: r.service_id, variant: r.variant, priceCents: r.price_cents, isFrom: r.is_from, finishSurchargeCents: r.finish_surcharge_cents }));
}

/** Replace the whole price list atomically (validated against the salon's services). */
export async function setPrices(ctx: Ctx, entries: PriceEntry[]): Promise<PriceEntry[]> {
  const seen = new Set<string>();
  for (const e of entries) {
    const s = findService(ctx.cfg, e.serviceId);
    if (!s) throw Errors.validation({ serviceId: `Unbekannte Leistung ${e.serviceId}` });
    if (e.variant && !s.variants?.includes(e.variant)) throw Errors.validation({ variant: `Unbekannte Variante ${e.variant}` });
    if (e.finishSurchargeCents !== null && !s.finishOption) throw Errors.validation({ finishSurchargeCents: 'Keine Veredelung bei dieser Leistung.' });
    if (!Number.isInteger(e.priceCents) || e.priceCents < 0 || e.priceCents > 1_000_000) throw Errors.validation({ priceCents: 'Ungültiger Preis.' });
    const k = `${e.serviceId}|${e.variant}`;
    if (seen.has(k)) throw Errors.validation({ serviceId: `Doppelter Eintrag ${k}` });
    seen.add(k);
  }
  await withTx(ctx.db, async (tx) => {
    await tx.query('DELETE FROM price WHERE tenant_id = $1', [ctx.tenantId]);
    for (const e of entries) {
      await tx.query(
        'INSERT INTO price (tenant_id, service_id, variant, price_cents, is_from, finish_surcharge_cents) VALUES ($1,$2,$3,$4,$5,$6)',
        [ctx.tenantId, e.serviceId, e.variant, e.priceCents, e.isFrom, e.finishSurchargeCents],
      );
    }
  });
  return listPrices(ctx.db, ctx.tenantId);
}

/** Price for a selection: variant-specific entry wins over the service-wide one. */
export function priceFor(list: readonly PriceEntry[], sel: Pick<Selection, 'serviceId' | 'variant' | 'finish'>): { cents: number; isFrom: boolean } | null {
  const forService = list.filter((p) => p.serviceId === sel.serviceId);
  const p = forService.find((x) => x.variant === (sel.variant ?? '')) ?? forService.find((x) => x.variant === '');
  if (!p) return null;
  return { cents: p.priceCents + (sel.finish ? (p.finishSurchargeCents ?? 0) : 0), isFrom: p.isFrom };
}

export const formatEuro = (cents: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
