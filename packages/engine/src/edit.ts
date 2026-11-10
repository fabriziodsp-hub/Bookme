/** Staff edit operations on block sequences. All pure; validation is separate (checkPlacement). */
import type { Block } from './services.js';
import type { Minute } from './time.js';

/** Move every block by `delta` minutes. */
export function shiftBlocks(blocks: readonly Block[], delta: Minute): Block[] {
  return blocks.map((b) => ({ ...b, start: b.start + delta, end: b.end + delta }));
}

/** Move so that the first block starts at `start`. */
export function moveTo(blocks: readonly Block[], start: Minute): Block[] {
  return shiftBlocks(blocks, start - (blocks[0]?.start ?? start));
}

/**
 * Change the length of phase `index` by `delta`; later phases shift so the
 * sequence stays contiguous. Returns null if the phase would drop below `minMinutes`.
 */
export function resizePhase(
  blocks: readonly Block[],
  index: number,
  delta: Minute,
  minMinutes: Minute,
): Block[] | null {
  const target = blocks[index];
  if (!target) return null;
  if (target.end - target.start + delta < minMinutes) return null;
  let t = blocks[0]!.start;
  return blocks.map((b, i) => {
    const len = b.end - b.start + (i === index ? delta : 0);
    const out = { ...b, start: t, end: t + len };
    t += len;
    return out;
  });
}

/** Snap a raw minute delta (e.g. from pointer pixels) to the staff grid. */
export function snap(deltaMinutes: number, step: Minute): Minute {
  const r = Math.round(deltaMinutes / step) * step;
  return r === 0 ? 0 : r; // avoid -0
}
