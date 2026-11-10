import { describe, expect, it } from 'vitest';
import { birthdayDiscountEligible, canChangeOnline, feeAmountCents, feeDue, findService, requestExpiresAt, rescheduleNeedsReconfirmation, selfServiceCutoffHours } from '../src/index.js';
import { cfg } from './fixture.js';

const balayage = findService(cfg, 'balayage')!;
const cut = findService(cfg, 'cut')!;
const start = new Date('2026-11-10T07:00:00Z');
const h = (n: number) => new Date(start.getTime() - n * 3_600_000);

describe('BR-09 self-service cut-off', () => {
  it('12 h by default, 48 h for Balayage', () => {
    expect(selfServiceCutoffHours(cfg, cut)).toBe(12);
    expect(selfServiceCutoffHours(cfg, balayage)).toBe(48);
    expect(canChangeOnline(cfg, cut, start, h(13))).toBe(true);
    expect(canChangeOnline(cfg, cut, start, h(11))).toBe(false);
    expect(canChangeOnline(cfg, balayage, start, h(49))).toBe(true);
    expect(canChangeOnline(cfg, balayage, start, h(47))).toBe(false);
  });
});

describe('BR-10 Balayage fee from typical damage (no-show or cancellation < 48 h, consent required)', () => {
  it('amount = 4 h × 13,90 € × 1,23 + 15 % of the price, rounded up to full euro', () => {
    // 5 560 × 1.23 = 6 838.8 ct; + 15 % of 190 € = 2 850 ct → 9 688.8 → 97 €
    expect(feeAmountCents(balayage.feeRule!, 19_000)).toBe(9_700);
    // 10 % → 8 738.8 → 88 €; 20 % → 10 638.8 → 107 €
    const f = balayage.feeRule!.formula!;
    expect(feeAmountCents({ ...balayage.feeRule!, formula: { ...f, revenuePercent: 10 } }, 19_000)).toBe(8_800);
    expect(feeAmountCents({ ...balayage.feeRule!, formula: { ...f, revenuePercent: 20 } }, 19_000)).toBe(10_700);
    // no price in the list → labour only
    expect(feeAmountCents(balayage.feeRule!, null)).toBe(6_900);
  });
  it('fixed amount still supported', () => expect(feeAmountCents({ lateCancelHours: 48, amountCents: 15_000 }, 19_000)).toBe(15_000));
  it('no-show with consent → due', () => expect(feeDue(balayage, true, start, null)).toBe(true));
  it('late cancellation → due; early → not due', () => {
    expect(feeDue(balayage, true, start, h(47))).toBe(true);
    expect(feeDue(balayage, true, start, h(49))).toBe(false);
  });
  it('never without consent or for services without rule', () => {
    expect(feeDue(balayage, false, start, null)).toBe(false);
    expect(feeDue(cut, true, start, null)).toBe(false);
  });
});

describe('BR-13 client reschedule needs re-confirmation only from 60 minutes (A-16)', () => {
  it('threshold', () => {
    expect(rescheduleNeedsReconfirmation(cfg, 30)).toBe(false);
    expect(rescheduleNeedsReconfirmation(cfg, 59)).toBe(false);
    expect(rescheduleNeedsReconfirmation(cfg, 60)).toBe(true);
    expect(rescheduleNeedsReconfirmation({ ...cfg, rescheduleReconfirmMinMinutes: 0 }, 30)).toBe(true);
  });
});

describe('BR-11 request expiry', () => {
  it('48 h after the request, at the latest at the start', () => {
    const created = new Date('2026-11-01T10:00:00Z');
    expect(requestExpiresAt(cfg, created, start).toISOString()).toBe('2026-11-03T10:00:00.000Z');
    expect(requestExpiresAt(cfg, new Date('2026-11-09T10:00:00Z'), start)).toEqual(start);
  });
});

describe('BR-12 birthday discount', () => {
  it('only in the birth month, once per year, only with opt-in', () => {
    expect(cfg.birthdayDiscount).toEqual({ enabled: true, percent: 10 });
    expect(birthdayDiscountEligible(cfg, 11, '2026-11-20', [])).toBe(true);
    expect(birthdayDiscountEligible(cfg, 11, '2026-12-01', [])).toBe(false);
    expect(birthdayDiscountEligible(cfg, 11, '2026-11-20', [2026])).toBe(false);
    expect(birthdayDiscountEligible(cfg, 11, '2027-11-02', [2026])).toBe(true);
    expect(birthdayDiscountEligible(cfg, null, '2026-11-20', [])).toBe(false);
    expect(birthdayDiscountEligible({ ...cfg, birthdayDiscount: { enabled: false, percent: 10 } }, 11, '2026-11-20', [])).toBe(false);
  });
});
