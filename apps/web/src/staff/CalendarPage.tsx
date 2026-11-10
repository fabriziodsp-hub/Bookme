/**
 * Staff calendar (S-1 … S-4, D-031):
 * - "Mein Tag" (own clients; day or week) and "Team" (one column per stylist, day)
 * - drag & drop with pointer events: move (also to another day/stylist), resize each phase; 5′ snap,
 *   live preview validated by the same engine as the server, red when invalid
 * - full keyboard/panel alternative, undo/redo of the session's changes
 */
import {
  addDays,
  checkPlacement,
  findService,
  formatHm,
  parseHm,
  resizePhase,
  shiftBlocks,
  snap,
  startOfWeek,
  WEEKDAYS,
  type Block,
  type DayOccupancy,
  type Interval,
  type LocalDate,
} from '@salon/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MonthSheet } from '../booking/MonthSheet';
import { api, ApiError, errorMessage } from '../lib/api';
import { dateLong, dateShort, weekdayLong, weekdayShort } from '../lib/format';
import { useT } from '../lib/i18n';
import { useLabels } from '../lib/labels';
import { useLiveNow, useSalon } from '../lib/salon';
import type { Absence, Appointment, StaffUser } from '../lib/types';
import { AbsenceDialog } from './AbsenceDialog';
import { AppointmentPanel } from './AppointmentPanel';
import { useCalendar, useInvalidateCalendar, type CalendarData } from './hooks';
import { NewAppointmentDialog } from './NewAppointmentDialog';

const PX = 1.8; // px per minute: 5′ = 9 px, 15′ = 27 px, 60′ = 108 px
const ACTIVE = new Set(['requested', 'discuss', 'confirmed', 'completed', 'no_show']);

interface Column {
  key: string;
  date: LocalDate;
  stylistId: string;
  title: string;
  sub: string;
  color?: string;
  isToday: boolean;
}

interface Drag {
  id: string;
  mode: 'move' | 'resize';
  phase: number;
  x0: number;
  y0: number;
  dm: number;
  col: Column;
  dropDay: LocalDate | null;
  blocks: Block[] | null;
  valid: boolean;
  reason: string;
}

