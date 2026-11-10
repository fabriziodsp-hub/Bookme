# Specification – Salon booking platform

> Version 1.2 · 2026-10-28 · Status: draft. Assumptions marked **[A-xx]** need owner confirmation (§10).
> Sources of truth: the project brief, `reference/prototype.html` (business rules and interaction), `docs/research.md` (feature decisions) and the owner's answers of 2026-10-27 (decisions D-018 … D-030).
>
> **v1.2 changes (owner answers 2026-10-28):** cut durations per audience; Strähnen with two sizes + cut; Strähnen/Dauerwelle also for men; Balayage fee derived from the typical damage instead of 150 €; client reschedule re-confirmation only from 60′; retention clarified (§8); free client slots outlined.
>
> **v1.1 changes:** multi-salon platform; staff approval of every online request; Balayage no-show/late-cancellation fee; birthday discount as the only marketing; theming + visitor accessibility settings; logo splash; price list and opening hours editable by each salon; e-mail only (WhatsApp prepared, off); add-to-calendar buttons.

## 1. Goal and scope

A booking platform for hair salons in Germany. **One installation serves many salons** ("tenants"); each salon has its own booking page (`/{salon-slug}`), branding, price list, opening hours, staff and data. Clients book without an account; every online booking is a **request** that the salon accepts, declines or marks for discussion. The UI is German (de-DE), with i18n ready for Italian and English. Launch with one active salon; the model supports N salons and N stylists per salon from day one.

**In scope:** booking requests, staff approval, transactional e-mails, self-service reschedule/cancel via link, add-to-calendar, staff calendar (day/week, drag & drop per phase, keyboard alternative, undo), absences, no-show tracking incl. Balayage fee record, internal notes, client search, age-check logging, birthday discount, salon admin (price list, opening hours), platform admin (salons, logos, services and durations), theming and visitor accessibility settings, demo seed, legal drafts.

**Out of scope:** online payment, deposits, card-on-file (D-002), SMS, marketplace, marketing other than the birthday discount, waitlist, POS/TSE, gift cards, loyalty, AI receptionist, staff calendar sync. WhatsApp: interface prepared, disabled (D-029).

## 2. Roles

| Role | German UI label | Authentication | Can |
|---|---|---|---|
| Client | Kunde / Kundin | none; possession of a signed management link | send a booking request; view, reschedule, cancel own appointment until cut-off |
| Stylist | Stylist/in | staff login (session), one salon | calendar; accept/decline/discuss requests; create/move/resize/cancel; no-show/completed; notes; absences; age check |
| Owner | Inhaber/in | staff login, role `owner`, one salon | everything a stylist can for all stylists of the salon; **price list; opening hours and breaks**; theme choice; staff accounts; client data export/deletion |
| Platform admin | Betreiber | staff login, role `platform_admin`, no salon | create/disable salons; **upload logos (only this role)**; services, durations and rules per salon; impersonation is **not** offered |

The client UI hides the stylist choice while exactly one stylist is active (D-007).

## 3. Business rules

Each salon has a configuration validated by `@salon/engine` (Zod). New salons start from the template in `packages/config/src/salon.config.ts`; the platform admin adapts services and durations, the owner adapts opening hours (D-019). The rules below are the defaults of the template and of the first salon.

### 3.1 Calendar
- Time zone `Europe/Berlin` (per salon). Instants stored as UTC (`timestamptz`); rules evaluated in local wall time.
- Opening hours: Mon–Fri 08:00–17:00 with break 12:00–13:00; Sat 08:00–14:00, no break; Sun closed.
- No block of an appointment (busy **or** free, incl. Einwirkzeit) may overlap a break, lie outside opening hours, or overlap an absence (A-13).
- Conflicts between appointments only consider **busy** blocks; a free block (Einwirkzeit) of client A may overlap a busy block of client B.
- Client slot grid 15′, staff edit grid 5′; same-day lead time 30′; client horizon 364 days.
- DST: the config validator rejects opening hours containing non-existent or ambiguous local times.
- Changing opening hours never moves existing appointments; the owner sees a list of appointments that would lie outside the new hours before saving.

### 3.2 Services (template)

