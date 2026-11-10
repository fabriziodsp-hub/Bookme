import { addDays, formatHm, parseHm, WEEKDAYS, type Block, type LocalDate, type Minute, type SalonConfig } from '@salon/engine';
import { useEffect, useRef } from 'react';
import { dateLong, dateShort, weekdayShort } from '../lib/format';
import { useT } from '../lib/i18n';
import type { DayAvailability } from '../lib/types';

const P = 3; // px per minute → a 15-minute slot is 45 px tall (≥ 44 px target)

export interface WeekCalendarProps {
  cfg: SalonConfig;
  weekStart: LocalDate;
  today: LocalDate;
  days: DayAvailability[] | undefined;
  loading: boolean;
  /** Blocks of the chosen service starting at 0 (for the selection preview); null = no service yet. */
  blocks: Block[] | null;
  selected: { date: LocalDate; start: Minute } | null;
  onSelect: (date: LocalDate, start: Minute) => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  onOpenMonth: () => void;
  view: 'calendar' | 'list';
  onView: (v: 'calendar' | 'list') => void;
}

/** Visible time range: earliest opening to latest closing of the week template. */
function range(cfg: SalonConfig) {
  const days = WEEKDAYS.map((d) => cfg.weeklyHours[d]).filter(Boolean) as { open: string; close: string }[];
  const open = Math.min(...days.map((d) => parseHm(d.open)));
  const close = Math.max(...days.map((d) => parseHm(d.close)));
  return { open: Math.floor(open / 60) * 60, close: Math.ceil(close / 60) * 60 };
}

export function WeekCalendar(p: WeekCalendarProps) {
  const t = useT();
  const { open, close } = range(p.cfg);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(p.weekStart, i));
  const byDate = new Map(p.days?.map((d) => [d.date, d]));

  // Scroll to the first free slot of the week (or opening time) when the week/service changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !p.days) return;
    const first = Math.min(...p.days.flatMap((d) => d.slots.map((s) => s.start)), Infinity);
    el.scrollTop = Number.isFinite(first) ? Math.max(0, (first - open) * P - 60) : 0;
  }, [p.days, open]);

  const header = (
    <div className="cal-head">
      <button type="button" className="btn" onClick={p.onPrev} disabled={!p.canPrev} aria-label={t('ui.prevWeek')}>‹</button>
      <button type="button" className="btn grow" onClick={p.onOpenMonth} aria-label={`${t('ui.openMonth')}: ${t('ui.weekLabel', { from: dateShort(dates[0]!), to: dateShort(dates[6]!) })}`}>
        <span aria-hidden="true">📅</span> {dateShort(dates[0]!)} – {dateShort(dates[6]!)}
      </button>
      <button type="button" className="btn" onClick={p.onNext} disabled={!p.canNext} aria-label={t('ui.nextWeek')}>›</button>
    </div>
  );
  const toggle = (
    <div className="seg view-toggle" role="group" aria-label="Darstellung">
      <button type="button" aria-pressed={p.view === 'calendar'} onClick={() => p.onView('calendar')}>{t('ui.viewCalendar')}</button>
      <button type="button" aria-pressed={p.view === 'list'} onClick={() => p.onView('list')}>{t('ui.viewList')}</button>
    </div>
  );

  if (p.view === 'list') {
    return (
      <div className="stack">
        {toggle}
        {header}
        {!p.blocks && <p className="muted">{t('ui.chooseService')}</p>}
        <div className="daylist" aria-busy={p.loading}>
          {dates.map((d) => {
            const day = byDate.get(d);
            return (
              <section key={d} aria-labelledby={`dl-${d}`}>
                <h3 id={`dl-${d}`}>{dateLong(d)}</h3>
                {!day?.open ? (
                  <p className="muted small">{t('ui.closed')}</p>
                ) : !day.slots.length ? (
                  <p className="muted small">{p.blocks ? t('ui.noSlotsDay') : ''}</p>
                ) : (
                  <div className="slots">
                    {day.slots.map((s) => (
                      <button
                        key={s.start}
                        type="button"
                        className="chip"
                        aria-pressed={p.selected?.date === d && p.selected.start === s.start}
                        onClick={() => p.onSelect(d, s.start)}
                        aria-label={t('ui.slotLabel', { day: dateLong(d), time: formatHm(s.start) })}
                      >
                        {formatHm(s.start)}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  const height = (close - open) * P;
  const hours = Array.from({ length: (close - open) / 60 }, (_, i) => open + i * 60);
  return (
    <div className="cal">
      {toggle}
      {header}
      <div className="cal-scroll" ref={scrollRef} aria-busy={p.loading} tabIndex={0} role="region" aria-label={t('ui.step.when')}>
        <div className="cal-grid">
          <div className="cal-dh" aria-hidden="true" />
          {dates.map((d) => (
            <div key={d} className={`cal-dh ${d === p.today ? 'today' : ''}`} aria-hidden="true">
              {weekdayShort(d)}
              <br />
              {dateShort(d)}
            </div>
          ))}
          <div className="cal-axis" style={{ height }} aria-hidden="true">
            {hours.map((h) => (
              <span key={h} style={{ top: (h - open) * P + (h === open ? 8 : 0) }}>{formatHm(h)}</span>
            ))}
          </div>
          {dates.map((d) => {
            const day = byDate.get(d);
            const col: React.ReactNode[] = [];
            if (day && !day.open) {
              col.push(<div key="closed" className="cal-off vertical" style={{ top: 0, bottom: 0 }}>{t('ui.closed')}</div>);
            } else if (day?.hours) {
              if (day.hours.open > open) col.push(<div key="pre" className="cal-off" style={{ top: 0, height: (day.hours.open - open) * P }} />);
              if (day.hours.close < close) {
                col.push(<div key="post" className="cal-off vertical" style={{ top: (day.hours.close - open) * P, bottom: 0 }}>{t('ui.closed')}</div>);
              }
              day.hours.breaks.forEach((b, i) =>
                col.push(<div key={`b${i}`} className="cal-off" style={{ top: (b.start - open) * P, height: (b.end - b.start) * P }}>{t('ui.break')}</div>),
              );
              day.busy.forEach((b, i) => col.push(<div key={`o${i}`} className="cal-busy" style={{ top: (b.start - open) * P, height: (b.end - b.start) * P }} aria-hidden="true" />));
              day.slots.forEach((s) =>
                col.push(
                  <button
                    key={`s${s.start}`}
                    type="button"
                    className="cal-slot"
                    style={{ top: (s.start - open) * P + 1, height: 15 * P - 2 }}
                    onClick={() => p.onSelect(d, s.start)}
                    aria-label={t('ui.slotLabel', { day: dateLong(d), time: formatHm(s.start) })}
                    aria-pressed={p.selected?.date === d && p.selected.start === s.start}
                  >
                    {formatHm(s.start)}
                  </button>,
                ),
              );
              if (p.blocks && p.selected?.date === d) {
                const off = p.selected.start - p.blocks[0]!.start;
                p.blocks.forEach((b, i) =>
                  col.push(
                    <div key={`sel${i}`} className={`cal-sel ${b.kind === 'free' ? 'free' : ''}`} style={{ top: (b.start + off - open) * P, height: (b.end - b.start) * P }} aria-hidden="true">
                      {i === 0 ? formatHm(p.selected!.start) : ''}
                    </div>,
                  ),
                );
              }
            }
            return (
              <div key={d} className="cal-col" role="group" aria-label={dateLong(d)} style={{ height, ['--hour' as string]: `${60 * P}px` }}>
                {col}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
