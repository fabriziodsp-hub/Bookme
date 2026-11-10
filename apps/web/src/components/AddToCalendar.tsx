import { toInstant } from '@salon/engine';
import { useT } from '../lib/i18n';
import { useSalon } from '../lib/salon';
import type { PublicAppointment } from '../lib/types';

const gstamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * Add-to-calendar (D-024). Apple/iOS and Outlook: .ics from our server. Android: Google Calendar's
 * public "add event" page – opened only on click; nothing is sent to Google before that.
 */
export function AddToCalendar({ a, token }: { a: PublicAppointment; token: string }) {
  const t = useT();
  const salon = useSalon();
  const ics = `/api/s/${salon.slug}/appointments/${token}/calendar.ics`;
  const start = toInstant(a.date, a.start, salon.config.timeZone);
  const end = toInstant(a.date, a.end, salon.config.timeZone);
  const where = `${salon.profile.street}, ${salon.profile.postalCode} ${salon.profile.city}`;
  const google =
    'https://calendar.google.com/calendar/render?' +
    new URLSearchParams({
      action: 'TEMPLATE',
      text: a.serviceLabel,
      dates: `${gstamp(start)}/${gstamp(end)}`,
      ctz: salon.config.timeZone, // show/save the event in the salon's time zone, not the account's
      location: where,
      details: `Termin verschieben, absagen oder Salon kontaktieren:\n${window.location.origin}/${salon.slug}/termin/${token}\n\nTelefon: ${salon.profile.phoneDisplay}`,
    }).toString();
  return (
    <div className="stack" role="group" aria-label={t('ui.calendar.add')}>
      <h2>{t('ui.calendar.add')}</h2>
      <div className="row">
        <a className="btn" href={ics} download="termin.ics"> {t('ui.calendar.apple')}</a>
        <a className="btn" href={google} target="_blank" rel="noopener noreferrer">{t('ui.calendar.google')}</a>
        <a className="btn" href={ics} download="termin.ics">{t('ui.calendar.other')}</a>
      </div>
    </div>
  );
}
