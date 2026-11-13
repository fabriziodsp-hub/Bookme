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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
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

/** px per minute. "Klassisch": 5′ = 9 px, 15′ = 27 px, 60′ = 108 px (scrolls). "Ganzer Tag" fits the opening
 * hours into the visible height, but never below FIT_MIN, so a 30′ appointment keeps two readable lines (D-060). */
const PX_CLASSIC = 1.8;
const FIT_MIN = 1.2; // 20′ (Rentner-Schnitt) = 24 px: minimum target size (WCAG 2.2 AA)
type Zoom = 'fit' | 'classic';
const ZOOM_KEY = 'salon.calZoom';
function loadZoom(): Zoom {
  try {
    return localStorage.getItem(ZOOM_KEY) === 'classic' ? 'classic' : 'fit';
  } catch {
    return 'fit';
  }
}
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
  // Click on an empty spot of a column = new appointment there (D-067); the button stays as keyboard path.
  const [newAt, setNewAt] = useState<{ date: LocalDate; stylistId: string; start: number } | null>(null);
  const [absenceSel, setAbsenceSel] = useState<Absence | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const [zoom, setZoomState] = useState<Zoom>(loadZoom);
  const setZoom = (z: Zoom) => {
    setZoomState(z);
    try {
      localStorage.setItem(ZOOM_KEY, z);
    } catch {
      /* per-device convenience only */
    }
  };
  // "Ganzer Tag" = full-screen calendar (D-069): one bar with day navigation, "Neuer Termin" and
  // settings; everything else in a side drawer. Phones keep the classic page.
  const phone = useMedia('(max-width: 700px)');
  const full = zoom === 'fit' && !phone;
  const [drawer, setDrawer] = useState(false);
  const [browserFull, setBrowserFull] = useState(false);
  // The time grid fills the rest of the screen: the page itself does not scroll, the wheel scrolls the grid (D-060).
  const [gridH, setGridH] = useState(0);

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

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + (full ? 0 : window.scrollY);
      const nav = document.querySelector<HTMLElement>('.staff-nav');
      const bottomBar = !full && nav && getComputedStyle(nav).position === 'fixed' ? nav.offsetHeight : 0;
      setGridH(Math.max(320, Math.floor(window.innerHeight - top - bottomBar - 12)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    return () => (ro.disconnect(), window.removeEventListener('resize', measure));
  }, [full, mode, range]);
  const HEAD = 49; // sticky column header
  // Phones keep "Klassisch": dragging by finger needs 9 px per 5′ (the switch is hidden there).
  const px = zoom === 'classic' || phone || !gridH ? PX_CLASSIC : Math.min(PX_CLASSIC, Math.max(FIT_MIN, (gridH - HEAD - 2) / (close - open)));

  // Optional browser full screen on top (hides the browser's own bars); Fullscreen API, not on iPhone.
  const toggleBrowserFull = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      else await document.exitFullscreen();
    } catch {
      /* not supported */
    }
  };
  useEffect(() => {
    const onChange = () => setBrowserFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => {
    if (!full && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, [full]);

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
        OVERLAPS_BUSY: 'Zeit belegt', IN_ABSENCE: 'Abwesenheit', PHASE_TOO_SHORT: 'Phase zu kurz', SMALL_GAP: 'zu kleine Lücke', OFF_GRID: 'nicht im 5-Min.-Raster',
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
        const dm = snap((e.clientY - d.y0) / px, cfg.staffStepMinutes);
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
  }, [byId, columns, cfg, validate, applyChange, t, px]);

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
    const y = (Math.min(Math.max(nowRef.current, open), close) - open) * px;
    const top = jump ? y - el.clientHeight / 2 + 30 : y - 60 * px;
    const calm = document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: Math.max(0, top), behavior: jump && !calm ? 'smooth' : 'auto' });
  }, [date, today, open, close, mode, range, jump, px]);
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

  // Mouse wheel: over the day strip it moves day by day; over the grid it scrolls the hours, and when the
  // whole day already fits (nothing to scroll) it moves day by day too. One step per gesture (D-060).
  const stripRef = useRef<HTMLDivElement>(null);
  const wheel = useRef({ acc: 0, until: 0 });
  const stepRef = useRef<(dir: 1 | -1) => void>(() => undefined);
  stepRef.current = (dir) => setDate((d) => nextOpen(d, dir));
  useEffect(() => {
    const onWheel = (grid: boolean) => (e: WheelEvent) => {
      const el = wrapRef.current;
      if (grid && el && el.scrollHeight > el.clientHeight + 2) return; // normal scrolling
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return; // zoom / sideways scrolling stay native
      e.preventDefault();
      const w = wheel.current;
      const now = Date.now();
      if (now < w.until) return;
      w.acc += e.deltaY;
      if (Math.abs(w.acc) < 60) return;
      stepRef.current(w.acc > 0 ? 1 : -1);
      w.acc = 0;
      w.until = now + 450;
    };
    const s = stripRef.current;
    const g = wrapRef.current;
    const fs = onWheel(false);
    const fg = onWheel(true);
    s?.addEventListener('wheel', fs, { passive: false });
    g?.addEventListener('wheel', fg, { passive: false });
    return () => (s?.removeEventListener('wheel', fs), g?.removeEventListener('wheel', fg));
  }, []);

  const height = (close - open) * px;
  const showNow = columns.some((c) => c.date === today) && now.minute >= open && now.minute <= close;
  // Time axis every 15′ (owner 2026-11-13, D-070); full hours stand out.
  const ticks = Array.from({ length: Math.ceil((close - open) / 15) }, (_, i) => open + i * 15);
  const colMin = mode === 'team' ? 150 : range === 'week' ? 110 : 220;
  // Time axis on both sides (owner 2026-11-13, D-070): left and right column.
  const gridCols = `48px repeat(${columns.length}, minmax(${colMin}px, 1fr)) 48px`;

  const renderAppt = (a: Appointment, col: Column) => {
    const isDragged = drag?.id === a.id;
    const name = `${a.customer.firstName} ${a.customer.lastName}`;
    const statusCls = a.status === 'requested' || a.status === 'discuss' ? 'req' : a.status === 'completed' ? 'done' : a.status === 'no_show' ? 'noshow' : '';
    return a.blocks.map((b, i) => (
      <div
        key={`${a.id}-${i}`}
        className={`blk ${(b.end - b.start) * px < 30 ? 'short tiny' : (b.end - b.start) * px < 44 ? 'short' : ''} ${i === 0 ? 'first' : i === a.blocks.length - 1 ? 'last' : 'mid'} ${i === 0 && a.blocks.length > 1 ? 'has-next' : ''} ${b.kind === 'free' ? 'free' : ''} ${statusCls} ${selected === a.id ? 'sel' : ''} ${isDragged ? 'dim' : ''}`}
        style={{ top: (b.start - open) * px, height: Math.max(14, (b.end - b.start) * px) }}
        // One keyboard/AT target per appointment: the first phase. The other phases stay clickable with
        // the mouse but are not separate buttons (short phases would fall below the 24 px target size).
        tabIndex={i === 0 ? 0 : undefined}
        role={i === 0 ? 'button' : undefined}
        aria-pressed={i === 0 ? selected === a.id : undefined}
        aria-hidden={i === 0 ? undefined : true}
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
            {/* team note: one line in the block (full text in the panel), D-060 */}
            {a.internalNote && <span className="nt"><span aria-hidden="true">📝 </span><span className="sr-only">{t('staff.cal.teamNote')}: </span>{a.internalNote}</span>}
            <span className="tm">{formatHm(a.start)}–{formatHm(a.end)}</span>{' '}
          </>
        )}
        <span className="ph">
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
    <main id="main" ref={rootRef} className={`wrap-wide staff cal-page ${sel ? 'with-panel' : ''} ${full ? 'cal-full' : ''}`}>
      <h1 className="sr-only">{t('staff.nav.calendar')}</h1>
      {full ? (
        <>
          {/* Ganzer Tag (D-069): one bar – menu, day navigation, new appointment, settings */}
          <div className="toolbar cal-bar" role="group" aria-label="Navigation">
            <button type="button" className="btn" aria-expanded={drawer} aria-controls="cal-drawer" onClick={() => setDrawer(true)}>
              <span aria-hidden="true">☰ </span>{t('staff.cal.menu')}
            </button>
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
            <button type="button" className="btn" disabled={!undoStack.length} onClick={() => runUndo('undo')} aria-label={`${t('staff.undo')}${undoStack.at(-1) ? `: ${undoStack.at(-1)!.label}` : ''}`} title={t('staff.undo')}>↶</button>
            <button type="button" className="btn hide-m" aria-label={t('staff.prevWeek')} onClick={() => setDate(addDays(date, -7))}>«</button>
            <button type="button" className="btn" aria-label={t('staff.prevDay')} onClick={() => setDate(nextOpen(date, -1))}>‹</button>
            <button type="button" className="btn" onClick={goToday}>{t('ui.today')}</button>
            <button type="button" className="btn" aria-label={t('staff.nextDay')} onClick={() => setDate(nextOpen(date, 1))}>›</button>
            <button type="button" className="btn hide-m" aria-label={t('staff.nextWeek')} onClick={() => setDate(addDays(date, 7))}>»</button>
            <button type="button" className="btn date" onClick={() => setDialog('month')}><span aria-hidden="true">📅 </span><span className="sr-only">{t('staff.pickDate')}: </span><span className="hide-s">{dateLong(date)}</span><span className="show-s">{dateShort(date)}<span className="sr-only"> ({dateLong(date)})</span></span></button>
            <button type="button" className="btn primary" onClick={() => setDialog('new')}>+ {t('staff.newAppointment')}</button>
            <Link className="btn" to={`/${salon.slug}/team/anfragen`}>{t('staff.nav.requests')} {!!data?.openRequests && <span className="badge warn">{data.openRequests}</span>}</Link>
          </div>
          {drawer && (
            <Drawer id="cal-drawer" title={t('staff.cal.menu')} onClose={() => setDrawer(false)}>
              <nav aria-label={t('staff.area')} className="drawer-nav">
                <Link className="btn block-l" to={`/${salon.slug}/team/kunden`}>{t('staff.nav.customers')}</Link>
                <Link className="btn block-l" to={`/${salon.slug}/team/einstellungen`}>{t('staff.nav.settings')}</Link>
                <Link className="btn block-l" to={`/${salon.slug}/team/einstellungen/konto`}>{t('staff.cal.account', { name: me.displayName })}</Link>
              </nav>
              <h3>{t('staff.cal.view')}</h3>
              <div className="drawer-row">
                <button type="button" className="btn block-l" onClick={() => (setZoom('classic'), setDrawer(false))}>{t('staff.cal.toClassic')}</button>
              </div>
              {typeof document.documentElement.requestFullscreen === 'function' && (
                <button type="button" className="btn block-l" aria-pressed={browserFull} onClick={() => void toggleBrowserFull()}>
                  <span aria-hidden="true">{browserFull ? '⤡' : '⤢'} </span>{browserFull ? t('staff.cal.exitFull') : t('staff.cal.full')}
                </button>
              )}
              <h3>{t('staff.cal.edit')}</h3>
              <div className="drawer-row">
                <button type="button" className="btn" disabled={!undoStack.length} onClick={() => runUndo('undo')} aria-label={`${t('staff.undo')}${undoStack.at(-1) ? `: ${undoStack.at(-1)!.label}` : ''}`}>↶ <span className="hide-s">{t('staff.undo')}</span></button>
                <button type="button" className="btn" disabled={!redoStack.length} onClick={() => runUndo('redo')} aria-label={t('staff.redo')}>↷ <span className="hide-s">{t('staff.redo')}</span></button>
                <button type="button" className="btn" onClick={() => (setDrawer(false), setDialog('absence'))}>{t('staff.newAbsence')}</button>
              </div>
              <h3>{t('staff.cal.help')}</h3>
              <p className="small muted">{t('staff.help')}</p>
            </Drawer>
          )}
        </>
      ) : (
        <>
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
            <div className="seg hide-m" role="group" aria-label={t('staff.cal.zoom')}>
              <button type="button" aria-pressed={zoom === 'fit'} onClick={() => (setZoom('fit'), setDrawer(false))}>{t('staff.cal.fit')}</button>
              <button type="button" aria-pressed={zoom === 'classic'} onClick={() => (setZoom('classic'), setDrawer(false))}>{t('staff.cal.classic')}</button>
            </div>
            <span className="spacer" />
            <button type="button" className="btn" disabled={!undoStack.length} onClick={() => runUndo('undo')} aria-label={`${t('staff.undo')}${undoStack.at(-1) ? `: ${undoStack.at(-1)!.label}` : ''}`}>↶ <span className="hide-s">{t('staff.undo')}</span></button>
            <button type="button" className="btn" disabled={!redoStack.length} onClick={() => runUndo('redo')} aria-label={t('staff.redo')}>↷ <span className="hide-s">{t('staff.redo')}</span></button>
            <button type="button" className="btn" onClick={() => (setDrawer(false), setDialog('absence'))}>{t('staff.newAbsence')}</button>
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
        </>
      )}

      <div className="strip" role="group" aria-label="Woche" ref={stripRef}>
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

      <div className="tg-wrap" ref={wrapRef} tabIndex={0} role="region" aria-label={`${t('staff.nav.calendar')} ${dateLong(date)}`} data-px={px.toFixed(3)} style={gridH ? { height: gridH } : undefined}>
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
          <div className="tg-head corner corner-r" aria-hidden="true" />
          <div className="tg-axis" style={{ height, position: 'sticky' }} aria-hidden="true">
            {ticks.map((m) => (
              <span key={m} className={m % 60 === 0 ? 'hr' : 'qt'} style={{ top: (m - open) * px + (m === open ? 8 : 0) }}>{formatHm(m)}</span>
            ))}
            {showNow && <b className="tg-now-time" style={{ top: (now.minute - open) * px }}>{formatHm(now.minute)}</b>}
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
                style={{ height, ['--h60' as string]: `${60 * px}px`, ['--h30' as string]: `${30 * px}px`, ['--h5' as string]: `${5 * px}px` }}
                onClick={(e) => {
                  if (e.target !== e.currentTarget || !h) return; // blocks, breaks, closed time: not here
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const start = Math.floor((open + y / px) / 15) * 15; // 15′ steps: easy to hit, editable in the dialog
                  if (start < h.open || start >= h.close) return;
                  setNewAt({ date: c.date, stylistId: c.stylistId, start });
                  setDialog('new');
                }}
              >
                {!h ? (
                  <div className="tg-off" style={{ top: 0, bottom: 0 }}>{t('ui.closed')}</div>
                ) : (
                  <>
                    {h.open > open && <div className="tg-off" style={{ top: 0, height: (h.open - open) * px }} />}
                    {h.close < close && <div className="tg-off" style={{ top: (h.close - open) * px, bottom: 0 }}>{t('ui.closed')}</div>}
                    {h.breaks.map((b, i) => (
                      <div key={i} className="tg-off" style={{ top: (b.start - open) * px, height: (b.end - b.start) * px }}>{t('ui.break')}</div>
                    ))}
                  </>
                )}
                {absenceIntervals(c.stylistId, c.date).map((ab) => (
                  <button key={ab.a.id} type="button" className="abs" style={{ top: (Math.max(ab.start, open) - open) * px, height: (Math.min(ab.end, close) - Math.max(ab.start, open)) * px }} onClick={() => setAbsenceSel(ab.a)}>
                    {t(`absenceKind.${ab.a.kind}`)}
                    {ab.a.note ? ` – ${ab.a.note}` : ''}
                  </button>
                ))}
                {list.map((a) => renderAppt(a, c))}
                {ghost &&
                  ghost.blocks!.map((b, i) => (
                    <div key={`g${i}`} className={`blk ghost ${b.kind === 'free' ? 'free' : ''} ${ghost.valid ? '' : 'bad'}`} style={{ top: (b.start - open) * px, height: Math.max(14, (b.end - b.start) * px) }} aria-hidden="true">
                      {i === 0 && <span className="t">{formatHm(b.start)}–{formatHm(ghost.blocks!.at(-1)!.end)}</span>}
                    </div>
                  ))}
                {c.date === today && showNow && <div className="tg-now" style={{ top: (now.minute - open) * px }} aria-hidden="true" />}
              </div>
            );
          })}
          <div className="tg-axis tg-axis-r" style={{ height, position: 'sticky' }} aria-hidden="true">
            {ticks.map((m) => (
              <span key={m} className={m % 60 === 0 ? 'hr' : 'qt'} style={{ top: (m - open) * px + (m === open ? 8 : 0) }}>{formatHm(m)}</span>
            ))}
                      </div>
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
      {dialog === 'new' && (
        <NewAppointmentDialog
          date={newAt?.date ?? date}
          stylistId={newAt?.stylistId ?? mineId ?? columns[0]?.stylistId ?? ''}
          start={newAt?.start}
          onClose={() => (setDialog(null), setNewAt(null))}
          onCreated={(a) => (invalidate(), setDate(a.date), setSelected(a.id))}
        />
      )}
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

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** Side drawer of the full-screen calendar (D-069): modal, focus inside, Escape and backdrop close it. */
function Drawer({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const focusables = () => [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, [tabindex]:not([tabindex="-1"])')];
    (focusables()[0] ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (e.stopPropagation(), closeRef.current());
      else if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) (e.preventDefault(), f.at(-1)!.focus());
        else if (!e.shiftKey && document.activeElement === f.at(-1)) (e.preventDefault(), f[0]!.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => (document.removeEventListener('keydown', onKey), opener?.focus?.());
  }, []);
  return (
    <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside id={id} ref={ref} className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="spacer" />
          <button type="button" className="btn" aria-label="Menü schließen" onClick={onClose}>✕</button>
        </div>
        {children}
      </aside>
    </div>
  );
}
