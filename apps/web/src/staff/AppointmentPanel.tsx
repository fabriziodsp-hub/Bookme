/** Side/bottom panel: full keyboard alternative to drag & drop, decisions, status, fee, age check, notes. */
import { formatHm, parseHm, resizePhase, shiftBlocks, type Block, type LocalDate } from '@salon/engine';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { dateLong, euro, priceText, formatPhone } from '../lib/format';
import { Link } from 'react-router';
import { useT } from '../lib/i18n';
import { useLabels } from '../lib/labels';
import { useSalon } from '../lib/salon';
import type { Appointment } from '../lib/types';
import type { UndoItem } from './CalendarPage';
import { RequestAnswer } from './RequestAnswer';

export function AppointmentPanel(p: {
  a: Appointment;
  onClose: () => void;
  onChanged: () => void;
  validate: (a: Appointment, blocks: Block[], d: LocalDate, stylistId: string) => { ok: boolean; reason: string };
  applyBlocks: (blocks: Block[], date: LocalDate, label: string) => Promise<void>;
  pushUndo: (u: UndoItem) => void;
  setStatus: (s: string) => void;
}) {
  const t = useT();
  const L = useLabels();
  const a = p.a;
  const [date, setDate] = useState(a.date);
  const [time, setTime] = useState(formatHm(a.start));
  const [note, setNote] = useState(a.internalNote ?? '');
  const [lateCancel, setLateCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headRef.current?.focus(), [a.id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [p]);

  const call = async (fn: () => Promise<unknown>, undo?: UndoItem) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (undo) p.pushUndo(undo);
      p.onChanged();
    } catch (e) {
      setError(errorMessage(e));
      p.onChanged();
    } finally {
      setBusy(false);
    }
  };
  const fresh = async () => (await api<{ appointment: Appointment }>(`/staff/appointments/${a.id}`)).appointment;
  const setStatusTo = (status: string, extra: Record<string, unknown> = {}) => async () => {
    const cur = await fresh();
    await api(`/staff/appointments/${a.id}/status`, { method: 'POST', body: { version: cur.version, status, ...extra } });
  };

  const move = (blocks: Block[] | null, d: LocalDate, label: string) => {
    if (!blocks) return setError('Phase zu kurz.');
    const v = p.validate(a, blocks, d, a.stylistId);
    if (!v.ok && d === a.date) return setError(`${t('staff.invalid')}: ${v.reason}`);
    void p.applyBlocks(blocks, d, label);
  };

  const open = ['requested', 'discuss', 'confirmed'].includes(a.status);
  const salon = useSalon();
  // appointments from yesterday backwards stay in the history (server enforces it too)
  const pastLocked = a.date < salon.now.date;
  const name = `${a.customer.firstName} ${a.customer.lastName}`;
  return (
    <aside className="panel" role="region" aria-labelledby="panel-h">
      <div className="row">
        {/* the client's name opens the client card (D-051) */}
        <h2 id="panel-h" tabIndex={-1} ref={headRef}>
          <Link className="name-link" to={`/${salon.slug}/team/kunden/${a.customer.id}`}>
            {name}<span className="sr-only"> – {t('staff.card.open')}</span> <span aria-hidden="true">›</span>
          </Link>
        </h2>
        <span className="spacer" />
        <button type="button" className="btn" onClick={p.onClose} aria-label={t('ui.close')}>✕</button>
      </div>
      <p className="muted small">
        {a.serviceLabel} · {dateLong(a.date)}, {formatHm(a.start)}–{formatHm(a.end)} ({a.end - a.start} Min.)
        {a.price && <> · {priceText(a.price)}{a.price.birthdayDiscount && <> · <span className="badge ac">{t('staff.birthday')}</span></>}</>}
      </p>
      <div className="row small" style={{ marginBottom: 8 }}>
        <span className={`badge ${a.status === 'confirmed' ? 'ac' : a.status === 'requested' || a.status === 'discuss' ? 'warn' : ''}`}>{t(`ui.status.${a.status}`)}</span>
        {a.customer.noShowCount > 0 && <span className="badge danger">{t('staff.noShows', { n: a.customer.noShowCount })}</span>}
        {!a.adultDeclared && <span className="badge">minderjährig</span>}
        {a.expiresAt && a.status === 'requested' && <span className="badge">{t('staff.expires', { time: new Date(a.expiresAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) })}</span>}
      </div>
      <div className="row small">
        {a.customer.phone && <a className="btn" href={`tel:${a.customer.phone}`}>📞 {formatPhone(a.customer.phone)}</a>}
        {a.customer.email && <a className="btn" href={`mailto:${a.customer.email}`}>✉️ E-Mail</a>}
      </div>
      {a.colorNotes && <p className="notice small"><strong>{t('staff.colorNotes')}:</strong> {a.colorNotes}</p>}
      {a.clientNote && <p className="notice small"><strong>{t('staff.clientNoteSent')}:</strong> {a.clientNote}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}

      {(a.status === 'requested' || a.status === 'discuss') && (
        <section className="card" style={{ marginTop: 8 }} aria-label={t('staff.request')}>
          {a.needsReassign && <p id={`pr-ra-${a.id}`} className="notice warn small">{t('staff.reassign.panel')}</p>}
          <RequestAnswer
            key={a.version}
            a={a}
            idPrefix="decl"
            onSaved={() => p.onChanged()}
            onFailed={() => p.onChanged()}
            acceptLocked={a.needsReassign}
            acceptLockedHint={`pr-ra-${a.id}`}
            onDecided={(dto, decision) => {
              p.setStatus(`${t(`staff.rqNote.decided.${decision}`)}. ${dto.clientNote ? t('staff.rqNote.sent', { note: dto.clientNote }) : t('staff.rqNote.sentNone')}`);
              p.onChanged();
            }}
          />
        </section>
      )}

      {open && (
        <section aria-label={t('staff.dateTime')}>
          <h3>{t('staff.dateTime')}</h3>
          <div className="row">
            <input type="date" aria-label="Datum" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: '1 1 140px' }} />
            <input type="time" aria-label="Startzeit" step={300} value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: '1 1 110px' }} />
            <button type="button" className="btn" onClick={() => /^\d\d:\d\d$/.test(time) && move(shiftBlocks(a.blocks, parseHm(time) - a.start), date, 'Datum/Zeit')}>{t('staff.apply')}</button>
          </div>
          <div className="stepper" style={{ marginTop: 8 }}>
            <span style={{ minWidth: 60 }}>{t('staff.start')}</span>
            {[-15, -5, 5, 15].map((m) => (
              <button key={m} type="button" className="btn" aria-label={`${m > 0 ? '+' : '−'}${Math.abs(m)}: ${t(m < 0 ? 'staff.earlier' : 'staff.later', { n: Math.abs(m) })}`} onClick={() => move(shiftBlocks(a.blocks, m), a.date, 'Verschieben')}>
                {m > 0 ? '+' : '−'}{Math.abs(m)}
              </button>
            ))}
          </div>
          {a.blocks.map((b, i) => (
            <div key={i} className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
              <span>{L.phase(b.phase, a.serviceId)} · <b>{b.end - b.start}′</b></span>
              <span className="stepper">
                {[-15, -5, 5, 15].map((m) => (
                  <button key={m} type="button" className="btn" aria-label={`${m > 0 ? '+' : '−'}${Math.abs(m)}: ${t(m < 0 ? 'staff.shorter' : 'staff.longer', { phase: L.phase(b.phase, a.serviceId), n: Math.abs(m) })}`} onClick={() => move(resizePhase(a.blocks, i, m, 5), a.date, 'Dauer ändern')}>
                    {m > 0 ? '+' : '−'}{Math.abs(m)}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </section>
      )}

      <section style={{ marginTop: 12 }}>
        <div className="row">
          {a.status === 'confirmed' && (
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => call(setStatusTo('completed'), { label: t('staff.completed'), undo: setStatusTo('confirmed'), redo: setStatusTo('completed') })}>{t('staff.completed')}</button>
              <button type="button" className="btn" disabled={busy} onClick={() => call(setStatusTo('no_show'), { label: t('staff.noShow'), undo: setStatusTo('confirmed'), redo: setStatusTo('no_show') })}>{t('staff.noShow')}</button>
            </>
          )}
          {(a.status === 'completed' || a.status === 'no_show') && (
            <button type="button" className="btn" disabled={busy} onClick={() => call(setStatusTo('confirmed'))}>{t('staff.reopen')}</button>
          )}
          {open && !pastLocked && (
            <button type="button" className="btn danger" disabled={busy} onClick={() => call(setStatusTo('cancelled', { clientLateCancel: lateCancel, reason: a.clientNoteDraft || undefined }), { label: t('staff.cancel'), undo: setStatusTo('confirmed'), redo: setStatusTo('cancelled') })}>
              {t('staff.cancel')}
            </button>
          )}
        </div>
        {open && pastLocked && <p className="small muted">{t('staff.pastLocked')}</p>}
        {open && !pastLocked && a.fee && (
          <label className="check small">
            <input type="checkbox" checked={lateCancel} onChange={(e) => setLateCancel(e.target.checked)} />
            <span>{t('staff.lateCancel')} ({euro(a.fee.cents)})</span>
          </label>
        )}
      </section>

      {a.fee && a.fee.status !== 'none' && (
        <section className="notice warn" style={{ marginTop: 12 }}>
          <strong>{t('staff.fee')}: {euro(a.fee.cents)} – {t(`staff.feeStatus.${a.fee.status}`)}</strong>
          {a.fee.status === 'due' && (
            <div className="row" style={{ marginTop: 6 }}>
              <button type="button" className="btn" onClick={() => call(async () => api(`/staff/appointments/${a.id}/fee`, { method: 'POST', body: { version: (await fresh()).version, status: 'paid' } }))}>{t('staff.markPaid')}</button>
              <button type="button" className="btn" onClick={() => call(async () => api(`/staff/appointments/${a.id}/fee`, { method: 'POST', body: { version: (await fresh()).version, status: 'waived' } }))}>{t('staff.waive')}</button>
            </div>
          )}
        </section>
      )}

      {a.ageCheck.status !== 'not_required' && (
        <section style={{ marginTop: 12 }}>
          <h3>{t('staff.ageCheck')}: <span className="badge">{t(`ageCheck.${a.ageCheck.status}`)}</span></h3>
          <div className="row">
            {(['request', 'verified', 'not_verified', 'not_presented'] as const).map((act) => (
              <button key={act} type="button" className="btn" onClick={() => call(async () => api(`/staff/appointments/${a.id}/age-check`, { method: 'POST', body: { version: (await fresh()).version, action: act } }))}>
                {t({ request: 'staff.ageRequest', verified: 'staff.ageVerified', not_verified: 'staff.ageNotVerified', not_presented: 'staff.ageNotPresented' }[act])}
              </button>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginTop: 12 }}>
        <label htmlFor="inote">{t('staff.note')}</label>
        <textarea id="inote" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="btn" style={{ marginTop: 6 }} onClick={() => call(async () => api(`/staff/appointments/${a.id}/note`, { method: 'PUT', body: { version: (await fresh()).version, note } }))}>{t('staff.saveNote')}</button>
      </section>
    </aside>
  );
}
