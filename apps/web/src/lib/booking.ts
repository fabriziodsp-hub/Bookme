import { buildBlocks, findService, type Block, type SalonConfig, type Selection } from '@salon/engine';
import type { PriceEntry } from './types';

/** Mirrors the server's price lookup (variant-specific wins, finish surcharge added). */
export function priceFor(list: readonly PriceEntry[], sel: Pick<Selection, 'serviceId' | 'variant' | 'finish'>) {
  const forService = list.filter((p) => p.serviceId === sel.serviceId);
  const p = forService.find((x) => x.variant === (sel.variant ?? '')) ?? forService.find((x) => x.variant === '');
  if (!p) return null;
  return { cents: p.priceCents + (sel.finish ? (p.finishSurchargeCents ?? 0) : 0), isFrom: p.isFrom };
}

/** Lowest price of a service across variants – for the service list ("ab 28 €"). */
export function priceFromFor(list: readonly PriceEntry[], serviceId: string) {
  const ps = list.filter((p) => p.serviceId === serviceId);
  if (!ps.length) return null;
  const min = Math.min(...ps.map((p) => p.priceCents));
  return { cents: min, isFrom: ps.length > 1 || ps.some((p) => p.isFrom) };
}

export function blocksFor(cfg: SalonConfig, sel: Selection, start = 0): Block[] | null {
  const s = findService(cfg, sel.serviceId);
  return s ? buildBlocks(s, sel, start) : null;
}

export const selectionQuery = (sel: Selection) =>
  new URLSearchParams({
    serviceId: sel.serviceId,
    audience: sel.audience,
    adult: String(sel.adult),
    ...(sel.variant ? { variant: sel.variant } : {}),
    ...(sel.finish ? { finish: 'true' } : {}),
  }).toString();
