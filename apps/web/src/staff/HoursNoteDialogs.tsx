import { formatHm, parseHm, WEEKDAYS, type LocalDate, type Weekday, type WorkDay, type WorkHours } from '@salon/engine';
import { useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { api, ApiError, errorMessage } from '../lib/api';
import { useT } from '../lib/i18n';
import { useSalon } from '../lib/salon';
import type { Stylist } from '../lib/types';
import { AbsenceDialog } from './AbsenceDialog';
import { useStylists } from './hooks';

/**
 * Owner: personal working hours of one person per weekday (D-071) – "wie Öffnungszeiten", "frei" or
 * own times with breaks – plus a shortcut to enter vacation, sickness etc. for this person.
 */
export function WorkHoursDialog({ stylist, date, onClose, onDone }: { stylist: Stylist; date: LocalDate; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const salon = useSalon();
  const cfg = salon.config;
  const initial = stylist.workHours ?? {};
  const [work, setWork] = useState<WorkHours>(initial);
  const [error, setError] = useState<string | null>(null);
  const [absence, setAbsence] = useState(false);
  const names = t.list('weekdayLong');
  const set = (d: Weekday, v: WorkDay | null | undefined) => {
    const next = { ...work };
    if (v === undefined) delete next[d];
    else next[d] = v;
    setWork(next);
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/staff/admin/staff/${stylist.id}/work-hours`, { method: 'PUT', body: { workHours: Object.keys(work).length ? work : null } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    }
  }
  if (absence) return <AbsenceDialog date={date} stylistId={stylist.id} existing={null} canDelete onClose={() => setAbsence(false)} onDone={onDone} />;
  return (
    <Dialog title={t('staff.wh.titleFor', { name: stylist.displayName })} onClose={onClose}>
      <form onSubmit={save}>
        <h2>{t('staff.wh.titleFor', { name: stylist.displayName })}</h2>
        <p className="small muted">{t('staff.wh.intro')}</p>
        {WEEKDAYS.map((d, i) => {
          const salonDay = cfg.weeklyHours[d];
          const mode = !(d in work) ? 'salon' : work[d] === null ? 'off' : 'own';
          const w = work[d];
          const name = names[i] ?? d;
          return (
            <fieldset key={d} className="list-item" style={{ border: 0, margin: 0 }}>
              <legend style={{ fontWeight: 650, minWidth: 110 }}>{name}</legend>
              {!salonDay ? (
                <span className="small muted">{t('staff.closedDay')}</span>
              ) : (
                <>
                  <select aria-label={`${name}: ${t('staff.wh.mode')}`} value={mode} style={{ width: 'auto' }}
                    onChange={(e) => set(d, e.target.value === 'salon' ? undefined : e.target.value === 'off' ? null : { open: salonDay.open, close: salonDay.close, breaks: salonDay.breaks.map((b) => [...b] as [string, string]) })}>
                    <option value="salon">{t('staff.wh.likeSalon', { from: salonDay.open, to: salonDay.close })}</option>
                    <option value="own">{t('staff.wh.own')}</option>
                    <option value="off">{t('staff.wh.dayOff')}</option>
                  </select>
                  {mode === 'own' && w && (
                    <div className="row">
                      <input type="time" step={300} aria-label={`${name} ${t('staff.wh.start')}`} value={w.open} onChange={(e) => set(d, { ...w, open: e.target.value })} style={{ width: 120 }} />
                      –
                      <input type="time" step={300} aria-label={`${name} ${t('staff.wh.end')}`} value={w.close} onChange={(e) => set(d, { ...w, close: e.target.value })} style={{ width: 120 }} />
                      {w.breaks.map((b, bi) => (
                        <span key={bi} className="row">
                          {t('ui.break')}
                          <input type="time" step={300} aria-label={`${name} ${t('ui.break')} ${bi + 1} ${t('staff.wh.start')}`} value={b[0]} onChange={(e) => set(d, { ...w, breaks: w.breaks.map((x, j) => (j === bi ? [e.target.value, x[1]] : x)) as [string, string][] })} style={{ width: 120 }} />
                          –
                          <input type="time" step={300} aria-label={`${name} ${t('ui.break')} ${bi + 1} ${t('staff.wh.end')}`} value={b[1]} onChange={(e) => set(d, { ...w, breaks: w.breaks.map((x, j) => (j === bi ? [x[0], e.target.value] : x)) as [string, string][] })} style={{ width: 120 }} />
                          <button type="button" className="btn" aria-label={`${name} ${t('ui.break')} ${bi + 1} entfernen`} onClick={() => set(d, { ...w, breaks: w.breaks.filter((_, j) => j !== bi) })}>✕</button>
                        </span>
                      ))}
                      <button type="button" className="btn" onClick={() => set(d, { ...w, breaks: [...w.breaks, ['12:00', '12:30']] })}>{t('staff.addBreak')}</button>
                    </div>
                  )}
                </>
              )}
            </fieldset>
          );
        })}
        <p className="small muted">{t('staff.wh.existing')}</p>
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="row">
          <button className="btn primary">{t('staff.save')}</button>
          <button type="button" className="btn" onClick={() => setAbsence(true)}>{t('staff.wh.absence')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('ui.close')}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Internal note in the calendar (D-072): text, time, and whether it blocks the time for appointments. */
export function NoteDialog({ stylistId, date, onClose, onDone }: { stylistId: string; date: LocalDate; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const stylists = useStylists();
  const [sid, setSid] = useState(stylistId);
  const [d, setD] = useState(date);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('09:30');
  const [text, setText] = useState('');
  const [blocks, setBlocks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/staff/absences', {
        method: 'POST',
        body: { stylistId: sid, kind: 'note', note: text, blocks, from: { date: d, minute: parseHm(from) }, to: { date: d, minute: parseHm(to) } },
      });
      onDone();
    } catch (err) {
      const list = err instanceof ApiError ? (err.details as { appointments?: { refCode: string }[] } | undefined)?.appointments : undefined;
      setError(`${errorMessage(err)}${list?.length ? ' ' + list.map((x) => x.refCode).join(', ') : ''}`);
    }
  }
  return (
    <Dialog title={t('staff.cnote.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <h2>{t('staff.cnote.title')}</h2>
        <div className="field">
          <label htmlFor="nt-st">{t('staff.stylist')}</label>
          <select id="nt-st" value={sid} onChange={(e) => setSid(e.target.value)}>
            {stylists.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nt-text">{t('staff.cnote.text')}</label>
          <textarea id="nt-text" rows={2} maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="row">
          <div className="field" style={{ flex: '1 1 140px' }}>
            <label htmlFor="nt-date">Datum</label>
            <input id="nt-date" type="date" value={d} onChange={(e) => setD(e.target.value)} required />
          </div>
          <div className="field" style={{ flex: '1 1 100px' }}>
            <label htmlFor="nt-from">{t('staff.from')}</label>
            <input id="nt-from" type="time" step={300} value={from} onChange={(e) => setFrom(e.target.value || formatHm(540))} required />
          </div>
          <div className="field" style={{ flex: '1 1 100px' }}>
            <label htmlFor="nt-to">{t('staff.to')}</label>
            <input id="nt-to" type="time" step={300} value={to} onChange={(e) => setTo(e.target.value || formatHm(570))} required />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={blocks} onChange={(e) => setBlocks(e.target.checked)} aria-describedby="nt-bh" />
          <span>{t('staff.cnote.blocksLabel')}</span>
        </label>
        <p id="nt-bh" className="small muted">{t('staff.cnote.blocksHint')}</p>
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="row">
          <button className="btn primary">{t('staff.create')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('ui.close')}</button>
        </div>
      </form>
    </Dialog>
  );
}
