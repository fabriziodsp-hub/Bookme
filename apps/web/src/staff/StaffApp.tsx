import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Route, Routes, useLocation, useParams } from 'react-router';
import { api, ApiError } from '../lib/api';
import { useT } from '../lib/i18n';
import { CalendarPage } from './CalendarPage';
import { CustomerCardPage } from './CustomerCardPage';
import { CustomersPage } from './CustomersPage';
import { useCalendar, useMe } from './hooks';
import { Login } from './Login';
import { RequestsPage } from './RequestsPage';
import { SettingsPage } from './SettingsPage';
import './staff.css';

export default function StaffApp() {
  const { slug = '' } = useParams();
  const t = useT();
  const qc = useQueryClient();
  const me = useMe();
  const homeKey = String((useLocation().state as { home?: number } | null)?.home ?? 'calendar');
  if (me.isLoading) return <div className="spin" role="status" />;
  if (me.error && !(me.error instanceof ApiError && me.error.status === 401)) return <p className="wrap notice error">{String(me.error.message)}</p>;
  if (!me.data) return <Login title={`${t('staff.area')} – ${t('staff.login')}`} slug={slug} />;
  if (me.data.tenant?.slug !== slug) {
    return (
      <main className="wrap">
        <p className="notice warn">{t('staff.wrongSalon')}</p>
        {me.data.tenant && <a className="btn" href={`/${me.data.tenant.slug}/team`}>{me.data.tenant.name}</a>}
      </main>
    );
  }
  const owner = me.data.role === 'owner';
  // Absolute paths: relative links inside this splat route ("team/*") would be appended to the current URL.
  const base = `/${slug}/team`;
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    qc.setQueryData(['me'], null);
  };
  return (
    <div className="staff">
      <div className="staff-bar wrap-wide">
        <nav className="staff-nav" aria-label={t('staff.area')}>
          <NavLink to={base} end className="tab"><Icon d={ICONS.calendar} />{t('staff.nav.calendar')}</NavLink>
          <NavLink to={`${base}/anfragen`} className="tab">
            <Icon d={ICONS.inbox} />{t('staff.nav.requests')} <RequestBadge />
          </NavLink>
          <NavLink to={`${base}/kunden`} className="tab"><Icon d={ICONS.people} />{t('staff.nav.customers')}</NavLink>
          {owner && <NavLink to={`${base}/einstellungen`} className="tab"><Icon d={ICONS.gear} />{t('staff.nav.settings')}</NavLink>}
          <button type="button" className="tab show-m" onClick={logout}><Icon d={ICONS.exit} />{t('staff.logout')}</button>
        </nav>
        <div className="staff-user hide-m">
          <span className="muted small hide-s">{me.data.displayName}</span>
          <button type="button" className="btn" onClick={logout}>{t('staff.logout')}</button>
        </div>
      </div>
      <Routes>
        {/* a new `home` (logo click) remounts the calendar → today, default view */}
        <Route index element={<CalendarPage key={homeKey} me={me.data} />} />
        <Route path="anfragen" element={<RequestsPage />} />
        <Route path="kunden" element={<CustomersPage owner={owner} />} />
        <Route path="kunden/:id" element={<CustomerCardPage me={me.data} />} />
        {owner && <Route path="einstellungen" element={<SettingsPage />} />}
      </Routes>
    </div>
  );
}

function RequestBadge() {
  const today = new Date().toISOString().slice(0, 10);
  const q = useCalendar(today, 1);
  const n = q.data?.openRequests ?? 0;
  return n ? <span className="badge warn" aria-label={`${n} offen`}>{n}</span> : null;
}

/** Simple line icons (24×24 paths) for the bottom tab bar on phones; decorative. */
const ICONS = {
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  inbox: 'M4 13h4l2 3h4l2-3h4M5 5h14l1 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6',
  exit: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
};

function Icon({ d }: { d: string }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
