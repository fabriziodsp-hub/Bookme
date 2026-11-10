import { describe, expect, it } from 'vitest';
import { ACCENTS, BASE, contrast, type Accent, type Flavor, type Scheme } from './palette';

const flavors = Object.keys(BASE) as Flavor[];
const schemes: Scheme[] = ['light', 'dark'];

describe('WCAG 2.2 AA contrast for every theme combination', () => {
  for (const f of flavors) for (const s of schemes) {
    const t = BASE[f][s];
    it(`${f}/${s}: text and muted text ≥ 4.5:1 on bg, surface and surface2`, () => {
      for (const bg of [t.bg, t.surface, t.surface2]) {
        expect(contrast(t.text, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.muted, bg)).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${f}/${s}: control borders ≥ 3:1 (1.4.11), block inks ≥ 4.5:1`, () => {
      expect(contrast(t.borderStrong, t.surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.freeInk, t.free)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.dangerInk, t.danger)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.danger, t.surface)).toBeGreaterThanOrEqual(3);
    });
  }
  for (const a of Object.keys(ACCENTS) as Accent[]) for (const s of schemes) {
    it(`accent ${a}/${s}: ink on accent ≥ 4.5:1, accent vs every background ≥ 3:1`, () => {
      const { ac, ink } = ACCENTS[a][s];
      expect(contrast(ink, ac)).toBeGreaterThanOrEqual(4.5);
      for (const f of ['neutral', 'warm'] as const) {
        expect(contrast(ac, BASE[f][s].surface)).toBeGreaterThanOrEqual(3);
        expect(contrast(ac, BASE[f][s].bg)).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
