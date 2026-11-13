import { formatHm, parseHm, type LocalDate } from '@salon/engine';
import { useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { api, ApiError, errorMessage } from '../lib/api';
import { dateLong } from '../lib/format';
import { useT } from '../lib/i18n';
import { useStylists } from './hooks';
import type { Absence } from '../lib/types';

/** Create (or delete) an absence block (S-7). Rejected over existing appointments – lists them. */
export function AbsenceDialog(p: { date: LocalDate; stylistId: string; existing: Absence | null; canDelete: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const stylists = useStylists();
  const [stylistId, setStylistId] = useState(p.stylistId);
  const [from, setFrom] = useState({ date: p.date, time: '08:00' });
  const [to, setTo] = useState({ date: p.date, time: '17:00' });
  const [allDay, setAllDay] = useState(true);
  const [kind, setKind] = useState<Absence['kind']>('vacation');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (p.existing) {
    const e = p.existing;
    return (
      <Dialog title={t(`absenceKind.${e.kind}`)} onClose={p.onClose}>
        <h2>{t(`absenceKind.${e.kind}`)}</h2>
        <p>{dateLong(e.from.date)} {formatHm(e.from.minute)} – {dateLong(e.to.date)} {formatHm(e.to.minute)}</p>
        {e.note && <p className={e.kind === 'note' ? undefined : 'muted'}>{e.note}</p>}
        {e.kind === 'note' && <p className="small muted">{e.blocks ? t('staff.cnote.blocksYes') : t('staff.cnote.blocksNo')}</p>}
        {error && <p className="notice error">{error}</p>}
        <div className="row">
          {(p.canDelete || e.kind === 'note') && (
            <button type="button" className="btn danger" onClick={async () => { try { await api(`/staff/absences/${e.id}`, { method: 'DELETE' }); p.onDone(); } catch (err) { setError(errorMessage(err)); } }}>{t('staff.delete')}</button>
          )}
          <button type="button" className="btn" onClick={p.onClose}>{t('ui.close')}</button>
        </div>
      </Dialog>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/staff/absences', {
        method: 'POST',
        body: {
          stylistId,
          from: { date: from.date, minute: allDay ? 0 : parseHm(from.time) },
          to: { date: to.date, minute: allDay ? 1440 : parseHm(to.time) },
          kind,
          note: note || undefined,
        },
      });
      p.onDone();
    } catch (err) {
      const list = err instanceof ApiError ? (err.details as { appointments?: { refCode: string; startAt: string }[] } | undefined)?.appointments : undefined;
      setError(`${errorMessage(err)}${list?.length ? ' ' + list.map((x) => `${x.refCode} (${new Date(x.startAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })})`).join(', ') : ''}`);
    }
  }
  return (
    <Dialog title={t('staff.newAbsence')} onClose={p.onClose}>
      <form onSubmit={submit}>
        <h2>{t('staff.newAbsence')}</h2>
        <div className="field">
          <label htmlFor="ab-st">{t('staff.stylist')}</label>
          <select id="ab-st" value={stylistId} onChange={(e) => setStylistId(e.target.value)}>
            {stylists.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ab-kind">{t('staff.kind')}</label>
          <select id="ab-kind" value={kind} onChange={(e) => setKind(e.target.value as Absence['kind'])}>
            {(['vacation', 'sick', 'training', 'other'] as const).map((k) => <option key={k} value={k}>{t(`absenceKind.${k}`)}</option>)}
          </select>
        </div>
        <label className="check"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> <span>Ganztägig</span></label>
        <div className="row">
          <div className="field" style={{ flex: '1 1 140px' }}>
            <label htmlFor="ab-fd">{t('staff.from')}</label>
            <input id="ab-fd" type="date" value={from.date} onChange={(e) => setFrom({ ...from, date: e.target.value })} />
            {!allDay && <input aria-label={`${t('staff.from')} Uhrzeit`} type="time" step={300} value={from.time} onChange={(e) => setFrom({ ...from, time: e.target.value })} />}
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}>
            <label htmlFor="ab-td">{t('staff.to')}</label>
            <input id="ab-td" type="date" value={to.date} onChange={(e) => setTo({ ...to, date: e.target.value })} />
            {!allDay && <input aria-label={`${t('staff.to')} Uhrzeit`} type="time" step={300} value={to.time} onChange={(e) => setTo({ ...to, time: e.target.value })} />}
          </div>
        </div>
        <div className="field">
          <label htmlFor="ab-note">Notiz</label>
          <input id="ab-note" type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="row">
          <button className="btn primary">{t('staff.create')}</button>
          <button type="button" className="btn" onClick={p.onClose}>{t('ui.close')}</button>
        </div>
      </form>
    </Dialog>
  );
}
