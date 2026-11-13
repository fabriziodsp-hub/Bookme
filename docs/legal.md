# Legal & privacy notes (drafts – not legal advice)

> Nothing in this repository is legal advice. The Impressum and Datenschutzerklärung pages (`apps/web/src/legal/Legal.tsx`) are **templates** marked as drafts in the UI. Have them, the fee wording and the processor agreement reviewed by a lawyer before going live.

## Roles under the DSGVO

- **Salon** = controller (Verantwortlicher) for its clients' data.
- **Platform operator** ("wir, die die Seite betreiben") = processor (Auftragsverarbeiter). Needed: a **data processing agreement (AVV, Art. 28 DSGVO)** with every salon, a list of sub-processors (hosting, e-mail), and technical/organisational measures (TOM).
- Sub-processors must be in the EU or covered by adequate safeguards. WhatsApp Business (disabled) would add Meta as a recipient – separate assessment needed.

## Data minimisation in the implementation

| Data | Why | Retention |
|---|---|---|
| First/last name, phone and/or e-mail | booking, confirmation, change, reminder | anonymised 12 months after the last appointment (`retentionMonths`); with an open fee claim until the claim is time-barred (see below) |
| "Volljährig ja/nein" | health-related service restriction | with the appointment |
| Colour notes (optional, ≤ 500 chars) | time planning | with the appointment; removed on anonymisation |
| Age-check **outcome only** | proof the check happened | with the appointment; no ID data is ever stored |
| Fee consent timestamp + wording version | proof of the agreement | with the appointment |
| Birth **month** (opt-in, adults only) | birthday discount | until opt-out / anonymisation |
| IP address | rate limiting in memory only | not persisted |
| Privacy-notice acknowledgement (timestamp + text version) | proof the Art. 13 notice was shown | with the client |
| Client card entries: colour recipes, team notes | consistent treatment (Art. 6(1)(b)/(f)) | until anonymisation |
| Allergies / intolerances (health data) | safe treatment – **only with explicit consent** (Art. 9(2)(a)), consent timestamp + staff member | until consent is withdrawn (then deleted) or anonymisation |

Legal bases: Art. 6(1)(b) for bookings and transactional messages; Art. 6(1)(a) for the birthday offer (consent, opt-out link in every offer e-mail, § 7 UWG); Art. 6(1)(f) for abuse protection.

No trackers, no third-party scripts, fonts or CDNs. The only browser storage on the client side holds the visitor's own view settings and the "splash seen" flag (§ 25 Abs. 2 Nr. 2 TDDDG – requested functionality). Staff use a strictly necessary session cookie. Staff devices also keep the calendar view ("Ganzer Tag"/"Klassisch", D-060) and, after "Profil wechseln", the colleague's user name until the login page has shown it (sessionStorage, D-055) – both requested functionality, nothing sent anywhere.

Rights: export (Art. 15) and anonymisation (Art. 17) are available to the salon owner in the client search.

**Staff accounts** (employees of the salon, Art. 88 DSGVO / § 26 BDSG): display name, e-mail (mandatory for every login), optional **user name** (D-049, unique within the salon, chosen by the owner), password hash (Argon2id), role, sessions. Kept while the person works in the salon; when they leave the owner deactivates or **deletes the profile** (D-054): the login data (e-mail, user name, password hash, sessions) are erased; only the display name stays on past appointments as the salon's record of who did the work (Art. 6(1)(c)/(f), commercial and tax records). A person without any appointments is removed completely. The colleague list for "Profil wechseln" (D-055) shows names and user names to logged-in staff only, no e-mails. Personal working hours and absences (D-071) are employee data (§ 26 BDSG): only the owner enters them; staff see only "Urlaub", "Krank" etc. as a block in the calendar, without diagnosis. Internal calendar notes (D-072) are team-only and must not contain client health data. The user name is only a second way to log in – password resets and notices still go to the e-mail.

**Staff on the public homepage** (D-052): only with the person's consent (the owner ticks "Auf der Startseite zeigen" after asking; off by default, withdrawable at any time) and only under a public name they choose (first name or nickname). Full names, e-mails and roles are never public; the public salon configuration contains no staff data at all. The salon should keep the consent (e.g. a short written note) – § 26 BDSG / Art. 7 DSGVO.

## Retention: why not 10 years (A-07)

The owner asked for 10 years. The German 10-year duty (§ 147 AO, § 257 HGB) applies to **accounting records**: books, annual statements, and – since the Bürokratieentlastungsgesetz IV, from 2025 – **8 years** for Buchungsbelege (invoices, receipts, till data); business letters 6 years. It does not cover appointment and contact data, which are not accounting records. For those the DSGVO principle of storage limitation applies (Art. 5(1)(e), Art. 17): delete when no longer needed.

The app therefore:
- anonymises clients `retentionMonths` (default 12, max 120) after their last appointment;
- keeps clients with an **open fee claim** until the claim is time-barred: 3 years from the end of the year it arose (§§ 195, 199 BGB) – `feeClaimRetentionYears`;
- does not produce invoices or till receipts. If the salon issues an invoice for a fee, that invoice is kept in the salon's accounting for 8 years, outside this app.

Sources: IHK Karlsruhe (BEG IV, 8 years for Buchungsbelege), ZDH/Handwerkskammer guidance on Löschkonzepte. **To be confirmed by the salon's tax adviser.**

