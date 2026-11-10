import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { dateLong, hm, formatPhone } from '../lib/format';
import { useT } from '../lib/i18n';
import { useSalon } from '../lib/salon';

interface Entry { id: string; kind: 'color' | 'note'; body: string; author: string | null; authorId: string | null; createdAt: string }
interface Card {
  customer: {
    id: string; firstName: string; lastName: string; phone: string | null; email: string | null; createdAt: string;
    privacyAckAt: string | null; birthMonth: number | null; health: { consentAt: string | null; notes: string | null }; noShowCount: number;
  };
  appointments: { id: string; date: string; start: number; end: number; serviceLabel: string; status: string; stylist: string; colorNotes: string | null; locked: boolean }[];
  entries: Entry[];
}

const dt = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const ACTIVE = ['requested', 'discuss', 'confirmed'];

/** Client card (staff only): contact, appointment history, colour recipes, notes, allergies (with consent). */
export function CustomerCardPage({ me }: { me: { id: string; role: string } }) {
  const { id = '' } = useParams();
  const t = useT();
  const salon = useSalon();
  const qc = useQueryClient();
  const key = ['customer-card', id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Card>(`/staff/customers/${id}`) });
  const [err, setErr] = useState<string | null>(null);
  const save = (fn: () => Promise<unknown>) => async () => {
    setErr(null);
    try {
      const r = await fn();
      if (r) qc.setQueryData(key, r);
      else await q.refetch();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  if (q.isLoading) return <div className="spin" role="status" />;
  if (q.error || !q.data) return <main className="wrap"><p className="notice error">{errorMessage(q.error)}</p></main>;
  const { customer: c, appointments, entries } = q.data;
  const now = salon.now;
  const isFuture = (a: Card['appointments'][number]) => a.date > now.date || (a.date === now.date && a.end > now.minute);
  const upcoming = appointments.filter((a) => isFuture(a) && ACTIVE.includes(a.status)).reverse();
  const history = appointments.filter((a) => !upcoming.includes(a));

  return (
    <main id="main" className="wrap">
      <p className="small"><Link to={`/${salon.slug}/team/kunden`}>← {t('staff.card.back')}</Link></p>
      <h1>{c.firstName} {c.lastName} {c.noShowCount > 0 && <span className="badge danger">{t('staff.noShows', { n: c.noShowCount })}</span>}</h1>
      {err && <p className="notice error" role="alert">{err}</p>}

      <section className="card" aria-labelledby="cc-contact">
        <h2 id="cc-contact">{t('staff.card.contact')}</h2>
        <dl className="kv">
          {c.phone && (<><dt>Telefon</dt><dd><a href={`tel:${c.phone}`}>{formatPhone(c.phone)}</a></dd></>)}
          {c.email && (<><dt>E-Mail</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></>)}
          <dt>{t('staff.card.since')}</dt><dd>{dt(c.createdAt)}</dd>
          <dt>{t('staff.card.privacyAck')}</dt><dd>{c.privacyAckAt ? dt(c.privacyAckAt) : '–'}</dd>
        </dl>
      </section>

      <section className="card" aria-labelledby="cc-up">
        <h2 id="cc-up">{t('staff.card.upcoming')}</h2>
        <ApptList items={upcoming} empty={t('staff.card.none')} />
      </section>

      <section className="card" aria-labelledby="cc-hist">
        <h2 id="cc-hist">{t('staff.card.history')}</h2>
        <ApptList items={history} empty={t('staff.card.none')} />
      </section>

      <EntrySection kind="color" title={t('staff.card.color')} hint={t('staff.card.colorHint')} entries={entries} me={me}
        onAdd={(body) => save(() => api(`/staff/customers/${id}/entries`, { method: 'POST', body: { kind: 'color', body } }))()}
        onDelete={(e) => save(async () => (confirm(t('staff.card.confirmDelete')) ? void (await api(`/staff/customers/${id}/entries/${e}`, { method: 'DELETE' })) : undefined))()} />

      <EntrySection kind="note" title={t('staff.card.notes')} hint={t('staff.card.notesHint')} entries={entries} me={me}
        onAdd={(body) => save(() => api(`/staff/customers/${id}/entries`, { method: 'POST', body: { kind: 'note', body } }))()}
        onDelete={(e) => save(async () => (confirm(t('staff.card.confirmDelete')) ? void (await api(`/staff/customers/${id}/entries/${e}`, { method: 'DELETE' })) : undefined))()} />

      <HealthSection key={c.health.consentAt ?? 'none'} health={c.health}
        onSave={(consent, notes) => save(() => api(`/staff/customers/${id}/health`, { method: 'PUT', body: { consent, notes } }))()} />
    </main>
  );
}

function ApptList({ items, empty }: { items: Card['appointments']; empty: string }) {
  const t = useT();
  const salon = useSalon();
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="plain">
      {items.map((a) => (
        <li key={a.id} className="list-item">
          <div style={{ flex: '1 1 240px' }}>
            <Link to={`/${salon.slug}/team?date=${a.date}`}><strong>{dateLong(a.date)}, {hm(a.start)}–{hm(a.end)}</strong></Link>
            <div className="small">{a.serviceLabel} · {a.stylist}</div>
            {a.colorNotes && <div className="small muted">„{a.colorNotes}“</div>}
          </div>
          <span className="badge">{t(`ui.status.${a.status}`)}</span>
          {a.locked && <span className="badge" title={t('staff.pastLocked')}>{t('staff.card.locked')}</span>}
        </li>
      ))}
    </ul>
  );
}

