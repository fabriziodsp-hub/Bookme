import { fromInstant, type Now } from '@salon/engine';

/** Injectable clock so tests and demos can freeze "now". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock {
  const t = new Date(iso).getTime();
  return { now: () => new Date(t) };
}

/** Mutable clock for tests. */
export function manualClock(iso: string) {
  let t = new Date(iso).getTime();
  return {
    now: () => new Date(t),
    set: (next: string) => {
      t = new Date(next).getTime();
    },
    advanceMinutes: (m: number) => {
      t += m * 60_000;
    },
  };
}

export function salonNow(clock: Clock, timeZone: string): Now {
  return fromInstant(clock.now(), timeZone);
}
