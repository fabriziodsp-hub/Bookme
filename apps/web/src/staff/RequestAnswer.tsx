import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useT } from '../lib/i18n';
import type { Appointment } from '../lib/types';

export type Decision = 'accept' | 'decline' | 'discuss';

/**
 * Answer to an open request (D-057), used in the requests inbox and in the calendar panel:
 * the note to the client is saved first ("Notiz speichern"), the saved text is shown, and the
 * answer buttons stay locked while the field has unsaved changes – so exactly the saved text is sent.
 */
export function RequestAnswer({
  a,
  idPrefix,
  onSaved,
  onDecided,
  onFailed,
  acceptLocked = false,
  acceptLockedHint,
}: {
  a: Appointment;
  idPrefix: string;
  onSaved: (dto: Appointment) => void;
  onDecided: (dto: Appointment, decision: Decision) => void;
  onFailed?: () => void;
  /** e.g. the stylist was deleted: give it to a colleague first (D-054) */
  acceptLocked?: boolean;
  acceptLockedHint?: string;
}) {
  const t = useT();
  const saved = a.clientNoteDraft ?? '';
  const [text, setText] = useState(saved);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = text.trim() !== saved;
  const id = `${idPrefix}-${a.id}`;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMsg(errorMessage(e));
      onFailed?.();
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      const dto = await api<Appointment>(`/staff/appointments/${a.id}/client-note`, { method: 'PUT', body: { version: a.version, note: text } });
      setText(dto.clientNoteDraft ?? '');
      setMsg(t('staff.rqNote.saved'));
      onSaved(dto);
    });
  const decide = (decision: Decision) =>
    run(async () => {
      const dto = await api<Appointment>(`/staff/appointments/${a.id}/decision`, { method: 'POST', body: { version: a.version, decision, reason: saved || undefined } });
      onDecided(dto, decision);
    });
  const describedBy = dirty ? `${id}-u` : acceptLocked ? acceptLockedHint : undefined;
  return (
    <>
      <div className="field" style={{ marginTop: 8, marginBottom: 6 }}>
        <label htmlFor={id}>{t('staff.clientNote')}</label>
        <p id={`${id}-h`} className="note-hint">{t('staff.clientNoteHint')}</p>
        <textarea id={id} rows={2} maxLength={500} aria-describedby={`${id}-h`} value={text} onChange={(e) => (setText(e.target.value), setMsg(null))} />
      </div>
      <div className="row">
        <button type="button" className="btn" disabled={!dirty || busy} onClick={save}>{t('staff.rqNote.save')}</button>
        {dirty && <button type="button" className="btn ghost" disabled={busy} onClick={() => (setText(saved), setMsg(null))}>{t('staff.rqNote.discard')}</button>}
        <span role="status" className="small">{msg}</span>
      </div>
      {saved && !dirty && <p className="notice small" style={{ marginTop: 8 }}><strong>{t('staff.rqNote.willSend')}</strong> „{saved}“</p>}
      {dirty && <p className="notice warn small" id={`${id}-u`} style={{ marginTop: 8 }}>{t('staff.rqNote.unsaved')}</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn primary" disabled={busy || dirty || acceptLocked} aria-describedby={describedBy} onClick={() => decide('accept')}>{t('staff.accept')}</button>
        {a.status === 'requested' && <button type="button" className="btn" disabled={busy || dirty} aria-describedby={dirty ? `${id}-u` : undefined} onClick={() => decide('discuss')}>{t('staff.toDiscuss')}</button>}
        <button type="button" className="btn danger" disabled={busy || dirty} aria-describedby={dirty ? `${id}-u` : undefined} onClick={() => decide('decline')}>{t('staff.decline')}</button>
      </div>
    </>
  );
}