## Consent at booking – what is (not) needed (owner request 2026-11-07)

- **Booking data does not need consent.** The legal basis is the contract (Art. 6(1)(b)). Asking for "consent" would be wrong: consent can be withdrawn at any time, the booking cannot depend on it. What is required is **information** (Art. 13). The booking form therefore has a mandatory checkbox *"Ich habe die Datenschutzhinweise gelesen"*; the timestamp and the text version (`privacy-v2-2026-11`) are stored on the client.
- **Cookies:** clients get no cookies and no tracking. Only their own view settings are kept in the browser (§ 25(2) Nr. 2 TDDDG, requested by the user); staff use a strictly necessary session cookie. **No cookie banner is needed.** Adding analytics or third-party embeds later would change this.
- **Allergies are health data** (Art. 9). They are stored only after staff confirm the client's explicit consent; the salon keeps the written consent. Withdrawal deletes the notes. A consent form for the salon should be drafted with the lawyer.

## Minors (changed 2026-11-11, D-062)

No age question and no ID check any more (owner decision): fewer data, no document handling. Services with chemical products (colour, highlights, Balayage, perm) show the notice from the hair-dye labelling of Regulation (EC) 1223/2009 Annex III ("nicht für Personen unter 16 Jahren bestimmt", risk of severe allergic reactions) in the booking, on the appointment page and in the e-mails – it is information, not a ban (there is no statutory ban on dyeing the hair of under-16s; the professional association advises caution for product-liability reasons). The salon decides at the appointment. Birthday offers: the opt-in text asks the client to confirm being at least 16 (Art. 8 DSGVO, § 7 UWG consent). Open legal point: a fee agreement (Balayage) with a minor needs the parents' consent (§§ 107, 108 BGB) – the salon should not book Balayage for minors.

## Balayage no-show / late-cancellation fee (D-020)

German consumer law allows a flat-rate fee only if it was **explicitly agreed** before the contract and does not exceed the typically expected damage; the client must be allowed to prove a lower damage (§ 309 Nr. 5 BGB). Implementation:
- mandatory checkbox with the full wording at booking; stored with timestamp and version (`fee-v1`);
- the wording includes the right to prove a lower damage;
- no money is collected in the app – the fee is only recorded as due/paid/waived;
- amount (owner decision 2026-10-28) = typical damage, computed from the config formula and frozen on the appointment at booking:

| Part | Calculation | Amount |
|---|---|---|
| Staff cost of the blocked half day | 4 h × 13,90 € (Mindestlohn 2026) × 1,23 (employer share ≈ 21 % social security + ≈ 2 % levies/accident insurance) | 68,39 € |
| Lost profit share | 15 % × 190 € (demo Balayage price; owner range 10–20 %) | 28,50 € |
| **Fee** | rounded up to full euros | **97 €** (10 % → 88 €, 20 % → 107 €) |

- § 309 Nr. 5 BGB measures the flat rate against the damage "expected in the normal course of events". The real damage of a no-show is the lost profit (price minus saved costs), reduced by any replacement booking. The formula above stays well below the price and is easier to defend than 150 €. The minimum wage is the parameter `hourlyWageCents` and must be updated when it changes (14,60 € from 1 January 2027).
- open legal questions: wording in the salon's AGB. **Lawyer review required.**

## BFSG (Barrierefreiheitsstärkungsgesetz, in force since 28 June 2025)

According to IHK Berlin, micro-enterprises (< 10 employees and ≤ 2 M € turnover/balance sheet) offering services are exempt. A single salon is therefore probably exempt. **Open question:** whether the platform operator, offering the booking service to consumers on behalf of many salons, is itself in scope. The app is built to WCAG 2.2 AA regardless (axe tests, manual checklist in `accessibility.md`).

## Impressum

Required fields (§ 5 DDG) are prepared from the salon profile; for Friseure additionally the chamber (Handwerkskammer) and the Handwerksrolle entry. The operator's details belong in a separate operator Impressum.

## Review 2026-11-10 (security & legal, not legal advice)

- **Fixed:** behind a proxy (`TRUST_PROXY=true`, e.g. the demo tunnel) the client IP for rate limits was taken from the *first* `X-Forwarded-For` entry, which the client can forge. Now the right-most entry (added by our proxy) is used. Login lockout was not affected (it counts per account).
- **Fixed:** the dev mailbox (`/api/dev/mailbox`, demo only) was readable without login and showed all salons' e-mails, including clients' personal management links. Now staff only, own salon only.
- **Online demo (tunnel):** traffic passes through Cloudflare (US company, EU–US Data Privacy Framework). Fine for a demo with invented data; not for real client data. The demo passwords are public – anyone with the link can change the demo data (reset: `docker compose down -v`, then start again).
- **Still open before going live:** Impressum and Datenschutz placeholders (`[Plattformbetreiber]`, `[Anbieter ergänzen]`, Verbraucherstreitbeilegung `[prüfen]`), EU hosting and e-mail provider with AVV, lawyer review of the fee clause (§ 309 Nr. 5 BGB) and the allergy consent form, retention A-07, BFSG question for the platform operator.
- **Correct as it is:** no link to the EU online dispute resolution platform (the platform was shut down in July 2025, so the old link duty no longer applies); no cookie banner needed (no tracking, only necessary storage); birthday offers only with recorded consent and an unsubscribe link.
