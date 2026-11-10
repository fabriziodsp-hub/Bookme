import { formatHm, parseLocalDate, weekdayOf, WEEKDAYS, type LocalDate } from '@salon/engine';
import { de } from '@salon/i18n';

export const hm = formatHm;

/** "Di., 3. November 2026" – dates in words everywhere (research pain point). */
export function dateLong(date: LocalDate): string {
  const { year, month, day } = parseLocalDate(date);
  const wd = WEEKDAYS.indexOf(weekdayOf(date));
  return `${de.weekdayShort[wd]}., ${day}. ${de.monthLong[month - 1]} ${year}`;
}
export function dateShort(date: LocalDate): string {
  const { month, day } = parseLocalDate(date);
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.`;
}
export function weekdayShort(date: LocalDate): string {
  return de.weekdayShort[WEEKDAYS.indexOf(weekdayOf(date))]!;
}
export function weekdayLong(date: LocalDate): string {
  return de.weekdayLong[WEEKDAYS.indexOf(weekdayOf(date))]!;
}
export const euro = (cents: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

export function priceText(p: { cents: number; isFrom: boolean } | null | undefined): string | null {
  return p ? `${p.isFrom ? 'ab ' : ''}${euro(p.cents)}` : null;
}

/** Readable phone number for display (links keep the raw value): +4915123456789 → +49 1512 3456789 (example). */
export function formatPhone(p: string): string {
  const m = /^\+(\d{2})(\d{3,4})(\d+)$/.exec(p.replace(/[\s/-]/g, ''));
  return m ? `+${m[1]} ${m[2]} ${m[3]}` : p;
}
