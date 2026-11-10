import { formatHm, parseLocalDate, type LocalDate, type Minute } from '@salon/engine';

const WEEKDAY = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
const MONTH = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** "Di., 3. November 2026" – written in words so it cannot be misread (research pain point). */
export function dateInWords(date: LocalDate): string {
  const { year, month, day } = parseLocalDate(date);
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAY[wd]}, ${day}. ${MONTH[month - 1]} ${year}`;
}

/** "Di., 3. November 2026, 09:15 Uhr" */
export function dateTimeInWords(date: LocalDate, minute: Minute): string {
  return `${dateInWords(date)}, ${formatHm(minute)} Uhr`;
}
