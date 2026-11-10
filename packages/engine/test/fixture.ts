import fc from 'fast-check';
import { loadSalonConfig, type SalonConfig } from '../src/index.js';
import { salonConfig } from '../../config/src/salon.config.js';

/** The real salon configuration, so property tests exercise production rules. */
export const cfg: SalonConfig = loadSalonConfig(salonConfig, '2026-01-01');

export const TODAY = '2026-10-27'; // a Tuesday
export const NOW = { date: TODAY, minute: 7 * 60 };

/** Random selection that is valid for the catalogue (any audience/age). */
export const arbSelection = (c: SalonConfig = cfg) =>
  fc
    .constantFrom(...c.services)
    .chain((s) =>
      fc.record({
        serviceId: fc.constant(s.id),
        audience: fc.constantFrom(...s.audiences),
        adult: s.adultOnly ? fc.constant(true) : fc.boolean(),
        variant: s.variants ? fc.constantFrom(...s.variants) : fc.constant(undefined),
        finish: s.finishOption ? fc.boolean() : fc.constant(undefined),
      }),
    );

/** Dates from 2026 to 2036, covering many DST transitions. */
export const arbDate = fc
  .integer({ min: 0, max: 3650 })
  .map((n) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10));
