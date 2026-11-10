import { loadSalonConfig } from '@salon/engine';
import { salonConfig as rawSalonConfig } from '../../../../packages/config/src/salon.config';
import { createT } from '@salon/i18n';
import { describe, expect, it } from 'vitest';
import { formatDuration, makeLabels } from './labels';

const t = Object.assign(createT('de'), { list: () => [] as string[], locale: 'de' as const });
const cfg = loadSalonConfig(rawSalonConfig, '2026-01-01');
const L = makeLabels(cfg, t);
const svc = (id: string) => cfg.services.find((s) => s.id === id)!;

describe('labels (services editor, D-048)', () => {
  it('default names come from the translations', () => {
    expect(L.service('cut')).toBe('Haarschnitt');
    expect(L.phase('processing', 'highlights')).toBe('Einwirkzeit');
    expect(L.variant('wash')).toBe('mit Waschen');
    expect(L.service('unknown')).toBe('unknown');
  });
  it('the salon’s own names win', () => {
    const own = { ...cfg, services: cfg.services.map((s) => (s.id === 'perm' ? { ...s, label: 'Locken', phases: s.phases.map((p) => ({ ...p, label: p.key === 'perm_rinse' ? 'Spülen' : undefined })) } : s)) };
    const M = makeLabels(own, t);
    expect(M.service('perm')).toBe('Locken');
    expect(M.phase('perm_rinse', 'perm')).toBe('Spülen');
    expect(M.phase('perm_rinse')).toBe('Ausspülen & Fixierung'); // without service: translation first
  });
  it('booking hint is computed from the durations', () => {
    expect(L.hint(svc('cut'), 'women')).toBe('30–45 Min.');
    expect(L.hint(svc('cut'), 'men')).toBe('30 Min.');
    expect(L.hint(svc('highlights'), 'women')).toBe('2 Std. 15 Min. – 2 Std. 30 Min. · inkl. Einwirkzeit');
    expect(L.hint(svc('balayage'), 'women')).toBe('4 Std. · Beginn 08:00 oder 13:00 Uhr');
    expect(L.finishHint(svc('color_root'))).toBe('Styling 30 Min., mit Veredelung 45 Min.');
    expect(L.finishHint(svc('cut'))).toBe('');
  });
  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45 Min.');
    expect(formatDuration(60)).toBe('1 Std.');
    expect(formatDuration(150)).toBe('2 Std. 30 Min.');
  });
});
