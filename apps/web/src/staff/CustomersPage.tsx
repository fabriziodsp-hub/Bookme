import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { useSalon } from '../lib/salon';
import { dateLong, hm, formatPhone } from '../lib/format';
import { useT } from '../lib/i18n';

interface Summary {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  noShowCount: number;
  appointmentCount: number;
  next: { date: string; start: number; serviceLabel: string } | null;
  last: { date: string; start: number; serviceLabel: string; status: string } | null;
}

/** Client search (S-9) + owner-only data export / deletion (Art. 15 / 17 DSGVO). */
export function CustomersPage({ owner }: { owner: boolean }) {
  const t = useT();
  const salon = useSalon();
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim());
  const [msg, setMsg] = useState<string | null>(null);
  const r = useQuery({ queryKey: ['customers', dq], queryFn: () => api<{ customers: Summary[] }>(`/staff/customers?q=${encodeURIComponent(dq)}`), enabled: dq.length >= 2 });
  const exportData = async (c: Summary) => {
    const data = await api(`/staff/customers/${c.id}/export`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `kunde-${c.lastName}-${c.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const anonymize = async (c: Summary) => {
    if (!confirm(t('staff.confirmAnonymize'))) return;
    try {
      await api(`/staff/customers/${c.id}/anonymize`, { method: 'POST' });
      setMsg(t('staff.saved'));
      void r.refetch();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <main id="main" className="wrap">
      <h1>{t('staff.nav.customers')}</h1>
      <label htmlFor="cs-q" className="sr-only">{t('staff.search')}</label>
      <input id="cs-q" type="search" placeholder={t('staff.search')} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {msg && <p className="notice" role="status">{msg}</p>}
      <div className="card" style={{ marginTop: 12 }} aria-live="polite" aria-busy={r.isFetching}>
        {dq.length < 2 ? (
          <p className="muted">Mindestens 2 Zeichen eingeben.</p>
        ) : !r.data?.customers.length ? (
          <p className="muted">Keine Treffer.</p>
        ) : (
          r.data.customers.map((c) => (
            <article key={c.id} className="list-item">
              <div style={{ flex: '1 1 260px' }}>
                <h2 style={{ fontSize: '1rem' }}>
                  <Link to={`/${salon.slug}/team/kunden/${c.id}`}>{c.firstName} {c.lastName}</Link> {c.noShowCount > 0 && <span className="badge danger">{t('staff.noShows', { n: c.noShowCount })}</span>}
                </h2>
                <p className="small muted" style={{ margin: 0 }}>
                  {c.phone && <a href={`tel:${c.phone}`}>{formatPhone(c.phone)}</a>} {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                </p>
                {c.next && <p className="small" style={{ margin: 0 }}>{t('staff.next')}: {dateLong(c.next.date)}, {hm(c.next.start)} – {c.next.serviceLabel}</p>}
                {c.last && <p className="small muted" style={{ margin: 0 }}>{t('staff.last')}: {dateLong(c.last.date)} – {c.last.serviceLabel} ({t(`ui.status.${c.last.status}`)})</p>}
              </div>
              {owner && (
                <div className="row">
                  <button type="button" className="btn" onClick={() => exportData(c)}>{t('staff.export')}</button>
                  <button type="button" className="btn danger" onClick={() => anonymize(c)}>{t('staff.anonymize')}</button>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </main>
  );
}
