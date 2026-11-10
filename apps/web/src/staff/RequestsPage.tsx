import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { dateLong, hm, priceText, formatPhone } from '../lib/format';
import { useT } from '../lib/i18n';
import type { Appointment } from '../lib/types';
import { useInvalidateCalendar, useStylists } from './hooks';
import { RequestAnswer } from './RequestAnswer';

/** Requests inbox (S-5): oldest first, one-tap decisions. The note to the client is saved first (D-057). */
export function RequestsPage() {
  const t = useT();
  const q = useQuery({ queryKey: ['requests'], queryFn: () => api<{ requests: Appointment[] }>('/staff/requests'), refetchInterval: 30_000 });
  const [done, setDone] = useState<string | null>(null);
  const list = q.data?.requests ?? [];
  return (
    <main id="main" className="wrap">
      <h1>{t('staff.nav.requests')}</h1>
      <p className="notice" role="status" hidden={!done}>{done}</p>
      {q.isLoading && <div className="spin" />}
      {!q.isLoading && !list.length && <p className="muted">{t('staff.noRequests')}</p>}
      <div className="card" hidden={!list.length}>
        {list.map((a) => <RequestItem key={a.id} a={a} onDone={setDone} />)}
      </div>
    </main>
  );
}

function RequestItem({ a, onDone }: { a: Appointment; onDone: (msg: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const invalidate = useInvalidateCalendar();
  const [msg, setMsg] = useState<string | null>(null);
  const replace = (dto: Appointment) =>
    qc.setQueryData<{ requests: Appointment[] }>(['requests'], (d) => (d ? { requests: d.requests.map((x) => (x.id === dto.id ? dto : x)) } : d));
  const refresh = () => (void qc.invalidateQueries({ queryKey: ['requests'] }), invalidate());
  const stylists = useStylists();
  const [to, setTo] = useState('');
  const reassign = useMutation({
    // Same write path as a drag to another column: time and phases unchanged, only the person (D-054).
    mutationFn: () => api<Appointment>(`/staff/appointments/${a.id}/blocks`, { method: 'PATCH', body: { version: a.version, date: a.date, blocks: a.blocks, stylistId: to, notifyCustomer: false } }),
    onSuccess: (dto) => (replace(dto), setMsg(t('staff.reassign.done', { name: stylists.find((s) => s.id === to)?.displayName ?? '' }))),
    onError: (e) => setMsg(errorMessage(e)),
    onSettled: refresh,
  });
  return (
    <article className="list-item" aria-labelledby={`rq-${a.id}`}>
      <div style={{ flex: '1 1 240px' }}>
        <h2 id={`rq-${a.id}`} style={{ fontSize: '1rem' }}>
          {a.customer.firstName} {a.customer.lastName}{' '}
          <span className={`badge ${a.status === 'discuss' ? '' : 'warn'}`}>{a.status === 'discuss' ? t('staff.discuss') : t('staff.request')}</span>
        </h2>
        <p className="small" style={{ margin: 0 }}>
          <strong>{dateLong(a.date)}, {hm(a.start)}–{hm(a.end)}</strong> · {a.serviceLabel}
          {a.price && <> · {priceText(a.price)}</>}
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          {[a.customer.phone && formatPhone(a.customer.phone), a.customer.email].filter(Boolean).join(' · ')}
          {a.customer.noShowCount > 0 && <> · <span className="badge danger">{t('staff.noShows', { n: a.customer.noShowCount })}</span></>}
          {a.expiresAt && <> · {t('staff.expires', { time: new Date(a.expiresAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) })}</>}
        </p>
        {a.colorNotes && <p className="small">„{a.colorNotes}“</p>}
        {a.needsReassign && (
          <div className="notice warn" style={{ marginTop: 8 }}>
            <p id={`ra-h-${a.id}`} style={{ margin: '0 0 6px' }}>{t('staff.reassign.hint')}</p>
            <div className="row">
              <label htmlFor={`ra-${a.id}`} className="sr-only">{t('staff.reassign.to')}</label>
              <select id={`ra-${a.id}`} value={to} onChange={(e) => setTo(e.target.value)} aria-describedby={`ra-h-${a.id}`} style={{ flex: '1 1 180px', width: 'auto' }}>
                <option value="">{t('staff.reassign.to')}</option>
                {stylists.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
              </select>
              <button type="button" className="btn" disabled={!to || reassign.isPending} onClick={() => reassign.mutate()}>{t('staff.reassign.give')}</button>
            </div>
          </div>
        )}
        {msg && <p className="small" role="status">{msg}</p>}
        <RequestAnswer
          key={a.version}
          a={a}
          idPrefix="rs"
          onSaved={replace}
          onFailed={refresh}
          acceptLocked={a.needsReassign}
          acceptLockedHint={`ra-h-${a.id}`}
          onDecided={(dto, decision) => {
            onDone(`${t(`staff.rqNote.decided.${decision}`)}: ${a.customer.firstName} ${a.customer.lastName}. ${dto.clientNote ? t('staff.rqNote.sent', { note: dto.clientNote }) : t('staff.rqNote.sentNone')}`);
            refresh();
          }}
        />
      </div>
    </article>
  );
}
