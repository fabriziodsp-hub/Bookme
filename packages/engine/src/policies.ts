/** Time-based business policies (pure functions over instants). */
import type { SalonConfig, Service } from './config.js';
import { parseLocalDate, type LocalDate } from './time.js';

const HOUR = 3_600_000;

/** Hours before start after which clients can no longer change online. */
export function selfServiceCutoffHours(cfg: SalonConfig, service: Service | undefined): number {
  return Math.max(cfg.selfServiceCutoffHours, service?.feeRule?.lateCancelHours ?? 0);
}

export function canChangeOnline(cfg: SalonConfig, service: Service | undefined, startAt: Date, now: Date): boolean {
  return now.getTime() < startAt.getTime() - selfServiceCutoffHours(cfg, service) * HOUR;
}

/** When an unanswered request expires: N hours after it was sent, but never after its start. */
export function requestExpiresAt(cfg: SalonConfig, createdAt: Date, startAt: Date): Date {
  return new Date(Math.min(createdAt.getTime() + cfg.requestExpiryHours * HOUR, startAt.getTime()));
}

/**
 * Is the fee due for a cancellation at `cancelledAt` (null = no-show)?
 * Only when the service has a fee rule AND the client consented at booking.
 */
export function feeDue(service: Service | undefined, consented: boolean, startAt: Date, cancelledAt: Date | null): boolean {
  if (!service?.feeRule || !consented) return false;
  if (cancelledAt === null) return true;
  return cancelledAt.getTime() > startAt.getTime() - service.feeRule.lateCancelHours * HOUR;
}

/**
 * Fee amount for a service with a fee rule. With a formula (D-020):
 *   laborHours × hourlyWage × (1 + employerShare) + price × revenuePercent, rounded up.
 * `priceCents` = the salon's price for the selection (null when the price list has none → labour only).
 */
export function feeAmountCents(rule: NonNullable<Service['feeRule']>, priceCents: number | null): number {
  if (rule.amountCents !== undefined) return rule.amountCents;
  const f = rule.formula!;
  const labor = f.laborHours * f.hourlyWageCents * (1 + f.employerSharePercent / 100);
  const lost = ((priceCents ?? 0) * f.revenuePercent) / 100;
  const step = f.roundUpToCents;
  // round to 1/1000 cent first so binary floating point never adds a whole step
  return Math.ceil(Math.round((labor + lost) * 1000) / 1000 / step) * step;
}

/** Does a client reschedule of an appointment with this duration need a new confirmation (A-16)? */
export function rescheduleNeedsReconfirmation(cfg: SalonConfig, totalMinutes: number): boolean {
  return totalMinutes >= cfg.rescheduleReconfirmMinMinutes;
}

/**
 * Birthday discount eligibility for an appointment on `date`:
 * enabled, client opted in with a birth month, appointment in that month, not yet redeemed that year
 * (or redeemed by this very appointment).
 */
export function birthdayDiscountEligible(
  cfg: SalonConfig,
  birthMonth: number | null,
  date: LocalDate,
  redeemedYears: readonly number[],
): boolean {
  if (!cfg.birthdayDiscount.enabled || birthMonth === null) return false;
  const { year, month } = parseLocalDate(date);
  return month === birthMonth && !redeemedYears.includes(year);
}
