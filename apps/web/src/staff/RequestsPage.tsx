import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { dateLong, hm, priceText, formatPhone } from '../lib/format';
import { useT } from '../lib/i18n';
import type { Appointment } from '../lib/types';
import { useInvalidateCalendar } from './hooks';

/** Requests inbox (S-5): oldest first, one-tap decisions. */
export function RequestsPage() {
  const t = useT();
  const invalidate = useInvalidateCalendar();
  const q = useQuery({ queryKey: ['requests'], queryFn: () => api<{ requests: Appointment[] }>('/staff/requests'), refetchInterval: 30_000 });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (x: { a: Appointment; decision: 'accept' | 'decline' | 'discuss' }) =>
      api(`/staff/appointments/${x.a.id}/decision`, { method: 'POST', body: { version: x.a.version, decision: x.decision, reason: reasons[x.a.id] || undefined } }),
    onSettled: () => (void q.refetch(), invalidate()),
  });
  const list = q.data?.requests ?? [];
  return (
    <main id="main" className="wrap">
      <h1>{t('staff.nav.requests')}</h1>
      {m.error && <p className="notice error" role="alert">{errorMessage(m.error)}</p>}
      {q.isLoading && <div className="spin" />}
      {!q.isLoading && !list.length && <p className="muted">{t('staff.noRequests')}</p>}
      <div className="card" hidden={!list.length}>
        {list.map((a) => (
          <article key={a.id} className="list-item" aria-labelledby={`rq-${a.id}`}>
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
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor={`rs-${a.id}`}>{t('staff.clientNote')}</label>
                <p id={`rs-h-${a.id}`} className="note-hint">{t('staff.clientNoteHint')}</p>
                <textarea id={`rs-${a.id}`} rows={2} maxLength={500} aria-describedby={`rs-h-${a.id}`} value={reasons[a.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })} />
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn primary" disabled={m.isPending} onClick={() => m.mutate({ a, decision: 'accept' })}>{t('staff.accept')}</button>
              {a.status === 'requested' && <button type="button" className="btn" disabled={m.isPending} onClick={() => m.mutate({ a, decision: 'discuss' })}>{t('staff.toDiscuss')}</button>}
              <button type="button" className="btn danger" disabled={m.isPending} onClick={() => m.mutate({ a, decision: 'decline' })}>{t('staff.decline')}</button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