export interface UndoItem {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

export function CalendarPage({ me }: { me: StaffUser }) {
  const t = useT();
  const L = useLabels();
  const salon = useSalon();
  const cfg = salon.config;
  const now = useLiveNow(); // keeps running: moves the "now" line
  const today = now.date;
  const invalidate = useInvalidateCalendar();
  const [mode, setMode] = useState<'mine' | 'team'>(me.role === 'owner' || !me.stylistId ? 'team' : 'mine');
  const [range, setRange] = useState<'day' | 'week'>('day');
  // Deep link: /team?date=2026-11-19 (used by e-mails and tests).
  const [date, setDate] = useState<LocalDate>(() => new URLSearchParams(location.search).get('date')?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? today);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [status, setStatus] = useState('');
  // the toast fades out on its own; the next message replaces it
  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(''), 6000);
    return () => clearTimeout(id);
  }, [status]);
  const [undoStack, setUndo] = useState<UndoItem[]>([]);
  const [redoStack, setRedo] = useState<UndoItem[]>([]);
  const [dialog, setDialog] = useState<null | 'new' | 'absence' | 'month'>(null);
  const [absenceSel, setAbsenceSel] = useState<Absence | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const weekStart = startOfWeek(date);
  const mineId = mode === 'mine' ? (me.stylistId ?? undefined) : undefined;
  const cal = useCalendar(weekStart, 7, mineId);
  const data: CalendarData | undefined = cal.data;
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Visible hours: template min open .. max close.
  const { open, close } = useMemo(() => {
    const ds = WEEKDAYS.map((d) => cfg.weeklyHours[d]).filter(Boolean) as { open: string; close: string }[];
    return { open: Math.min(...ds.map((d) => parseHm(d.open))), close: Math.max(...ds.map((d) => parseHm(d.close))) };
  }, [cfg]);

  const columns: Column[] = useMemo(() => {
    const stylists = data?.stylists ?? [];
    if (mode === 'team') {
      return stylists.map((s) => ({ key: s.id, date, stylistId: s.id, title: s.displayName, sub: '', color: s.color, isToday: date === today }));
    }
    const sid = me.stylistId ?? stylists[0]?.id ?? '';
    const days = range === 'week' ? week : [date];
    return days.map((d) => ({ key: d, date: d, stylistId: sid, title: range === 'week' ? `${weekdayShort(d)} ${dateShort(d)}` : weekdayLong(d), sub: range === 'week' ? '' : dateLong(d), isToday: d === today }));
  }, [mode, range, date, data?.stylists, me.stylistId, today, week.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const appts = useMemo(() => (data?.appointments ?? []).filter((a) => ACTIVE.has(a.status)), [data]);
  const byId = useMemo(() => new Map(appts.map((a) => [a.id, a])), [appts]);
  const sel = selected ? byId.get(selected) ?? null : null;

  // Absences → local intervals for a given date (clamped to the day).
  const absenceIntervals = useCallback(
    (stylistId: string, d: LocalDate): (Interval & { a: Absence })[] =>
      (data?.absences ?? [])
        .filter((a) => a.stylistId === stylistId && a.from.date <= d && a.to.date >= d)
        .map((a) => ({ start: a.from.date < d ? 0 : a.from.minute, end: a.to.date > d ? 1440 : a.to.minute, a })),
    [data],
  );

  const occupancy = useCallback(
    (stylistId: string, d: LocalDate, exceptId: string): DayOccupancy => ({
      busy: appts.filter((a) => a.id !== exceptId && a.stylistId === stylistId && a.date === d).flatMap((a) => a.blocks.filter((b) => b.kind === 'busy')),
      absences: absenceIntervals(stylistId, d),
    }),
    [appts, absenceIntervals],
  );

  const validate = useCallback(
    (a: Appointment, blocks: Block[], d: LocalDate, stylistId: string) => {
      const v = checkPlacement({ config: cfg, date: d, blocks, occupancy: occupancy(stylistId, d, a.id), mode: 'staff', service: findService(cfg, a.serviceId) });
      const reason: Record<string, string> = {
        IN_BREAK: 'in der Pause', OUTSIDE_HOURS: 'außerhalb der Öffnungszeiten', CLOSED: 'geschlossen',
        OVERLAPS_BUSY: 'Zeit belegt', IN_ABSENCE: 'Abwesenheit', PHASE_TOO_SHORT: 'Phase zu kurz', OFF_GRID: 'nicht im 5-Min.-Raster',
      };
      return { ok: v.length === 0, reason: [...new Set(v.map((x) => reason[x.code] ?? x.code))].join(', ') };
    },
    [cfg, occupancy],
  );

  // ---------- server updates + undo ----------
  // Always read the current version from the server: the cached list may lag behind a just-saved change.
  const latest = useCallback(async (id: string) => (await api<{ appointment: Appointment }>(`/staff/appointments/${id}`)).appointment, []);

  const patchBlocks = useCallback(
    async (id: string, target: { date: LocalDate; blocks: Block[]; stylistId: string }) => {
      const cur = await latest(id);
      return api<Appointment>(`/staff/appointments/${id}/blocks`, {
        method: 'PATCH',
        body: { version: cur.version, date: target.date, blocks: target.blocks, stylistId: target.stylistId },
      });
    },
    [latest],
  );

  const pushUndo = (item: UndoItem) => {
    setUndo((s) => [...s.slice(-29), item]);
    setRedo([]);
  };

  const applyChange = useCallback(
    async (a: Appointment, target: { date: LocalDate; blocks: Block[]; stylistId: string }, label: string) => {
      const before = { date: a.date, blocks: a.blocks, stylistId: a.stylistId };
      try {
        await patchBlocks(a.id, target);
        pushUndo({ label, undo: async () => void (await patchBlocks(a.id, before)), redo: async () => void (await patchBlocks(a.id, target)) });
        setStatus(t('staff.moved', { when: `${dateShort(target.date)} ${formatHm(target.blocks[0]!.start)}–${formatHm(target.blocks.at(-1)!.end)}` }));
      } catch (e) {
        setStatus(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? t('staff.conflictReload') : errorMessage(e));
      } finally {
        invalidate();
      }
    },
    [patchBlocks, invalidate, t],
  );

  const runUndo = async (which: 'undo' | 'redo') => {
    const stack = which === 'undo' ? undoStack : redoStack;
    const item = stack.at(-1);
    if (!item) return;
    try {
      await item[which]();
      if (which === 'undo') (setUndo((s) => s.slice(0, -1)), setRedo((s) => [...s, item]));
      else (setRedo((s) => s.slice(0, -1)), setUndo((s) => [...s, item]));
      setStatus(`${t(which === 'undo' ? 'staff.undo' : 'staff.redo')}: ${item.label}`);
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      invalidate();
    }
  };

  // ---------- pointer drag & drop ----------
  const startDrag = (e: React.PointerEvent, a: Appointment, col: Column, dragMode: 'move' | 'resize', phase: number) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const d: Drag = { id: a.id, mode: dragMode, phase, x0: e.clientX, y0: e.clientY, dm: 0, col, dropDay: null, blocks: null, valid: true, reason: '' };
    dragRef.current = d;
    setDrag(d); // no selection here: opening the panel would shift the layout under the pointer
  };

  useEffect(() => {
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const a = byId.get(d.id);
        if (!a) return;
        const dm = snap((e.clientY - d.y0) / PX, cfg.staffStepMinutes);
        let col = d.col;
        let dropDay: LocalDate | null = null;
        if (d.mode === 'move') {
          const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
          const c = el?.closest<HTMLElement>('[data-col]')?.dataset.col;
          const day = el?.closest<HTMLElement>('[data-day]')?.dataset.day;
          if (c) col = columns.find((x) => x.key === c) ?? col;
          if (day && day !== a.date) dropDay = day;
        }
        const blocks = d.mode === 'move' ? shiftBlocks(a.blocks, dropDay ? 0 : dm) : resizePhase(a.blocks, d.phase, dm, cfg.minPhaseMinutes);
        const targetDate = dropDay ?? col.date;
        const v = blocks ? (dropDay ? { ok: true, reason: '' } : validate(a, blocks, targetDate, col.stylistId)) : { ok: false, reason: 'Phase zu kurz' };
        const next = { ...d, dm, col, dropDay, blocks, valid: v.ok, reason: v.reason };
        dragRef.current = next;
        setDrag(next);
        if (blocks) setStatus(`${formatHm(blocks[0]!.start)}–${formatHm(blocks.at(-1)!.end)} Uhr${dropDay ? ` · ${dateLong(dropDay)}` : ''}${v.ok ? '' : ` · ${t('staff.invalid')}: ${v.reason}`}`);
      });
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      const a = byId.get(d.id);
      if (!a || !d.blocks) return;
      const targetDate = d.dropDay ?? d.col.date;
      const changed = d.dropDay || d.dm !== 0 || d.col.stylistId !== a.stylistId || d.col.date !== a.date;
      if (!changed) return;
      if (!d.valid) {
        setStatus(`${t('staff.invalid')}: ${d.reason}`);
        return;
      }
      void applyChange(a, { date: targetDate, blocks: d.blocks, stylistId: d.col.stylistId }, d.mode === 'move' ? 'Verschieben' : 'Dauer ändern');
    };
    const onCancel = () => {
      dragRef.current = null;
      setDrag(null);
    };
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      cancelAnimationFrame(raf);
    };
  }, [byId, columns, cfg, validate, applyChange, t]);

  // Keyboard: ↑/↓ ±5′, Shift ±15′, Enter opens the panel.
  const onBlockKey = (e: React.KeyboardEvent, a: Appointment) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = (e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? 15 : 5);
      const blocks = shiftBlocks(a.blocks, delta);
      const v = validate(a, blocks, a.date, a.stylistId);
      if (!v.ok) return setStatus(`${t('staff.invalid')}: ${v.reason}`);
      void applyChange(a, { date: a.date, blocks, stylistId: a.stylistId }, 'Verschieben');
    }
  };

  // Open at the opening hour; today → "now" in the upper third. "Heute" (jump) centres the now line.
  const [jump, setJump] = useState(0);
  const nowRef = useRef(now.minute);
  nowRef.current = now.minute;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (date !== today) {
      el.scrollTop = 0;
      return;
    }
    const y = (Math.min(Math.max(nowRef.current, open), close) - open) * PX;
    const top = jump ? y - el.clientHeight / 2 + 30 : y - 60 * PX;
    const calm = document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: Math.max(0, top), behavior: jump && !calm ? 'smooth' : 'auto' });
  }, [date, today, open, close, mode, range, jump]);
  const goToday = () => {
    setDate(today);
    setJump((n) => n + 1);
  };

  // ---------- navigation ----------
  const dayHours = (d: LocalDate) => {
    const h = cfg.weeklyHours[(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]!];
    return h ? { open: parseHm(h.open), close: parseHm(h.close), breaks: h.breaks.map(([s, e]) => ({ start: parseHm(s), end: parseHm(e) })) } : null;
  };

  const nextOpen = (d: LocalDate, dir: 1 | -1) => {
    let x = addDays(d, dir);
    for (let i = 0; i < 7 && !dayHours(x); i++) x = addDays(x, dir);
    return x;
  };

  const height = (close - open) * PX;
  const showNow = columns.some((c) => c.date === today) && now.minute >= open && now.minute <= close;
  const hours = Array.from({ length: Math.ceil((close - open) / 60) }, (_, i) => open + i * 60);
  const colMin = mode === 'team' ? 150 : range === 'week' ? 110 : 220;
  const gridCols = `48px repeat(${columns.length}, minmax(${colMin}px, 1fr))`;

  const renderAppt = (a: Appointment, col: Column) => {
    const isDragged = drag?.id === a.id;
    const name = `${a.customer.firstName} ${a.customer.lastName}`;
    const statusCls = a.status === 'requested' || a.status === 'discuss' ? 'req' : a.status === 'completed' ? 'done' : a.status === 'no_show' ? 'noshow' : '';
    return a.blocks.map((b, i) => (
      <div
        key={`${a.id}-${i}`}
        className={`blk ${i === 0 ? 'first' : i === a.blocks.length - 1 ? 'last' : 'mid'} ${i === 0 && a.blocks.length > 1 ? 'has-next' : ''} ${b.kind === 'free' ? 'free' : ''} ${statusCls} ${selected === a.id ? 'sel' : ''} ${isDragged ? 'dim' : ''}`}
        style={{ top: (b.start - open) * PX, height: Math.max(14, (b.end - b.start) * PX) }}
        tabIndex={0}
        role="button"
        aria-pressed={selected === a.id}
        data-appt={a.id}
        onClick={() => setSelected(a.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), setSelected(a.id));
          else onBlockKey(e, a);
        }}
      >
        {i === 0 && (
          <>
            <span className="t">
              {(a.status === 'requested' || a.status === 'discuss') && <span className="tag">{a.status === 'discuss' ? t('staff.discuss') : t('staff.request')}</span>}
              {name}
            </span>
            <span className="tm">{formatHm(a.start)}–{formatHm(a.end)}</span>{' '}
          </>
        )}
        <span>
          {L.phase(b.phase, a.serviceId)} ({b.end - b.start}′){i === a.blocks.length - 1 ? ` · ${t('staff.end', { time: formatHm(a.end) })}` : ''}
        </span>
        <span className="sr-only">
          {i > 0 ? `, ${name}` : ''}, {a.serviceLabel}, {formatHm(b.start)} bis {formatHm(b.end)}
        </span>
        {a.status !== 'completed' && a.status !== 'no_show' && (
          <>
            <span className="grip" aria-hidden="true" title="Ziehen zum Verschieben" onPointerDown={(e) => startDrag(e, a, col, 'move', i)} onClick={(e) => e.stopPropagation()}>⠿</span>
            <span className="rz" aria-hidden="true" title="Ziehen für die Dauer" onPointerDown={(e) => startDrag(e, a, col, 'resize', i)} onClick={(e) => e.stopPropagation()} />
          </>
        )}
      </div>
    ));
  };

  return (
    <main id="main" className={`wrap-wide staff ${sel ? 'with-panel' : ''}`}>
      <h1 className="sr-only">{t('staff.nav.calendar')}</h1>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Ansicht">
          <button type="button" aria-pressed={mode === 'mine'} disabled={!me.stylistId} onClick={() => setMode('mine')}>{t('staff.myDay')}</button>
          <button type="button" aria-pressed={mode === 'team'} onClick={() => (setMode('team'), setRange('day'))}>{t('staff.team')}</button>
        </div>
        {mode === 'mine' && (
          <div className="seg" role="group" aria-label="Zeitraum">
            <button type="button" aria-pressed={range === 'day'} onClick={() => setRange('day')}>{t('staff.day')}</button>
            <button type="button" aria-pressed={range === 'week'} onClick={() => setRange('week')}>{t('staff.week')}</button>
          </div>
        )}
        <span className="spacer" />
        <button type="button" className="btn" disabled={!undoStack.length} onClick={() => runUndo('undo')} aria-label={`${t('staff.undo')}${undoStack.at(-1) ? `: ${undoStack.at(-1)!.label}` : ''}`}>↶ <span className="hide-s">{t('staff.undo')}</span></button>
        <button type="button" className="btn" disabled={!redoStack.length} onClick={() => runUndo('redo')} aria-label={t('staff.redo')}>↷ <span className="hide-s">{t('staff.redo')}</span></button>
        <button type="button" className="btn" onClick={() => setDialog('absence')}>{t('staff.newAbsence')}</button>
        <details className="help">
          <summary className="btn ghost">Hilfe</summary>
          <p className="muted">{t('staff.help')}</p>
        </details>
        <button type="button" className="btn primary fab-m" onClick={() => setDialog('new')}>+ {t('staff.newAppointment')}</button>
      </div>

      <div className="toolbar" role="group" aria-label="Navigation">
        <button type="button" className="btn hide-m" aria-label={t('staff.prevWeek')} onClick={() => setDate(addDays(date, -7))}>«</button>
        <button type="button" className="btn" aria-label={t('staff.prevDay')} onClick={() => setDate(nextOpen(date, -1))}>‹</button>
        <button type="button" className="btn" onClick={goToday}>{t('ui.today')}</button>
        <button type="button" className="btn" aria-label={t('staff.nextDay')} onClick={() => setDate(nextOpen(date, 1))}>›</button>
        <button type="button" className="btn hide-m" aria-label={t('staff.nextWeek')} onClick={() => setDate(addDays(date, 7))}>»</button>
        <button type="button" className="btn date" onClick={() => setDialog('month')}><span aria-hidden="true">📅 </span><span className="sr-only">{t('staff.pickDate')}: </span><span className="hide-s">{dateLong(date)}</span><span className="show-s">{dateShort(date)}<span className="sr-only"> ({dateLong(date)})</span></span></button>
      </div>

      <div className="strip" role="group" aria-label="Woche">
        {week.map((d) => {
          const n = (data?.appointments ?? []).filter((a) => a.date === d && ACTIVE.has(a.status) && (mode === 'team' || a.stylistId === mineId)).length;
          const openDay = !!dayHours(d);
          return (
            <button
              key={d}
              type="button"
              data-day={d}
              className={drag?.dropDay === d ? 'drop' : ''}
              aria-current={d === date ? 'date' : undefined}
              disabled={!openDay}
              onClick={() => setDate(d)}
            >
              {weekdayShort(d)}
              <br />
              <b>{Number(d.slice(8))}</b>
              <br />
              {openDay ? n : '–'}
              <span className="sr-only"> Termine, {dateLong(d)}</span>
            </button>
          );
        })}
      </div>

      <p className="toast" role="status" aria-live="polite">{status}</p>

      <div className="tg-wrap" ref={wrapRef} tabIndex={0} role="region" aria-label={`${t('staff.nav.calendar')} ${dateLong(date)}`}>
        <div className="tg" style={{ gridTemplateColumns: gridCols }}>
          <div className="tg-head corner" aria-hidden="true" />
          {columns.map((c) => (
            <div key={`h-${c.key}`} className={`tg-head ${c.isToday ? 'today' : ''}`}>
              {mode === 'team' && <span className="avatar" style={{ background: c.color }} aria-hidden="true">{initials(c.title)}</span>}
              <span>
                <span className="name">{c.title}</span>
                {c.sub && <><br /><span className="sub">{c.sub}</span></>}
              </span>
            </div>
          ))}
          <div className="tg-axis" style={{ height, position: 'sticky' }} aria-hidden="true">
            {hours.map((h) => (
              <span key={h} style={{ top: (h - open) * PX + (h === open ? 8 : 0) }}>{formatHm(h)}</span>
            ))}
            {showNow && <b className="tg-now-time" style={{ top: (now.minute - open) * PX }}>{formatHm(now.minute)}</b>}
          </div>
          {columns.map((c) => {
            const h = dayHours(c.date);
            const list = appts.filter((a) => a.stylistId === c.stylistId && a.date === c.date);
            const ghost = drag && drag.blocks && !drag.dropDay && drag.col.key === c.key ? drag : null;
            return (
              <div
                key={c.key}
                className={`tg-col ${drag?.col.key === c.key && drag.mode === 'move' && !drag.dropDay ? 'drop-target' : ''}`}
                data-col={c.key}
                style={{ height, ['--h60' as string]: `${60 * PX}px`, ['--h15' as string]: `${15 * PX}px`, ['--h5' as string]: `${5 * PX}px` }}
              >
                {!h ? (
                  <div className="tg-off" style={{ top: 0, bottom: 0 }}>{t('ui.closed')}</div>
                ) : (
                  <>
                    {h.open > open && <div className="tg-off" style={{ top: 0, height: (h.open - open) * PX }} />}
                    {h.close < close && <div className="tg-off" style={{ top: (h.close - open) * PX, bottom: 0 }}>{t('ui.closed')}</div>}
                    {h.breaks.map((b, i) => (
                      <div key={i} className="tg-off" style={{ top: (b.start - open) * PX, height: (b.end - b.start) * PX }}>{t('ui.break')}</div>
                    ))}
                  </>
                )}
                {absenceIntervals(c.stylistId, c.date).map((ab) => (
                  <button key={ab.a.id} type="button" className="abs" style={{ top: (Math.max(ab.start, open) - open) * PX, height: (Math.min(ab.end, close) - Math.max(ab.start, open)) * PX }} onClick={() => setAbsenceSel(ab.a)}>
                    {t(`absenceKind.${ab.a.kind}`)}
                    {ab.a.note ? ` – ${ab.a.note}` : ''}
                  </button>
                ))}
                {list.map((a) => renderAppt(a, c))}
                {ghost &&
                  ghost.blocks!.map((b, i) => (
                    <div key={`g${i}`} className={`blk ghost ${b.kind === 'free' ? 'free' : ''} ${ghost.valid ? '' : 'bad'}`} style={{ top: (b.start - open) * PX, height: Math.max(14, (b.end - b.start) * PX) }} aria-hidden="true">
                      {i === 0 && <span className="t">{formatHm(b.start)}–{formatHm(ghost.blocks!.at(-1)!.end)}</span>}
                    </div>
                  ))}
                {c.date === today && showNow && <div className="tg-now" style={{ top: (now.minute - open) * PX }} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>

      {sel && (
        <AppointmentPanel
          key={sel.id + sel.version}
          a={sel}
          onClose={() => setSelected(null)}
          onChanged={invalidate}
          validate={validate}
          applyBlocks={(blocks, d, label) => applyChange(sel, { date: d, blocks, stylistId: sel.stylistId }, label)}
          pushUndo={pushUndo}
          setStatus={setStatus}
        />
      )}
      {dialog === 'new' && <NewAppointmentDialog date={date} stylistId={mineId ?? columns[0]?.stylistId ?? ''} onClose={() => setDialog(null)} onCreated={(a) => (invalidate(), setDate(a.date), setSelected(a.id))} />}
      {(dialog === 'absence' || absenceSel) && (
        <AbsenceDialog
          date={date}
          stylistId={mineId ?? columns[0]?.stylistId ?? ''}
          existing={absenceSel}
          onClose={() => (setDialog(null), setAbsenceSel(null))}
          onDone={() => (invalidate(), setDialog(null), setAbsenceSel(null))}
        />
      )}
      {dialog === 'month' && (
        <MonthSheet
          today={today}
          minOffset={-12}
          maxOffset={12}
          initial={date}
          selected={date}
          dotsPath={null}
          isSelectable={() => true}
          onPick={(d) => (setDate(d), setDialog(null))}
          onToday={() => (goToday(), setDialog(null))}
          onClose={() => setDialog(null)}
        />
      )}
    </main>
  );
}
