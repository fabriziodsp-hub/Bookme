/**
 * Helpers for editing the service catalogue (services editor, D-048).
 *
 * The editor shows one duration per phase and "column", where a column is one bookable
 * combination of audience and variant. These helpers translate between that table and the
 * compact config fields (`minutes`, `variantMinutes`, `audienceVariantMinutes`).
 */
import type { Audience, Phase, Service } from './config.js';
import { phasePlan } from './services.js';

export interface DurationColumn {
  /** Set only when durations can differ per audience (services with variants and both audiences). */
  audience?: Audience | undefined;
  variant?: string | undefined;
}

/** Columns of the duration table: audience × variant, or a single column without variants. */
export function durationColumns(service: Service): DurationColumn[] {
  if (!service.variants?.length) return [{}];
  const auds: (Audience | undefined)[] = service.audiences.length > 1 ? service.audiences : [undefined];
  return auds.flatMap((audience) => service.variants!.map((variant) => ({ audience, variant })));
}

/** Duration table [phase][column] of a service (without the optional finish). */
export function durationMatrix(service: Service): number[][] {
  const cols = durationColumns(service);
  const plans = cols.map((c) => phasePlan(service, { variant: c.variant, audience: c.audience ?? service.audiences[0] }));
  return service.phases.map((_, i) => plans.map((p) => p[i]!.minutes));
}

/**
 * Writes a duration table back into the service. The first audience is the reference: its
 * values go to `variantMinutes`, the other audience only keeps the values that differ.
 */
export function withDurations(service: Service, matrix: readonly (readonly number[])[]): Service {
  const cols = durationColumns(service);
  const at = (row: readonly number[], audience: Audience | undefined, variant: string) => {
    const i = cols.findIndex((c) => c.variant === variant && (c.audience === undefined || c.audience === audience));
    return row[i]!;
  };
  const phases = service.phases.map((p, pi): Phase => {
    const row = matrix[pi]!;
    const { variantMinutes: _vm, audienceVariantMinutes: _avm, ...rest } = p;
    if (!service.variants?.length) return { ...rest, minutes: row[0]! };
    const [primary, ...others] = service.audiences;
    const vm = Object.fromEntries(service.variants.map((v) => [v, at(row, primary, v)]));
    const avm: Partial<Record<Audience, Record<string, number>>> = {};
    for (const aud of others) {
      const diff = Object.fromEntries(service.variants.filter((v) => at(row, aud, v) !== vm[v]).map((v) => [v, at(row, aud, v)]));
      if (Object.keys(diff).length) avm[aud] = diff;
    }
    const minutes = vm[service.defaultVariant ?? service.variants[0]!]!;
    return { ...rest, minutes, variantMinutes: vm, ...(Object.keys(avm).length ? { audienceVariantMinutes: avm } : {}) };
  });
  return { ...service, phases };
}

/** Changes the audiences and drops duration overrides of audiences no longer offered. */
export function withAudiences(service: Service, audiences: Audience[]): Service {
  const matrixBefore = durationMatrix(service);
  const colsBefore = durationColumns(service);
  const next: Service = { ...service, audiences };
  const colsAfter = durationColumns(next);
  // Keep every value whose column still exists; new columns start from the first audience's value.
  const matrix = matrixBefore.map((row) =>
    colsAfter.map((c) => {
      const same = colsBefore.findIndex((b) => b.variant === c.variant && (b.audience ?? audiences[0]) === (c.audience ?? audiences[0]));
      if (same >= 0) return row[same]!;
      const ref = colsBefore.findIndex((b) => b.variant === c.variant);
      return row[ref]!;
    }),
  );
  return withDurations(next, matrix);
}

/** Shortest and longest total duration of a service for one audience (for the booking hint). */
export function durationRange(service: Service, audience: Audience): { min: number; max: number; hasFree: boolean } {
  const variants = service.variants?.length ? service.variants : [undefined];
  const totals = variants.map((variant) => phasePlan(service, { variant, audience }).reduce((a, p) => a + p.minutes, 0));
  return { min: Math.min(...totals), max: Math.max(...totals), hasFree: service.phases.some((p) => p.kind === 'free') };
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** Stable id for a new service or phase, derived from its name and unique among `taken`. */
export function newKey(label: string, taken: Iterable<string>, prefix = 'x'): string {
  const base =
    label
      .toLowerCase()
      .replace(/[äöüß]/g, (c) => UMLAUTS[c]!)
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || prefix;
  const start = /^[a-z]/.test(base) ? base : `${prefix}_${base}`;
  const used = new Set(taken);
  let key = start;
  for (let n = 2; used.has(key); n++) key = `${start}_${n}`;
  return key;
}
