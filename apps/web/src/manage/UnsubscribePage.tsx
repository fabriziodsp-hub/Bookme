import { useMutation } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { useT } from '../lib/i18n';
import { useSalon } from '../lib/salon';

/** Opt-out of the birthday offer. A POST (button) – link scanners in mail clients cannot unsubscribe by accident. */
export function UnsubscribePage() {
  const { token = '' } = useParams();
  const t = useT();
  const salon = useSalon();
  const m = useMutation({ mutationFn: () => api(`/s/${salon.slug}/unsubscribe/${token}`, { method: 'POST' }) });
  return (
    <main id="main" className="wrap">
      <section className="card">
        <h1>{t('ui.unsubscribe.title')}</h1>
        {m.isSuccess ? (
          <p role="status">{t('ui.unsubscribe.done')}</p>
        ) : (
          <>
            <p>{t('ui.unsubscribe.text')}</p>
            <button type="button" className="btn primary" disabled={m.isPending} onClick={() => m.mutate()}>{t('ui.unsubscribe.button')}</button>
            {m.error && <p className="notice error" role="alert">{errorMessage(m.error)}</p>}
          </>
        )}
      </section>
    </main>
  );
}