function EntrySection(p: { kind: 'color' | 'note'; title: string; hint: string; entries: Entry[]; me: { id: string; role: string }; onAdd: (body: string) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const t = useT();
  const [text, setText] = useState('');
  const add = useMutation({ mutationFn: async () => { await p.onAdd(text); setText(''); } });
  const list = p.entries.filter((e) => e.kind === p.kind);
  const fid = `ce-${p.kind}`;
  return (
    <section className="card" aria-labelledby={`${fid}-h`}>
      <h2 id={`${fid}-h`}>{p.title}</h2>
      <div className="field">
        <label htmlFor={fid} className="sr-only">{p.title}</label>
        <p id={`${fid}-hint`} className="note-hint">{p.hint}</p>
        <textarea id={fid} rows={2} maxLength={2000} aria-describedby={`${fid}-hint`} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <button type="button" className="btn primary" disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}>{t('staff.card.add')}</button>
      {list.length > 0 && (
        <ul className="plain" style={{ marginTop: 12 }}>
          {list.map((e) => (
            <li key={e.id} className="list-item">
              <div style={{ flex: '1 1 240px', whiteSpace: 'pre-wrap' }}>
                <div>{e.body}</div>
                <div className="small muted">{dt(e.createdAt)}{e.author && ` · ${t('staff.card.by')} ${e.author}`}</div>
              </div>
              {(p.me.role === 'owner' || p.me.id === e.authorId) && (
                <button type="button" className="btn" onClick={() => void p.onDelete(e.id)}>{t('staff.card.delete')}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HealthSection(p: { health: Card['customer']['health']; onSave: (consent: boolean, notes: string | null) => Promise<void> }) {
  const t = useT();
  const [consent, setConsent] = useState(!!p.health.consentAt);
  const [notes, setNotes] = useState(p.health.notes ?? '');
  const withdraw = async () => {
    if (!confirm(t('staff.card.confirmWithdraw'))) return;
    await p.onSave(false, null);
    setConsent(false);
    setNotes('');
  };
  return (
    <section className="card" aria-labelledby="ch-h">
      <h2 id="ch-h">{t('staff.card.health')}</h2>
      <p className="note-hint">{t('staff.card.healthHint')}</p>
      {p.health.consentAt ? (
        <p className="small">{t('staff.card.healthConsentSince')} {dt(p.health.consentAt)}</p>
      ) : (
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{t('staff.card.healthConsent')}</span>
        </label>
      )}
      <div className="field">
        <label htmlFor="ch-notes" className="sr-only">{t('staff.card.health')}</label>
        <textarea id="ch-notes" rows={3} maxLength={2000} disabled={!consent} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="row">
        <button type="button" className="btn primary" disabled={!consent} onClick={() => void p.onSave(true, notes)}>{t('staff.card.save')}</button>
        {p.health.consentAt && <button type="button" className="btn danger" onClick={() => void withdraw()}>{t('staff.card.healthWithdraw')}</button>}
      </div>
    </section>
  );
}
