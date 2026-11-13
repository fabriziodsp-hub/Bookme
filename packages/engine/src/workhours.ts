/**
 * Personal working hours (D-071): a person may work less than the salon is open. The time outside
 * their hours on an open day is "off duty" and treated like an absence – not bookable, also not by staff.
 * Pure functions; the API stores the hours per person (NULL = salon hours).
 */
import { hoursOn } from './rules.js';
import type { SalonConfig } from './config.js';
import { parseHm, WEEKDAYS, weekdayOf, type Interval, type LocalDate, type Weekday } from './time.js';

export interface WorkDay {
  open: string;
  close: string;
  breaks: [string, string][];
}

/** Per weekday: hours, `null` = day off, missing = like the salon. */
export type WorkHours = Partial<Record<Weekday, WorkDay | null>>;

/** Off-duty intervals of one person on one day (empty when they work the salon hours). */
export function offDuty(cfg: SalonConfig, date: LocalDate, work: WorkHours | null | undefined): Interval[] {
  const salon = hoursOn(cfg, date);
  if (!salon || !work) return [];
  const day = weekdayOf(date);
  if (!(day in work)) return [];
  const w = work[day];
  if (w === null) return [{ start: salon.open, end: salon.close }];
  if (!w) return [];
  const open = parseHm(w.open);
  const close = parseHm(w.close);
  const out: Interval[] = [];
  if (open > salon.open) out.push({ start: salon.open, end: open });
  if (close < salon.close) out.push({ start: close, end: salon.close });
  for (const [s, e] of w.breaks) out.push({ start: parseHm(s), end: parseHm(e) });
  return out;
}

/** Problems of a working-hours plan against the salon's opening hours (German messages for the owner). */
export function workHoursProblems(cfg: SalonConfig, work: WorkHours): string[] {
  const names: Record<Weekday, string> = { mon: 'Montag', tue: 'Dienstag', wed: 'Mittwoch', thu: 'Donnerstag', fri: 'Freitag', sat: 'Samstag', sun: 'Sonntag' };
  const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const out: string[] = [];
  for (const day of WEEKDAYS) {
    if (!(day in work)) continue;
    const w = work[day];
    if (w === null || w === undefined) continue;
    const salon = cfg.weeklyHours[day];
    if (!salon) {
      out.push(`${names[day]}: Der Salon ist geschlossen.`);
      continue;
    }
    if (!hm.test(w.open) || !hm.test(w.close) || w.breaks.some(([s, e]) => !hm.test(s) || !hm.test(e))) {
      out.push(`${names[day]}: Uhrzeit ungültig.`);
      continue;
    }
    const [o, c, so, sc] = [parseHm(w.open), parseHm(w.close), parseHm(salon.open), parseHm(salon.close)];
    if (o >= c) out.push(`${names[day]}: Beginn muss vor dem Ende liegen.`);
    if (o < so || c > sc) out.push(`${names[day]}: nur innerhalb der Öffnungszeiten (${salon.open}–${salon.close}).`);
    if (w.breaks.some(([s, e]) => parseHm(s) >= parseHm(e) || parseHm(s) < o || parseHm(e) > c)) out.push(`${names[day]}: Pause außerhalb der Arbeitszeit.`);
  }
  return out;
}
