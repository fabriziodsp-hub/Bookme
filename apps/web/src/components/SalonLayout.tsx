import { useEffect } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { errorMessage } from '../lib/api';
import { useT } from '../lib/i18n';
import { SalonProvider, useSalonQuery } from '../lib/salon';
import { ThemeProvider } from '../theme/ThemeProvider';
import { Splash } from './Splash';
import { ViewMenu } from './ViewMenu';

export function SalonLayout() {
  const { slug = '' } = useParams();
  const t = useT();
  const q = useSalonQuery(slug);
  // Logo = "home": staff go back to today's calendar, clients to the booking page (D-051).
  const inTeam = useLocation().pathname.startsWith(`/${slug}/team`);
  useEffect(() => {
    if (q.data) document.title = `${q.data.profile.name} – ${t('ui.appTitle')}`;
  }, [q.data, t]);

  if (q.isLoading) return <div className="spin" role="status" aria-label={t('ui.loading')} />;
  if (q.error || !q.data) {
    return (
      <main className="wrap" style={{ paddingTop: 48 }}>
        <h1>Salon nicht gefunden</h1>
        <p className="muted">{errorMessage(q.error)}</p>
      </main>
    );
  }
  const s = q.data;
  const logo = s.hasLogo ? `/api/s/${slug}/logo` : null;
  return (
    <SalonProvider value={s}>
      <ThemeProvider preset={s.theme.preset} accent={s.theme.accent}>
        <a className="skip" href="#main">{t('ui.skipToContent')}</a>
        <Splash logoUrl={logo} name={s.profile.name} />
        <header className="topbar">
          <Link to={inTeam ? `/${slug}/team` : `/${slug}`} state={inTeam ? { home: Date.now() } : undefined} className="brand">
            {logo && <img src={logo} alt="" />}
            <span>{s.profile.name}</span>
          </Link>
          <span className="spacer" />
          <ViewMenu />
        </header>
        <Outlet />
        <footer className="footer">
          <a href={`tel:${s.profile.phone}`}>{t('ui.callUs', { phone: s.profile.phoneDisplay })}</a>
          <Link to={`/${slug}/impressum`}>{t('ui.impressum')}</Link>
          <Link to={`/${slug}/datenschutz`}>{t('ui.privacy')}</Link>
        </footer>
      </ThemeProvider>
    </SalonProvider>
  );
}