| ID | Service (UI) | Audience | Blocks (busy ■ / free □) | Total |
|---|---|---|---|---|
| `cut` | Haarschnitt | Damen, Herren | Damen: ■ 30′ ohne Waschen / ■ 45′ mit Waschen (incl. Föhnen). Herren: ■ 30′ with or without wash (A-01) | 30–45′ |
| `wash_set` | Waschen & Legen | Damen | ■ 30′, without cut (A-02) | 30′ |
| `color_root` | Schnitt & Farbe – Ansatz | Damen, Herren | ■ 45′ → □ 30′ Einwirkzeit → ■ 30′ Styling (45′ mit Veredelung) | 105–120′ |
| `color_full` | Schnitt & Farbe – Ansatz bis Spitzen | Damen, Herren | ■ 60′ → □ 30′ → ■ 30/45′ | 120–135′ |
| `highlights` | Strähnen | Damen, Herren (A-03) | ■ 45′ Oberkopf & Konturen / 60′ ganzer Kopf → □ 30′ Einwirkzeit → ■ 30′ Schnitt → ■ 30/45′ Styling (A-04; phase order is an assumption) | 135–165′ |
| `balayage` | Balayage | Damen only (A-03) | ■ 240′ consecutive; start only 08:00 or 13:00; Saturday only 08:00. **Ausfallgebühr** computed (§3.6) | 240′ |
| `perm` | Dauerwelle (Locken) | Damen, Herren (A-03) | ■ Schnitt 30′ → ■ Wickler 30′ → ■ Einwirkzeit 15′ (busy) → ■ Ausspülen & Fixierung 15′ → ■ Styling 30′ | 120′ |

- *Veredelung* ("Glossing/Mattierung") only for the colour chain; Styling 30′ → 45′.
- **Age restriction:** colour, highlights, balayage, perm are not offered to minors. "Volljährig (ab 18)" / "Minderjährig (unter 18)" is asked **before** services; the API enforces it too.
- Colour notes (optional, ≤ 500 chars) only for colour chain, balayage and perm.
- ID hint for restricted services: "Bitte Ausweis mitbringen: Bei Zweifeln am angegebenen Alter behalten wir uns eine Altersprüfung vor. Ohne Nachweis kann die Behandlung nicht durchgeführt werden."

### 3.3 Prices
- Each salon maintains its own price list in the owner admin (D-030): one price per service, optionally per variant (e.g. Haarschnitt ohne/mit Waschen) and a surcharge for the finish; each price can be marked "ab" (from), e.g. for long hair.
- Clients see the price (or "ab …") next to the service and in the summary; services without a price show no price.
- Prices are informative: no payment happens in the app.

### 3.4 Client data
First name, last name required; at least one of phone / e-mail (e-mail strongly recommended, since all messages go by e-mail); phone normalised to E.164 (default DE). Optional, opt-in only for adults: **birth month** for the birthday discount (§3.7). Nothing else.

### 3.5 Booking request and approval (D-018, D-027)
- An online booking creates an appointment in state `requested`. **The slot is reserved immediately** (its blocks are active and protected by the exclusion constraint).
- Staff answer with **Annehmen** (`confirmed`), **Ablehnen** (`declined`, slot freed) or **Rücksprache** (`discuss`, slot stays reserved, the salon contacts the client).
- Unanswered requests: every **6 h** the salon staff get one digest e-mail listing open requests; a request still unanswered **48 h after it was sent** expires (`expired`, slot freed, client informed). If the appointment starts earlier than that, it expires at its start time. `discuss` does not expire automatically but appears in the digest.
- Staff-created appointments (phone, walk-in) are `confirmed` directly.

