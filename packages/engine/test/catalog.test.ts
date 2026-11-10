/** Services editor (D-048): hidden services, duration table round trip, ids. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkSelection,
  durationColumns,
  durationMatrix,
  durationRange,
  findService,
  loadSalonConfig,
  newKey,
  offeredServices,
  phasePlan,
  withAudiences,
  withDurations,
  type Service,
} from '../src/index.js';
import { salonConfig } from '../../config/src/salon.config.js';
import { arbSelection, cfg } from './fixture.js';

const svc = (id: string) => findService(cfg, id)!;
const withHidden = (id: string) => loadSalonConfig({ ...salonConfig, services: salonConfig.services.map((s) => (s.id === id ? { ...s, hidden: true } : s)) }, '2026-01-01');

describe('BR-14 hidden services are not bookable but stay in the catalogue', () => {
  it('a hidden service is not offered and a new selection is rejected', () => {
    const c = withHidden('perm');
    expect(offeredServices(c, 'women', true).map((s) => s.id)).not.toContain('perm');
    expect(checkSelection(c, { serviceId: 'perm', audience: 'women', adult: true })).toBe('SERVICE_HIDDEN');
  });
  it('its definition is still there for existing appointments', () => {
    const c = withHidden('perm');
    expect(findService(c, 'perm')?.phases).toHaveLength(5);
  });
  it('services are visible by default', () => {
    expect(cfg.services.every((s) => s.hidden === false)).toBe(true);
  });
});

describe('duration table', () => {
  it('columns: audience × variant, variant only, or a single column', () => {
    expect(durationColumns(svc('cut'))).toEqual([
      { audience: 'women', variant: 'dry' },
      { audience: 'women', variant: 'wash' },
      { audience: 'men', variant: 'dry' },
      { audience: 'men', variant: 'wash' },
    ]);
    expect(durationColumns({ ...svc('highlights'), audiences: ['women'] })).toEqual([
      { audience: undefined, variant: 'partial' },
      { audience: undefined, variant: 'full' },
    ]);
    expect(durationColumns(svc('perm'))).toEqual([{}]);
  });

  it('reads the real config (A-01: women 30/45, men 30/30)', () => {
    expect(durationMatrix(svc('cut'))).toEqual([[30, 45, 30, 30]]);
    expect(durationMatrix(svc('highlights'))).toEqual([
      [45, 60, 45, 60],
      [30, 30, 30, 30],
      [30, 30, 30, 30],
      [30, 30, 30, 30],
    ]);
  });

  it('round trip keeps every duration of every bookable selection (property)', () => {
    fc.assert(
      fc.property(arbSelection(), (sel) => {
        const s = svc(sel.serviceId);
        const again = withDurations(s, durationMatrix(s));
        expect(phasePlan(again, sel)).toEqual(phasePlan(s, sel));
      }),
    );
  });

  it('an edited value only changes its own column and stays valid', () => {
    const s = svc('cut');
    const edited = withDurations(s, [[30, 45, 30, 40]]); // men with wash 30 → 40
    expect(phasePlan(edited, { audience: 'men', variant: 'wash' })[0]!.minutes).toBe(40);
    expect(phasePlan(edited, { audience: 'men', variant: 'dry' })[0]!.minutes).toBe(30);
    expect(phasePlan(edited, { audience: 'women', variant: 'wash' })[0]!.minutes).toBe(45);
    const c = loadSalonConfig({ ...salonConfig, services: [edited, ...cfg.services.filter((x) => x.id !== 'cut')] }, '2026-01-01');
    expect(findService(c, 'cut')!.phases[0]!.audienceVariantMinutes).toEqual({ men: { wash: 40 } }); // only values that differ from women
  });

  it('without variants there is one duration per phase', () => {
    const s = withDurations(svc('perm'), [[30], [30], [20], [15], [30]]);
    expect(phasePlan(s, {}).map((p) => p.minutes)).toEqual([30, 30, 20, 15, 30]);
    expect(s.phases[0]!.variantMinutes).toBeUndefined();
  });

  it('removing an audience drops its overrides (config stays valid)', () => {
    const s = withAudiences(svc('cut'), ['women']);
    expect(s.phases[0]!.audienceVariantMinutes).toBeUndefined();
    expect(durationMatrix(s)).toEqual([[30, 45]]);
    expect(() => loadSalonConfig({ ...salonConfig, services: [s, ...cfg.services.filter((x) => x.id !== 'cut')] }, '2026-01-01')).not.toThrow();
  });

  it('adding an audience starts from the first audience', () => {
    const women = withAudiences(svc('cut'), ['women']);
    expect(durationMatrix(withAudiences(women, ['women', 'men']))).toEqual([[30, 45, 30, 45]]);
    expect(durationMatrix(withAudiences(svc('perm'), ['women']))).toEqual(durationMatrix(svc('perm')));
  });

  it('range for the booking hint', () => {
    expect(durationRange(svc('cut'), 'women')).toEqual({ min: 30, max: 45, hasFree: false });
    expect(durationRange(svc('cut'), 'men')).toEqual({ min: 30, max: 30, hasFree: false });
    expect(durationRange(svc('highlights'), 'women')).toEqual({ min: 135, max: 150, hasFree: true });
  });
});

describe('ids for new services and phases', () => {
  it('slug from the German name, unique', () => {
    expect(newKey('Föhnen & Glätten', [])).toBe('foehnen_glaetten');
    expect(newKey('Haarschnitt', ['haarschnitt'])).toBe('haarschnitt_2');
    expect(newKey('Haarschnitt', ['haarschnitt', 'haarschnitt_2'])).toBe('haarschnitt_3');
    expect(newKey('3D Farbe', [])).toBe('x_3d_farbe');
    expect(newKey('!!!', [], 'p')).toBe('p');
  });
});

describe('config validation for edited catalogues', () => {
  const base = svc('perm');
  const load = (s: Service) => () => loadSalonConfig({ ...salonConfig, services: [s] }, '2026-01-01');
  it('rejects duplicate phase keys', () => {
    expect(load({ ...base, phases: [base.phases[0]!, base.phases[0]!] })).toThrow(/duplicate phase key/);
  });
  it('accepts names and the hidden flag', () => {
    expect(load({ ...base, label: 'Locken', hidden: true, phases: base.phases.map((p) => ({ ...p, label: 'Schritt' })) })).not.toThrow();
  });
  it('rejects empty names', () => {
    expect(load({ ...base, label: '  ' })).toThrow();
  });
});
