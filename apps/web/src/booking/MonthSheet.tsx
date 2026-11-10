import { addDays, parseLocalDate, startOfWeek, type LocalDate } from '@salon/engine';
import { de } from '@salon/i18n';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { Dialog } from '../components/Dialog';
import { dateLong } from '../lib/format';
import { useT } from '../lib/i18n';

export interface MonthSheetProps {
  today: LocalDate;
  /** Month offset relative to today's month allowed: [minOffset, maxOffset]. */
  minOffset: number;
  maxOffset: number;
  initial: LocalDate;
  selected: LocalDate | null;
  /** API path returning { dates } with free slots from a date (dots); null = no dots. */
  dotsPath: ((from: LocalDate) => string) | null;
  isSelectable: (d: LocalDate) => boolean;
  onPick: (d: LocalDate) => void;
  onToday: () => void;
  onNextFree?: (() => void) | undefined;
  onClose: () => void;
}

const firstOfMonth = (d: LocalDate) => `${d.slice(0, 7)}-01`;
function addMonths(d: LocalDate, n: number): LocalDate {
  const { year, month } = parseLocalDate(d);
  const m = year * 12 + (month - 1) + n;
  return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-01`;
}
function monthsBetween(a: LocalDate, b: LocalDate) {
  const x = parseLocalDate(a);
  const y = parseLocalDate(b);
  return (y.year - x.year) * 12 + (y.month - x.month);
}

/** Month panel: chips for the next 12 months, dots on days with free slots, Heute, Nächster freier Termin. */
export function MonthSheet(p: MonthSheetProps) {
  const t = useT();
  const base = firstOfMonth(p.today);
  const [offset, setOffset] = useState(() => Math.min(p.maxOffset, Math.max(p.minOffset, monthsBetween(base, p.initial))));
  const month = addMonths(base, offset);
  const { year, month: m } = parseLocalDate(month);
  const from = month < p.today ? p.today : month;
  const q = useQuery({
    queryKey: ['days', p.dotsPath?.(from)],
    queryFn: () => api<{ dates: LocalDate[] }>(p.dotsPath!(from)),
    enabled: !!p.dotsPath,
  });
  const dates = q.data ? new Set(q.data.dates) : undefined;
  const loading = q.isFetching;
  const gridStart = startOfWeek(month);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const titleId = 'month-title';
  return (
    <Dialog title={`${de.monthLong[m - 1]} ${year}`} onClose={p.onClose} labelledBy={titleId}>
      <div className="row" style={{ marginBottom: 8 }}>
        <button type="button" className="btn" onClick={() => setOffset(offset - 1)} disabled={offset <= p.minOffset} aria-label="Vorheriger Monat">‹</button>
        <h2 id={titleId} style={{ flex: 1, textAlign: 'center', margin: 0 }} aria-live="polite">
          {de.monthLong[m - 1]} {year}
        </h2>
        <button type="button" className="btn" onClick={() => setOffset(offset + 1)} disabled={offset >= p.maxOffset} aria-label="Nächster Monat">›</button>
      </div>
      <div className="months" role="group" aria-label="Monat wählen">
        {Array.from({ length: p.maxOffset - p.minOffset + 1 }, (_, i) => p.minOffset + i).map((o) => {
          const mm = addMonths(base, o);
          const pm = parseLocalDate(mm);
          return (
            <button key={o} type="button" className="chip" aria-pressed={o === offset} onClick={() => setOffset(o)}>
              {de.monthShort[pm.month - 1]}
              {pm.month === 1 || o === p.minOffset ? ` ${String(pm.year).slice(2)}` : ''}
            </button>
          );
        })}
      </div>
      <div className="mgrid" aria-busy={loading}>
        {de.weekdayShort.map((w) => (
          <span key={w} className="wd" aria-hidden="true">{w}</span>
        ))}
        {cells.map((d) => {
          const inMonth = d.slice(0, 7) === month.slice(0, 7);
          if (!inMonth) return <span key={d} aria-hidden="true" />;
          const has = dates?.has(d) ?? false;
          const ok = p.isSelectable(d) && (dates ? has : true);
          return (
            <button
              key={d}
              type="button"
              className={`mday ${d === p.today ? 'today' : ''} ${d === p.selected ? 'sel' : ''}`}
              disabled={!ok}
              onClick={() => p.onPick(d)}
              aria-label={`${dateLong(d)}${has ? ', freie Termine' : ''}`}
              aria-current={d === p.today ? 'date' : undefined}
            >
              {parseLocalDate(d).day}
              {has && <i className="dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={p.onToday}>{t('ui.today')}</button>
        {p.onNextFree && <button type="button" className="btn primary" onClick={p.onNextFree}>{t('ui.nextFree')}</button>}
        <span className="spacer" />
        <button type="button" className="btn" onClick={p.onClose}>{t('ui.close')}</button>
      </div>
    </Dialog>
  );
}