### 3.6 Self-service, cancellation and Balayage fee (D-020, D-028)
- Reschedule/cancel via link until **12 h** before start (A-05, confirmed); for services with a fee rule (Balayage) until **48 h** before. Afterwards the page shows the salon phone number.
- Rescheduling keeps service, options and stylist; a rescheduled request stays `requested`. A rescheduled **confirmed** appointment becomes `requested` again only if it lasts **≥ 60′** (`rescheduleReconfirmMinMinutes`); shorter ones stay confirmed and the client gets a "changed" e-mail (A-16, confirmed).
- **Balayage Ausfallgebühr** for no-show or cancellation later than 48 h before start. Amount = typical damage (D-020, owner 2026-10-28): 4 h × statutory minimum wage (13,90 €/h in 2026) × 1,23 (employer social-security share incl. levies, ≈ 22–24 %) + 15 % of the salon's Balayage price (lost profit share, owner range 10–20 %), rounded up to full euros. Demo price 190 € → **97 €**; without a price only the labour part (69 €). The amount is fixed on the appointment at booking. The client must tick a mandatory checkbox with the fee text when booking; the consent (timestamp + text version) is stored. No money is collected in the app: when staff mark a no-show or record a late cancellation, the appointment shows "Ausfallgebühr … € offen" and staff mark it `paid` or `waived`. The fee text states that the client may prove a lower damage (§ 309 Nr. 5 BGB). **Legal text to be validated by a lawyer.**

### 3.7 Birthday discount (D-021) – the only marketing
- Adults may opt in during booking: "Ich möchte im Geburtstagsmonat 10 % Rabatt auf einen Termin erhalten" + birth month. Only the month is stored (data minimisation).
- 10 % on **one** appointment whose date lies in the birth month; usable throughout that month; once per calendar year. Staff see a badge on eligible appointments; the discount is marked "eingelöst" when staff complete the appointment with it.
- At the start of the birth month the client receives one e-mail with the offer and an unsubscribe link (consent = Art. 6(1)(a) DSGVO, § 7 UWG). Opt-out at any time via the link.

### 3.8 Messages (transactional + birthday)
E-mail only (D-029). Templates: request received, confirmed (with `.ics`), declined, discuss, expired, reminder **24 h** before (confirmed only; A-06 confirmed: one reminder), changed, cancelled, age-check request, birthday offer; staff digest of open requests. Dates in words: "Di., 3. November 2026, 09:15 Uhr". WhatsApp Business: channel interface exists, disabled; enabling needs a WhatsApp Business Platform provider contract (costs per conversation, DPA) – owner decision.

### 3.9 Branding, themes, accessibility (D-022, D-023)
- Each salon chooses a **theme preset** (e.g. Dunkel, Hell, Warm, Kontrast) and an accent colour from a palette pre-checked for WCAG contrast; free colours are not allowed, so contrast cannot break.
- Every visitor (client and staff) has an **"Ansicht" menu**: text size (100 / 125 / 150 %), high contrast, reduced motion, light/dark. Stored per device (localStorage); honours `prefers-reduced-motion` and `prefers-color-scheme` by default.
- **Logo splash:** when the app opens, the salon logo is shown for at most 2 s, or less if the page is ready and the visitor taps/presses a key. With reduced motion it appears without animation. The logo has alt text (salon name); the splash does not trap focus. Only the platform admin uploads logos (PNG/SVG/WebP, ≤ 512 KB, SVG sanitised).

