/** Turning a service selection into a sequence of timed blocks. */
import type { Audience, SalonConfig, Service } from './config.js';
import type { Minute } from './time.js';

export type BlockKind = 'busy' | 'free';

export interface Block {
  start: Minute;
  end: Minute;
  kind: BlockKind;
  /** Phase key from config, e.g. "color_work", "processing", "styling". */
  phase: string;
}

export interface Selection {
  serviceId: string;
  audience: Audience;
  /** Answer to "volljährig ja/nein" – asked before the service. */
  adult: boolean;
  variant?: string | undefined;
  finish?: boolean | undefined;
}

export type SelectionViolation =
  | 'UNKNOWN_SERVICE'
  | 'SERVICE_HIDDEN'
  | 'AUDIENCE_NOT_OFFERED'
  | 'AGE_RESTRICTED'
  | 'INVALID_VARIANT'
  | 'FINISH_NOT_AVAILABLE';

/** Services that may be booked for the given audience and age answer (hidden ones excluded). */
export function offeredServices(cfg: SalonConfig, audience: Audience, adult: boolean): Service[] {
  return cfg.services.filter((s) => !s.hidden && s.audiences.includes(audience) && (adult || !s.adultOnly));
}

/** Validates a selection against the catalogue. Returns null when valid. */
export function checkSelection(cfg: SalonConfig, sel: Selection): SelectionViolation | null {
  const s = cfg.services.find((x) => x.id === sel.serviceId);
  if (!s) return 'UNKNOWN_SERVICE';
  if (s.hidden) return 'SERVICE_HIDDEN';
  if (!s.audiences.includes(sel.audience)) return 'AUDIENCE_NOT_OFFERED';
  if (s.adultOnly && !sel.adult) return 'AGE_RESTRICTED';
  if (sel.variant !== undefined && !s.variants?.includes(sel.variant)) return 'INVALID_VARIANT';
  if (sel.finish && !s.finishOption) return 'FINISH_NOT_AVAILABLE';
  return null;
}

/** The parts of a selection that determine durations. */
export type DurationSelection = Pick<Selection, 'variant' | 'finish'> & { audience?: Audience | undefined };

/** Phase durations for a selection (no start time yet). Assumes a valid selection. */
export function phasePlan(service: Service, sel: DurationSelection) {
  const variant = sel.variant ?? service.defaultVariant;
  return service.phases.map((p) => {
    let minutes = p.minutes;
    if (variant !== undefined) {
      const byAudience = sel.audience ? p.audienceVariantMinutes?.[sel.audience]?.[variant] : undefined;
      const byVariant = p.variantMinutes?.[variant];
      if (byAudience !== undefined) minutes = byAudience;
      else if (byVariant !== undefined) minutes = byVariant;
    }
    if (sel.finish && p.finishMinutes !== undefined) minutes = p.finishMinutes;
    return { phase: p.key, kind: p.kind, minutes };
  });
}

/** Lay the phases out back-to-back from `start`. */
export function buildBlocks(
  service: Service,
  sel: DurationSelection,
  start: Minute,
): Block[] {
  let t = start;
  return phasePlan(service, sel).map(({ phase, kind, minutes }) => {
    const b: Block = { start: t, end: t + minutes, kind, phase };
    t += minutes;
    return b;
  });
}

export function totalMinutes(blocks: readonly Block[]): number {
  return blocks.length ? blocks.at(-1)!.end - blocks[0]!.start : 0;
}

export function busyMinutes(blocks: readonly Block[]): number {
  return blocks.reduce((a, b) => a + (b.kind === 'busy' ? b.end - b.start : 0), 0);
}
