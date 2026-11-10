import { describe, expect, it } from 'vitest';
import { findDstConflicts, loadSalonConfig, SalonConfigSchema } from '../src/index.js';
import { salonConfig } from '../../config/src/salon.config.js';

const clone = () => structuredClone(salonConfig) as unknown as Record<string, any>;

describe('salon config validation', () => {
  it('accepts the production config', () => {
    expect(() => loadSalonConfig(salonConfig, '2026-10-27')).not.toThrow();
  });

  it('reports readable errors', () => {
    const c = clone();
    c.weeklyHours.mon = { open: '17:00', close: '08:00', breaks: [] };
    c.services[0].phases[0].minutes = 7;
    c.services.push({ ...c.services[0] });
    expect(() => loadSalonConfig(c)).toThrow(/close must be after open[\s\S]*multiples[\s\S]*duplicate/);
  });

  it.each([
    ['unknown time zone', (c: any) => (c.timeZone = 'Mars/Olympus'), /Unknown IANA/],
    ['slot step not multiple of staff step', (c: any) => (c.slotStepMinutes = 12), /multiple of staffStepMinutes/],
    ['open off grid', (c: any) => (c.weeklyHours.tue = { open: '08:03', close: '17:00', breaks: [] }), /staff grid/],
    ['break outside hours', (c: any) => (c.weeklyHours.wed.breaks = [['18:00', '19:00']]), /inside opening hours/],
    ['break inverted', (c: any) => (c.weeklyHours.thu = { ...c.weeklyHours.thu, breaks: [['13:00', '12:00']] }), /break end/],
    ['default variant missing', (c: any) => delete c.services[0].defaultVariant, /required when variants/],
    ['default variant unknown', (c: any) => (c.services[0].defaultVariant = 'x'), /must be one of variants/],
    ['variant minutes missing', (c: any) => delete c.services[0].phases[0].variantMinutes.dry, /missing variant dry/],
    ['variant minutes unknown', (c: any) => (c.services[0].phases[0].variantMinutes.zz = 10), /unknown variant zz/],
    ['audience variant unknown', (c: any) => (c.services[0].phases[0].audienceVariantMinutes.men.zz = 10), /unknown variant zz/],
    ['audience variant for audience not offered', (c: any) => (c.services[1].phases[0].audienceVariantMinutes = { men: {} }), /audience not offered/],
    ['fee rule with both amount and formula', (c: any) => (c.services[5].feeRule.amountCents = 15000), /exactly one/],
    ['finish without option', (c: any) => (c.services[1].phases[0].finishMinutes = 40), /finishOption is not enabled/],
    ['free first phase', (c: any) => (c.services[1].phases[0].kind = 'free'), /first and last phase must be busy/],
    ['fixed start off grid', (c: any) => (c.services[5].fixedStarts = ['08:10']), /client slot grid/],
  ])('rejects %s', (_name, mutate, msg) => {
    const c = clone();
    mutate(c);
    expect(() => loadSalonConfig(c, '2026-10-27')).toThrow(msg);
  });

  it('rejects opening hours that hit a DST switch (e.g. Sunday 00:00–04:00)', () => {
    const c = clone();
    c.weeklyHours.sun = { open: '00:00', close: '04:00', breaks: [] };
    const parsed = SalonConfigSchema.parse(c);
    expect(findDstConflicts(parsed, '2026-01-01', 1).map((d) => d.date)).toEqual(['2026-03-29', '2026-10-25']);
    expect(() => loadSalonConfig(c, '2026-01-01')).toThrow(/DST/);
  });

  it('allows Sunday opening that avoids the switch hours', () => {
    const c = clone();
    c.weeklyHours.sun = { open: '10:00', close: '14:00', breaks: [] };
    expect(() => loadSalonConfig(c, '2026-01-01')).not.toThrow();
  });
});
