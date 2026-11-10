/** Router error page (D-050): readable 404 instead of the developer message; other errors offer a reload. */
import { isRouteErrorResponse, Navigate, useLocation, useParams, useRouteError } from 'react-router';
import { useT } from './lib/i18n';

export function RouteError() {
  const t = useT();
  const err = useRouteError();
  // For an unmatched address no route matches, so there are no params: take the salon from the path.
  const first = useLocation().pathname.split('/')[1] ?? '';
  const slug = /^[a-z0-9-]{3,40}$/.test(first) && first !== 'admin' ? first : undefined;
  const notFound = isRouteErrorResponse(err) && err.status === 404;
  return (
    <main id="main" className="wrap" style={{ maxWidth: 560, paddingTop: 32 }}>
      <div className="card">
        <h1>{notFound ? t('staff.notFound') : t('staff.errorTitle')}</h1>
        <p>{notFound ? t('staff.notFoundText') : t('ui.error')}</p>
        <div className="row">
          {slug ? (
            <>
              <a className="btn primary" href={`/${slug}/buchen`}>{t('staff.toBooking')}</a>
              <a className="btn" href={`/${slug}/team`}>{t('staff.toTeam')}</a>
            </>
          ) : (
            <a className="btn primary" href="/">{t('staff.toStart')}</a>
          )}
          {!notFound && <button type="button" className="btn" onClick={() => window.location.reload()}>{t('staff.svc.reload')}</button>}
        </div>
      </div>
    </main>
  );
}

/** /{slug}/admin is a natural guess for the salon settings – send the owner there. */
export function SalonAdminRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/${slug}/team/einstellungen`} replace />;
}
