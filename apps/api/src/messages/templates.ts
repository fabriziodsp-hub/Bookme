/**
 * Message texts (German). Short, professional. Only the birthday offer is promotional (D-021).
 * Dates are always written in words.
 */
import { formatHm, type LocalDate, type Minute } from '@salon/engine';
import type { SalonProfile } from '@salon/config';
import { dateTimeInWords } from './format.js';

export interface MessageContext {
  firstName: string;
  lastName: string;
  date: LocalDate;
  start: Minute;
  end: Minute;
  serviceLabel: string;
  refCode: string;
  manageUrl: string | null;
  salon: SalonProfile;
  restricted: boolean;
  price?: { cents: number; isFrom: boolean; birthdayPercent: number } | null;
  /** Fee in cents if the client accepted a fee rule. */
  fee?: number | null;
  reason?: string | null;
}

export type Template =
  | 'request_received'
  | 'confirmation'
  | 'discuss'
  | 'declined'
  | 'expired'
  | 'reminder'
  | 'changed'
  | 'cancelled'
  | 'age_check';

const euro = (cents: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

const sign = (s: SalonProfile) => `\n\nViele Grüße\nIhr Team von ${s.name}\n${s.street}, ${s.postalCode} ${s.city}\nTel. ${s.phoneDisplay}`;

const when = (c: MessageContext) => `${dateTimeInWords(c.date, c.start)} (Ende ca. ${formatHm(c.end)} Uhr)`;

const manage = (c: MessageContext) => (c.manageUrl ? `\n\nTermin ansehen, verschieben oder absagen:\n${c.manageUrl}` : '');

const priceLine = (c: MessageContext) => {
  if (!c.price) return '';
  const base = `${c.price.isFrom ? 'ab ' : ''}${euro(c.price.cents)}`;
  if (!c.price.birthdayPercent) return `\nPreis: ${base}`;
  const disc = Math.round(c.price.cents * (1 - c.price.birthdayPercent / 100));
  return `\nPreis: ${base} – mit Ihrem Geburtstagsrabatt (${c.price.birthdayPercent} %): ${c.price.isFrom ? 'ab ' : ''}${euro(disc)}`;
};

const feeLine = (c: MessageContext) =>
  c.fee ? `\n\nHinweis: Bei Nichterscheinen oder Absage weniger als 48 Stunden vorher fällt eine Ausfallgebühr von ${euro(c.fee)} an.` : '';

const idNote = (c: MessageContext) =>
  c.restricted ? '\n\nHinweis: Für diese Behandlung verwenden wir chemische Produkte (z. B. Haarfarben), die laut Hersteller nicht für Personen unter 16 Jahren bestimmt sind – sie können schwere allergische Reaktionen auslösen.' : ''; // D-062: notice instead of an ID check

/** Note from the salon (accept / decline / Rücksprache), shown prominently. */
const noteLine = (c: MessageContext) => (c.reason ? `\n\nNotiz vom Salon:\n${c.reason}` : '');
const details = (c: MessageContext) => `${c.serviceLabel}\n${when(c)}${priceLine(c)}\nBuchungsnummer: ${c.refCode}`;

export function renderMessage(t: Template, c: MessageContext): { subject: string; body: string; short: string } {
  const hello = `Guten Tag ${c.firstName} ${c.lastName},`;
  const dt = dateTimeInWords(c.date, c.start);
  switch (t) {
    case 'request_received':
      return {
        subject: `Ihre Terminanfrage ${c.refCode} – noch nicht bestätigt`,
        body: `${hello}\n\nvielen Dank für Ihre Anfrage. Der Termin ist für Sie reserviert, aber noch NICHT bestätigt. Wir melden uns so schnell wie möglich.\n\n${details(c)}${feeLine(c)}${idNote(c)}${manage(c)}${sign(c.salon)}`,
        short: `${c.salon.name}: Anfrage für ${dt} erhalten – noch nicht bestätigt.`,
      };
    case 'confirmation':
      return {
        subject: `Termin bestätigt: ${dt}`,
        body: `${hello}\n\nIhr Termin ist bestätigt:${noteLine(c)}\n\n${details(c)}${feeLine(c)}${idNote(c)}\n\nDen Termin können Sie mit der angehängten Datei (termin.ics) in Ihren Kalender übernehmen.${manage(c)}${sign(c.salon)}`,
        short: `${c.salon.name}: Termin bestätigt, ${dt}. Nr. ${c.refCode}`,
      };
    case 'discuss':
      return {
        subject: `Ihre Terminanfrage ${c.refCode}: Rücksprache`,
        body: `${hello}\n\nzu Ihrer Anfrage möchten wir kurz mit Ihnen sprechen. Ihr Termin bleibt bis dahin reserviert. Wir melden uns bei Ihnen – oder rufen Sie uns gern an: ${c.salon.phoneDisplay}.${noteLine(c)}\n\n${details(c)}${manage(c)}${sign(c.salon)}`,
        short: `${c.salon.name}: Zu Ihrer Anfrage (${dt}) melden wir uns kurz bei Ihnen.`,
      };
    case 'declined':
      return {
        subject: `Ihre Terminanfrage ${c.refCode} ist leider nicht möglich`,
        body: `${hello}\n\nleider können wir Ihre Anfrage für ${dt} (${c.serviceLabel}) nicht annehmen.${noteLine(c)}\n\nGern finden wir einen anderen Termin – online oder telefonisch unter ${c.salon.phoneDisplay}.${sign(c.salon)}`,
        short: `${c.salon.name}: Ihre Anfrage für ${dt} ist leider nicht möglich.`,
      };
    case 'expired':
      return {
        subject: `Ihre Terminanfrage ${c.refCode} ist abgelaufen`,
        body: `${hello}\n\nleider konnten wir Ihre Anfrage für ${dt} (${c.serviceLabel}) nicht rechtzeitig bestätigen. Die Reservierung ist abgelaufen. Bitte entschuldigen Sie – rufen Sie uns gern an: ${c.salon.phoneDisplay}.${sign(c.salon)}`,
        short: `${c.salon.name}: Ihre Anfrage für ${dt} ist abgelaufen.`,
      };
    case 'reminder':
      return {
        subject: `Erinnerung: Ihr Termin am ${dt}`,
        body: `${hello}\n\nwir freuen uns auf Sie:\n\n${details(c)}${feeLine(c)}${idNote(c)}${manage(c)}${sign(c.salon)}`,
        short: `${c.salon.name}: Erinnerung an Ihren Termin ${dt}.`,
      };
    case 'changed':
      return {
        subject: `Termin geändert: ${dt}`,
        body: `${hello}\n\nIhr Termin wurde verschoben. Neuer Termin:\n\n${details(c)}${manage(c)}${sign(c.salon)}`,
        short: `${c.salon.name}: Termin verschoben auf ${dt}.`,
      };
    case 'cancelled':
      return {
        subject: `Termin abgesagt: ${dt}`,
        body: `${hello}\n\nIhr Termin am ${dt} (${c.serviceLabel}) ist abgesagt.\nBuchungsnummer: ${c.refCode}${sign(c.salon)}`,
        short: `${c.salon.name}: Ihr Termin ${dt} ist abgesagt.`,
      };
    case 'age_check':
      return {
        subject: `Ihr Termin am ${dt}: Altersnachweis`,
        body: `${hello}\n\nfür Ihre Behandlung (${c.serviceLabel}) benötigen wir einen Altersnachweis. Bitte bringen Sie zu Ihrem Termin einen amtlichen Ausweis mit. Ohne Nachweis können wir die Behandlung leider nicht durchführen.${sign(c.salon)}`,
        short: `${c.salon.name}: Bitte bringen Sie zu Ihrem Termin ${dt} einen Ausweis mit.`,
      };
  }
}

/** Birthday offer – the only promotional message; requires opt-in, carries an unsubscribe link. */
export function renderBirthday(c: { firstName: string; lastName: string; percent: number; monthName: string; bookUrl: string; unsubscribeUrl: string; salon: SalonProfile }) {
  return {
    subject: `Alles Gute zum Geburtstag – ${c.percent} % auf einen Termin im ${c.monthName}`,
    body:
      `Guten Tag ${c.firstName} ${c.lastName},\n\nalles Gute zu Ihrem Geburtstag! Im ${c.monthName} erhalten Sie ${c.percent} % Rabatt auf einen Termin.` +
      ` Der Rabatt wird automatisch berücksichtigt, wenn Ihr Termin im ${c.monthName} liegt.\n\nTermin anfragen: ${c.bookUrl}` +
      `\n\nSie möchten diese Nachricht nicht mehr erhalten? Abmelden: ${c.unsubscribeUrl}${sign(c.salon)}`,
  };
}

/** Digest for staff: open requests (D-027). */
export function renderStaffDigest(c: { salon: SalonProfile; items: { refCode: string; when: string; name: string; service: string; status: string }[]; url: string }) {
  const lines = c.items.map((i) => `• ${i.when} – ${i.name} – ${i.service} (${i.status}, ${i.refCode})`).join('\n');
  return {
    subject: `${c.items.length} offene Terminanfrage${c.items.length === 1 ? '' : 'n'}`,
    body: `Offene Anfragen bei ${c.salon.name}:\n\n${lines}\n\nJetzt beantworten: ${c.url}\n\nUnbeantwortete Anfragen laufen 48 Stunden nach dem Eingang ab.`,
  };
}
