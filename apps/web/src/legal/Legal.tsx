/**
 * DRAFTS – not legal advice. Must be reviewed by a lawyer before going live (README, docs/legal.md).
 * The salon is the controller; the platform operator is a processor (Art. 28 DSGVO).
 */
import { useSalon } from '../lib/salon';

function DraftBanner() {
  return (
    <p className="notice warn" role="note">
      <strong>Entwurf.</strong> Dieser Text ist eine Vorlage und keine Rechtsberatung. Er muss vor der Veröffentlichung rechtlich geprüft und ergänzt werden.
    </p>
  );
}

export function Impressum() {
  const { profile: p } = useSalon();
  return (
    <main id="main" className="wrap">
      <article className="card">
        <h1>Impressum</h1>
        <DraftBanner />
        <h2>Angaben gemäß § 5 DDG</h2>
        <p>
          {p.legalName}
          <br />
          {p.street}
          <br />
          {p.postalCode} {p.city}
        </p>
        <h2>Kontakt</h2>
        <p>
          Telefon: {p.phoneDisplay}
          <br />
          E-Mail: {p.email}
        </p>
        <h2>Berufsrechtliche Angaben</h2>
        <p>
          Berufsbezeichnung: Friseurin/Friseur (verliehen in Deutschland). Zuständige Kammer: {p.chamber}. Eintragung in der Handwerksrolle: [Nummer ergänzen]. Umsatzsteuer-ID: [ergänzen, falls vorhanden].
        </p>
        <h2>Verbraucherstreitbeilegung</h2>
        <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen. [prüfen]</p>
        <h2>Technischer Betrieb</h2>
        <p>Die Buchungsplattform wird im Auftrag des Salons betrieben von: [Name und Anschrift des Plattformbetreibers ergänzen].</p>
      </article>
    </main>
  );
}

export function Privacy() {
  const { profile: p, config } = useSalon();
  return (
    <main id="main" className="wrap">
      <article className="card">
        <h1>Datenschutzerklärung</h1>
        <DraftBanner />
        <h2>1. Verantwortlicher</h2>
        <p>
          {p.legalName}, {p.street}, {p.postalCode} {p.city}, {p.email}, {p.phoneDisplay}. Die Plattform wird von [Plattformbetreiber] als Auftragsverarbeiter (Art. 28 DSGVO) betrieben.
        </p>
        <h2>2. Welche Daten wir verarbeiten</h2>
        <ul>
          <li>Für eine Terminanfrage: Vorname, Nachname, Telefon und/oder E-Mail, gewählte Leistung und Termin, die Angabe „volljährig ja/nein“, freiwillige Hinweise zur Haarbehandlung.</li>
          <li>Bei Leistungen mit Ausfallgebühr (Balayage): Ihre Zustimmung mit Zeitpunkt und Wortlaut.</li>
          <li>Nur mit Ihrer Einwilligung: Ihr Geburtsmonat (nicht das Geburtsdatum) für den Geburtstagsrabatt.</li>
          <li>Kundenkarte im Salon (nur für das Team sichtbar): Ihre Termine (vergangene und kommende), Kontaktdaten sowie Notizen des Teams zur Behandlung, z. B. verwendete Farben und Mengen.</li>
          <li>Nur mit Ihrer ausdrücklichen, schriftlichen Einwilligung im Salon: Angaben zu Allergien und Unverträglichkeiten (Gesundheitsdaten). Sie können die Einwilligung jederzeit widerrufen; die Angaben werden dann gelöscht.</li>
          <li>Bei einer Altersprüfung vor Ort speichern wir nur das Ergebnis (geprüft / nicht volljährig / kein Ausweis), keine Ausweisdaten.</li>
          <li>Technisch notwendige Server-Protokolle (IP-Adresse kurzzeitig zur Missbrauchsabwehr).</li>
        </ul>
        <h2>3. Zwecke und Rechtsgrundlagen</h2>
        <ul>
          <li>Terminvereinbarung, Bestätigung, Erinnerung und Änderungen: Art. 6 Abs. 1 lit. b DSGVO (Vertrag bzw. vorvertragliche Maßnahmen).</li>
          <li>Kundenkarte mit Terminhistorie und Behandlungsnotizen (z. B. Farbrezeptur), damit wir Ihre Behandlung gleichbleibend fortführen können: Art. 6 Abs. 1 lit. b und lit. f DSGVO (berechtigtes Interesse an einer fachgerechten Behandlung).</li>
          <li>Allergien und Unverträglichkeiten: Art. 9 Abs. 2 lit. a DSGVO (ausdrückliche Einwilligung).</li>
          <li>Geburtstagsangebot (eine E-Mail pro Jahr): Art. 6 Abs. 1 lit. a DSGVO (Einwilligung), jederzeit widerruflich über den Abmeldelink.</li>
          <li>Missbrauchsabwehr (Anfragebegrenzung, Rechenaufgabe ohne Drittanbieter): Art. 6 Abs. 1 lit. f DSGVO.</li>
        </ul>
        <h2>4. Empfänger</h2>
        <p>Hosting und E-Mail-Versand durch Dienstleister mit Sitz/Servern in der EU auf Grundlage von Auftragsverarbeitungsverträgen: [Anbieter ergänzen]. Keine Weitergabe zu Werbezwecken.</p>
        <h2>5. Speicherdauer</h2>
        <p>Kundendaten einschließlich der Kundenkarte werden 12 Monate nach dem letzten Termin anonymisiert, sofern keine gesetzliche Aufbewahrungspflicht besteht oder eine offene Forderung (Ausfallgebühr) bis zu ihrer Verjährung aufbewahrt werden muss. Versandprotokolle von E-Mails werden nach 30 Tagen gelöscht.</p>
        <h2>6. Cookies und lokale Speicherung</h2>
        <p>
          Für Kundinnen und Kunden setzen wir keine Cookies und kein Tracking ein. Im Browser gespeichert werden nur Ihre Ansichtseinstellungen (Textgröße, Kontrast) – auf Ihren Wunsch und nur auf Ihrem Gerät (§ 25 Abs. 2 Nr. 2 TDDDG). Für Mitarbeitende wird ein technisch notwendiges Sitzungs-Cookie verwendet.
        </p>
        <h2>7. Google Kalender</h2>
        <p>Nur wenn Sie auf „Google Kalender“ klicken, öffnet sich eine Seite von Google mit den Termindaten. Vorher werden keine Daten an Google übermittelt.</p>
        <h2>8. Minderjährige</h2>
        <p>Für Minderjährige verarbeiten wir dieselben, minimalen Daten. Werbliche Angebote (Geburtstagsrabatt) gibt es nur für Volljährige.</p>
        <h2>9. Ihre Rechte</h2>
        <p>Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch und Widerruf erteilter Einwilligungen (Art. 15–21 DSGVO). Wenden Sie sich an {p.email}. Sie haben das Recht auf Beschwerde bei einer Datenschutz-Aufsichtsbehörde.</p>
        <p className="muted small">Zeitzone der Termine: {config.timeZone}.</p>
      </article>
    </main>
  );
}