### 3.10 Add to calendar (D-024)
Confirmation page and e-mail offer: "Apple Kalender / iPhone" (.ics download), "Google Kalender" (opens Google's add-event page in a new tab; nothing is sent to Google until the client clicks), "Outlook / andere" (.ics).

## 4. User stories and acceptance criteria

### Client
**C-1 Request an appointment**
- AC1: Steps: Damen/Herren + Volljährig/Minderjährig → Leistung (with price if set) → Option → duration bar → slot in week calendar → Daten (+ optional birthday opt-in; + mandatory fee checkbox for Balayage) → "Termin anfragen".
- AC2: Changing an earlier step resets dependent later steps.
- AC3: Duration bar shows each block proportionally; free blocks in a distinct solid colour (no hatching).
- AC4: Only valid start times are tappable.
- AC5: Slot taken meanwhile → "Dieser Termin ist leider nicht mehr frei." and refreshed calendar, form data kept.
- AC6: Double submit creates exactly one request (Idempotency-Key).
- AC7: Result page says clearly **"Anfrage gesendet – noch nicht bestätigt"**, shows date in words, start, "Ende ca.", service, price, reference code, the management link, and that a confirmation follows by e-mail.

**C-2 Find a date fast** – week view Mon–Sun, 08–17, break/closed visible, ~50 % viewport height; month panel with chips for 12 months, dots, "Heute", "Nächster freier Termin".

**C-3 Manage my appointment** – status (angefragt / bestätigt / Rücksprache / abgelehnt / abgelaufen / abgesagt), "Verschieben", "Absagen", add-to-calendar (only when confirmed); disabled after cut-off with phone shown; neutral page for invalid tokens.

**C-4 Be informed** – e-mail on request, answer, change, expiry; one reminder 24 h before confirmed appointments.

**C-5 Accessibility settings** – "Ansicht" menu reachable by keyboard from every page; settings apply immediately and persist on the device.

### Staff
**S-1a Two staff views (D-031)** – a segmented switch "Mein Tag" / "Team":
- *Mein Tag*: only the logged-in stylist's own clients, one wide column (day) or 7 columns (week); default for role `stylist`.
- *Team*: all stylists of the salon side by side for one day, one column per stylist (avatar initials + full name in the sticky header, never truncated to 2 letters); default for role `owner`.
- Mobile (iOS Safari, Android Chrome): columns keep a minimum readable width (≥ 140 px) and scroll horizontally with scroll-snap; the time axis stays sticky on the left and the header sticky on top; the view opens at the opening hour (not at midnight) and auto-scrolls to "now" today; the grid is light (blocks dominate, lines barely visible); stylist colour only as a thin accent bar, not as a full background; no floating chat bubble covering content; safe-area insets respected.
- Drag & drop between stylist columns in Team view reassigns the stylist (same rules, validated per stylist).

**S-1 Day/week calendar** – navigation « ‹ Heute › », date picker, 7-day strip with counts; each appointment shows name, full range, phases, "Ende hh:mm"; requests visibly marked (e.g. outline + "Anfrage"); faint 5′/15′/60′ raster above blocks.
**S-2 Drag & drop** – pointer events; move (also to another day via the strip); resize each phase (min 5′); live preview; red + text reason when invalid; snap 5′; optimistic-lock conflicts reload.
**S-3 Keyboard/panel alternative** – Enter opens panel; ↑/↓ ±5′, Shift ±15′; panel with date/time, ±5/±15 for start and each phase; targets ≥ 44 px.
**S-4 Undo/redo** of the last changes of the session.
**S-5 Requests inbox** – list of `requested`/`discuss` with Annehmen / Ablehnen (optional reason) / Rücksprache; badge count in the header.
**S-6 Create appointment** (phone/walk-in) – confirmed directly; 5′ grid.
**S-7 Absences** – create/delete; rejected over existing appointments with list.
**S-8 No-show / completed / fee** – after start; Balayage fee record `due → paid | waived`.
**S-9 Notes, client search, no-show count, age check** (outcome only, never document data).
**S-10 Owner admin** – price list editor; opening hours and breaks editor with conflict preview; theme preset + accent; staff accounts.
**S-11 Platform admin** – salons (create, slug, profile, disable), logo upload, services/durations per salon (validated by the engine schema).
**S-12 Login** – session cookie, rate-limited, password ≥ 12 chars.

## 5. Data model (multi-tenant)

Every business table carries `tenant_id`; every query is scoped by the tenant resolved from the URL (public) or from the session (staff). Cross-tenant access is covered by integration tests.

```
tenant(id, slug unique, name, profile jsonb, config jsonb  -- validated SalonConfig
       theme jsonb {preset, accent}, logo_asset_id?, active, created_at)
asset(id, tenant_id, content_type, bytes, sha256, created_by, created_at)          -- logos
price(tenant_id, service_id, variant default '', price_cents, is_from, finish_surcharge_cents?, PK(tenant_id, service_id, variant))
stylist(id, tenant_id, display_name, color, active, sort_order)
staff_user(id, tenant_id?, stylist_id?, email unique, password_hash, role[platform_admin|owner|stylist], display_name)
session(id_hash, staff_user_id, expires_at)
customer(id, tenant_id, first_name, last_name, phone?, email?, birth_month?, birthday_consent_at?,
         marketing_unsubscribed_at?, anonymized_at?, created_at, last_seen_at)
appointment(id, tenant_id, ref_code, stylist_id, customer_id, service_id, audience, variant, finish, adult_declared,
            color_notes?, internal_note?, status, source, manage_token_hash, age_check_*,
            fee_rule jsonb?, fee_consent_at?, fee_consent_text?, fee_status[none|due|paid|waived],
            birthday_discount bool, price_cents_snapshot?, expires_at?, last_staff_digest_at?,
            start_at, end_at, version, decline_reason?, cancel_reason?, cancelled_at?, created_at, updated_at)
birthday_redemption(tenant_id, customer_id, year, appointment_id, PK(tenant_id, customer_id, year))
absence(id, tenant_id, stylist_id, start_at, end_at, kind, note?)
time_block(id, tenant_id, stylist_id, appointment_id? | absence_id?, seq, phase_key, kind, active, start_at, end_at,
           EXCLUDE USING gist (stylist_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&) WHERE (kind='busy' AND active))
appointment_event(id, tenant_id, appointment_id, at, actor, type, payload)
outbox_message(id, tenant_id, appointment_id?, channel[email|whatsapp], recipient, template, subject, body, attachments, status, attempts, send_after, sent_at)
idempotency_key(key, tenant_id, request_hash, status_code, response, created_at)
```

## 6. Appointment states

```
 online ─► [requested] ──Annehmen──► [confirmed] ──after start──► [completed] | [no_show]
              │  │  └──Rücksprache──► [discuss] ──Annehmen──► [confirmed]
              │  └──Ablehnen──► [declined]            └──Ablehnen──► [declined]
              └──48 h / start, unanswered──► [expired]
 requested | discuss | confirmed ──client or staff──► [cancelled]
 staff ─► [confirmed]
```
- Active blocks (slot reserved): `requested`, `discuss`, `confirmed`, `completed`, `no_show`. Inactive: `declined`, `expired`, `cancelled`.
- Rescheduling is not a state; staff edits keep the state; a client reschedule of a confirmed appointment of ≥ 60′ returns it to `requested` (A-16).
- Undo: staff can revert `completed`/`no_show` → `confirmed` within 7 days, and a staff cancellation/decline → previous state while the slot is still free.

## 7. Error flows

| Situation | Behaviour |
|---|---|
| Slot taken between display and submit | 409 `SLOT_TAKEN`; slots refetched; form data kept |
| Double submit | `Idempotency-Key` → same response, one request |
| Minor + restricted service (forged) | 422 `AGE_RESTRICTED` |
| Balayage without fee consent | 422 `FEE_CONSENT_REQUIRED` |
| Unknown or disabled salon slug | neutral 404 |
| Invalid manage token | neutral 404, no detail |
| Change after cut-off | 409 `CUTOFF_PASSED`, phone shown |
| Concurrent staff edits | 409 `VERSION_CONFLICT` → reload |
| Invalid staff move | prevented in UI, rejected by API (422 with reason) |
| Absence over appointments | 409 with list |
| Opening hours change conflicts | preview list; saving allowed, appointments untouched |
| Cross-tenant id in a request | 404 (never 403, no information leak) |
| E-mail provider down | change succeeds; outbox retries with back-off; staff see "nicht zugestellt" |
| Rate limit | 429 + `Retry-After` |
| Server error | generic German message + request id |

## 8. Non-functional requirements

- **Performance:** slot computation for one week < 20 ms; API p95 < 200 ms locally; staff calendar 60 fps while dragging with 5 000 appointments stored (only the visible range is loaded); Lighthouse ≥ 90 performance and accessibility.
- **Accessibility:** WCAG 2.2 AA (contrast, focus 2.4.11, targets ≥ 44 px, keyboard, dragging alternative 2.5.7, ARIA, live regions, reduced motion), plus the visitor settings of §3.9. Automated axe checks + manual screen-reader checklist. BFSG: micro-enterprise salons are exempt, but **the platform operator** may fall under it if it offers the booking service itself to consumers – to be checked legally (research §5); we comply anyway.
- **Privacy (DSGVO):** minimisation; Art. 6(1)(b) for bookings, Art. 6(1)(a) for the birthday discount; **controller = salon, processor = platform operator → a data processing agreement (AVV, Art. 28) between operator and each salon is needed**; no trackers or third-party scripts/fonts; EU hosting and e-mail provider with DPA; retention: client data anonymised `retentionMonths` (12) after the last appointment; customers with an open fee claim are kept until the claim is time-barred (3 years from the end of the year it arose, §§ 195, 199 BGB). The 10-year duty of § 147 AO / § 257 HGB concerns accounting records (invoices, till data), which live in the salon's till/accounting, not in the booking data (A-07, see legal.md); export/deletion per salon. Legal texts are drafts.
- **Tenant isolation:** tenant id on every row, scoped queries, tests that try cross-tenant ids; logos served only for active tenants.
- **Security:** OWASP Top 10, CSP without inline scripts, `HttpOnly; Secure; SameSite=Strict` cookies, CSRF (SameSite + Origin + custom header), rate limits, Argon2id, sanitised SVG uploads, secrets only via environment, dependency audit in CI.
- **Reliability:** DB-level double-booking prevention, idempotent requests, outbox pattern.
- **Browsers:** last 2 versions of Safari iOS, Chrome Android, Chrome, Firefox, Edge.

## 9. Abuse protection (answer to research decision D-009)
Every online booking now needs staff approval, which already filters fake requests. Layers: rate limits per IP; honeypot field; Idempotency-Key; **self-hosted proof-of-work challenge** (ALTCHA-style: the browser solves a small SHA-256 puzzle, no cookies, no third party, invisible to users) [D-026]; optional later: e-mail double opt-in if spam appears. Third-party CAPTCHAs (reCAPTCHA, hCaptcha, Turnstile) are rejected: consent banner needed, data to third countries, accessibility problems.

## 10. Assumptions and owner answers

Answered by the owner on 2026-10-28 (✅ = confirmed, ✏️ = changed):

| ID | Topic | Status |
|---|---|---|
| A-01 | Haarschnitt durations | ✏️ Herren 30′ with or without wash; Damen 30′ without, 45′ with wash (Föhnen assumed included) |
| A-02 | Waschen & Legen 30′, without cut | ✅ |
| A-03 | Strähnen and Dauerwelle also for men; Balayage women only | ✏️ |
| A-04 | Strähnen: Oberkopf & Konturen 45′, ganzer Kopf 60′, cut 30′ | ✏️ (order highlights → Einwirkzeit → cut → styling is our assumption) |
| A-05 | Self-service changes until 12 h before (48 h Balayage) | ✅ |
| A-06 | One reminder 24 h before | ✅ |
| A-07 | Owner proposed 10 years; we keep 12 months for booking data (see §8 and legal.md) | ⏸ owner: "decide later" – 12 months stay meanwhile |
| A-10 | Busy times anonymous; free slots highlighted with a fine outline | ✏️ |
| A-13 | An absence blocks the whole appointment incl. Einwirkzeit – no overlap at all | ✅ (2026-10-28) |
| A-16 | Re-confirmation after a client reschedule only for appointments ≥ 60′ | ✏️ |
| D-020 | Fee from typical damage (minimum wage + 10–20 % lost revenue) | ✏️ 15 % chosen |

Still open (unchanged assumptions):

| ID | Assumption |
|---|---|
| A-09 | Same-day lead time 30′ and 364-day horizon (prototype) |
| A-12 | First salon: one stylist, the owner |
| A-14 | Staff may place appointments in the past (corrections) |
| A-15 | Staff may move a Balayage away from 08:00/13:00 |
| A-17 | Birthday discount: only the month is stored; only adults; one appointment per calendar year |
| A-18 | Expiry of unanswered requests: 48 h after the request, at the latest at the appointment start |
| A-19 | Theme presets and accent palette are chosen by the owner; free colours only by the platform admin |
| A-20 | Salon URL is a path (`/salon-slug`); custom domains per salon later |

## 11. Prototype deviations (intentional)

- Persistence in PostgreSQL instead of `localStorage`; time in `Europe/Berlin` instead of browser-local.
- "Verbindlich buchen" becomes "Termin anfragen" (approval flow).
- Added: reference code, management link, add-to-calendar, prices, birthday opt-in, fee consent, requests inbox, week view, undo/redo, absences, no-show/fee, notes, search, age check, optimistic locking, admin areas, themes, logo splash.
