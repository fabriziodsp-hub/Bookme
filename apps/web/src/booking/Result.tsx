import { Link } from 'react-router';
import { useEffect, useRef } from 'react';
import { dateLong, hm, priceText } from '../lib/format';
import { useT } from '../lib/i18n';
import { useSalon } from '../lib/salon';
import type { PublicAppointment } from '../lib/types';

/** Result after sending a request: clearly "not yet confirmed" (spec C-1 AC7). */
export function Result({ r, onAnother }: { r: { appointment: PublicAppointment; manageToken: string }; onAnother: () => void }) {
  const t = useT();
  const salon = useSalon();
  const a = r.appointment;
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => h.current?.focus(), []);
  return (
    <section className="card accent" aria-labelledby="res-h">
      <h1 id="res-h" tabIndex={-1} ref={h}>
        <span aria-hidden="true">⏳ </span>
        {t('ui.sent')}
      </h1>
      <p>{t('ui.sentText')}</p>
      <dl className="kv">
        <dt>Termin</dt>
        <dd>
          <strong>{dateLong(a.date)}, {hm(a.start)} Uhr</strong> · {t('ui.endApprox', { time: hm(a.end) })}
        </dd>
        <dt>{t('ui.step.service')}</dt>
        <dd>{a.serviceLabel}</dd>
        {a.price && (
          <>
            <dt>{t('ui.price')}</dt>
            <dd>
              {priceText(a.price)}
              {a.price.birthdayDiscount && <> – {t('ui.birthdayPrice')} ({salon.config.birthdayDiscount.percent} %)</>}
            </dd>
          </>
        )}
        <dt>{t('ui.refCode')}</dt>
        <dd><strong>{a.refCode}</strong></dd>
      </dl>
      <p className="muted small" style={{ marginTop: 12 }}>{t('ui.calendar.onlyConfirmed')}</p>
      <div className="row" style={{ marginTop: 12 }}>
        <Link className="btn primary" to={`/${salon.slug}/termin/${r.manageToken}`}>{t('ui.manageLink')}</Link>
        <button type="button" className="btn" onClick={onAnother}>{t('ui.another')}</button>
      </div>
    </section>
  );
}
