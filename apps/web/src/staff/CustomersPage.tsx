import { useInfiniteQuery } from '@tanstack/react-query';
import { Fragment, useDeferredValue, useEffect, useRef, useState } from 'react';
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

/** Client list and search (S-9, D-056) + owner-only data export / deletion (Art. 15 / 17 DSGVO). */
export function CustomersPage({ owner }: { owner: boolean }) {
  const t = useT();
  const salon = useSalon();
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim());
  const [msg, setMsg] = useState<string | null>(null);
  const [sort, setSort] = useState<'name' | 'next'>('name');
  const term = dq.length >= 2 ? dq : '';
  const PAGE = 50;
  const r = useInfiniteQuery({
    queryKey: ['customers', term, sort],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<{ customers: Summary[]; hasMore: boolean }>(`/staff/customers?q=${encodeURIComponent(term)}&sort=${sort}&limit=${PAGE}&offset=${pageParam}`),
    getNextPageParam: (last, all) => (last.hasMore ? all.length * PAGE : undefined),
  });
  const list = r.data?.pages.flatMap((p) => p.customers) ?? [];
  // Load the next page when the end of the list scrolls into view (button as fallback).
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el || !r.hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && !r.isFetchingNextPage) void r.fetchNextPage(); }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [r, r.hasNextPage, r.isFetchingNextPage]);
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
      <div className="row" style={{ marginTop: 8 }}>
        <span className="small muted" id="cs-sort-l">{t('staff.customers.sortBy')}</span>
        <div className="seg" role="group" aria-labelledby="cs-sort-l">
          <button type="button" aria-pressed={sort === 'name'} onClick={() => setSort('name')}>{t('staff.customers.sortName')}</button>
          <button type="button" aria-pressed={sort === 'next'} onClick={() => setSort('next')}>{t('staff.customers.sortNext')}</button>
        </div>
      </div>
      {q.trim().length === 1 && <p className="small muted">{t('staff.customers.minChars')}</p>}
      {msg && <p className="notice" role="status">{msg}</p>}
      <p className="sr-only" aria-live="polite">{r.isSuccess ? t('staff.customers.count', { n: list.length }) + (r.hasNextPage ? '+' : '') : ''}</p>
      <div className="card" style={{ marginTop: 12 }} aria-busy={r.isFetching}>
        {r.isLoading ? (
          <div className="spin" role="status" aria-label={t('staff.customers.loading')} />
        ) : r.error ? (
          <p className="notice error" role="alert">{errorMessage(r.error)}</p>
        ) : !list.length ? (
          <p className="muted">{term ? 'Keine Treffer.' : t('staff.customers.empty')}</p>
        ) : (
          list.map((c, i) => {
            const letter = initial(c.lastName || c.firstName);
            const showLetter = sort === 'name' && letter !== initial(list[i - 1]?.lastName || list[i - 1]?.firstName || '');
            const H = sort === 'name' ? 'h3' : 'h2'; // under the A–Z headings, otherwise directly under h1
            return (
              <Fragment key={c.id}>
                {showLetter && <h2 className="cs-letter" aria-label={t('staff.customers.letter', { l: letter })}>{letter}</h2>}
                <article className="list-item">
                  <div style={{ flex: '1 1 260px' }}>
                    <H style={{ fontSize: '1rem' }}>
                      <Link to={`/${salon.slug}/team/kunden/${c.id}`}>{c.firstName} {c.lastName}</Link> {c.noShowCount > 0 && <span className="badge danger">{t('staff.noShows', { n: c.noShowCount })}</span>}
                    </H>
                    <p className="small muted" style={{ margin: 0 }}>
                      {c.phone && <a className="contact-link" href={`tel:${c.phone}`}>{formatPhone(c.phone)}</a>} {c.email && <a className="contact-link" href={`mailto:${c.email}`}>{c.email}</a>}
                    </p>
                    {c.next ? (
                      <p className="small" style={{ margin: 0 }}>{t('staff.next')}: {dateLong(c.next.date)}, {hm(c.next.start)} – {c.next.serviceLabel}</p>
                    ) : sort === 'next' ? (
                      <p className="small muted" style={{ margin: 0 }}>{t('staff.customers.noNext')}</p>
                    ) : null}
                    {c.last && <p className="small muted" style={{ margin: 0 }}>{t('staff.last')}: {dateLong(c.last.date)} – {c.last.serviceLabel} ({t(`ui.status.${c.last.status}`)})</p>}
                  </div>
                  {owner && (
                    <div className="row">
                      <button type="button" className="btn" onClick={() => exportData(c)}>{t('staff.export')}</button>
                      <button type="button" className="btn danger" onClick={() => anonymize(c)}>{t('staff.anonymize')}</button>
                    </div>
                  )}
                </article>
              </Fragment>
            );
          })
        )}
        {r.hasNextPage && (
          <div ref={more} className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
            <button type="button" className="btn" disabled={r.isFetchingNextPage} onClick={() => void r.fetchNextPage()}>{t('staff.customers.more')}</button>
          </div>
        )}
      </div>
    </main>
  );
}

/** First letter for the A–Z headings (umlauts under their base letter, others under "#"). */
function initial(name: string): string {
  const ch = name.trim().charAt(0).toLocaleUpperCase('de-DE').normalize('NFD').charAt(0);
  return /[A-Z]/.test(ch) ? ch : ch ? '#' : '';
}
