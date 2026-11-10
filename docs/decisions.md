# Decision log

Format: ID · date · decision · reason · status (proposed / confirmed by owner).

## Phase 0 – Research

| ID | Date | Decision | Reason | Status |
|---|---|---|---|---|
| D-001 | 2026-10-27 | Guest booking only, no customer accounts | Research F4; brief | proposed |
| D-002 | 2026-10-27 | No online payment / deposit; fee only for Balayage (see D-020) | Research F5; owner answer | **confirmed** |
| D-003 | 2026-10-27 | Own booking page, no marketplace, no commission | Research F6 | proposed |
| D-004 | 2026-10-27 | Transactional messages only (confirmation, 1 reminder, change, cancel); no marketing | Research F13 | proposed |
| D-005 | 2026-10-27 | E-mail only; no SMS; WhatsApp prepared but disabled (D-029) | owner answer | **confirmed** |
| D-006 | 2026-10-27 | Reschedule/cancel via signed link in confirmation, same stylist kept | Research F3 | proposed |
| D-007 | 2026-10-27 | Stylist choice hidden while 1 stylist; model supports N | Research F8; brief | proposed |
| D-008 | 2026-10-27 | Dates written in words in all messages ("Di., 3. November 2026, 09:15 Uhr") + .ics attachment | Research pain point (Phorest), F17 | proposed |
| D-009 | 2026-10-27 | No OTP at booking; abuse handled with rate limit, honeypot, link confirmation | Research F20 | proposed |
| D-010 | 2026-10-27 | Rejected: waitlist, AI receptionist, POS/TSE, gift cards, loyalty, tip prompt | Research F15, F19, F21, F7 | proposed |
| D-011 | 2026-10-27 | Build to WCAG 2.2 AA although the salon is probably BFSG-exempt | Research §5; brief | proposed |

## Phase 1 – Specification

Owner did not answer D-002 / D-005 explicitly; the defaults below **reduce** scope and cost, so work continues with them and they stay listed as assumptions (A-06, A-11).

| ID | Date | Decision | Reason | Status |
|---|---|---|---|---|
| D-012 | 2026-10-27 | Prototype saved as `reference/prototype.html`; used for rules, not code | brief | done |
| D-013 | 2026-10-27 | Absences stored as busy `time_block`s so one exclusion constraint guards appointments and absences | single source of truth for conflicts | proposed |
| D-014 | 2026-10-27 | Strähnen/Balayage/Dauerwelle Damen-only, following the prototype (A-03) | prototype is source of truth for rules | needs owner |
| D-015 | 2026-10-27 | Absences block the whole appointment, including Einwirkzeit (A-13) | stylist must be present at the end of processing | **confirmed 2026-10-28** |
| D-016 | 2026-10-27 | Age check stores outcome only (verified / not_verified / not_presented), never document data | DSGVO data minimisation | proposed |
| D-017 | 2026-10-27 | Docs in English, UI in German | brief: code/comments English; docs read by reviewers internationally | proposed |

## Technology (Phase 2+)

| ID | Decision | Alternatives considered | Reason |
|---|---|---|---|
| T-001 | pnpm monorepo: `packages/engine`, `packages/config`, `apps/api`, `apps/web` | single package; Nx/Turborepo | clear boundaries (engine has no UI/DB deps) without extra tooling |
| T-002 | TypeScript strict + `noUncheckedIndexedAccess` everywhere | – | brief; catches index bugs in slot arithmetic |
| T-003 | Engine works in local wall time (date + minute); UTC only at the DB boundary | store everything as UTC and compute in UTC | rules are wall-clock rules; DST cannot shift a 08:00 opening |
| T-004 | Own Intl-based time-zone conversion, validated against `temporal-polyfill` as a test oracle | date-fns-tz, Luxon in production | zero runtime deps in the engine; the oracle proves equivalence (property test, 2 000 runs) |
| T-005 | Zod v4 for config and API validation | Valibot, io-ts | brief default; one schema language from config to HTTP |
| T-006 | Vitest + fast-check; coverage thresholds 95 % lines on the engine | Jest | fast, ESM-native; fast-check per brief |
| T-007 | Mutation sanity check done manually: disabling the overlap or break rule makes P1/P2 and BR tests fail | Stryker | full mutation testing is a possible later addition |
| T-008 | Staff may move Balayage away from 08:00/13:00 (`enforceFixedStartsForStaff: false`, A-15) | enforce for staff too | prototype allows it; switch is in config |

## Owner answers 2026-10-27 (scope change)

| ID | Decision | Reason | Status |
|---|---|---|---|
| D-018 | Every online booking is a **request**; staff accept / decline / "Rücksprache"; the slot is reserved meanwhile | owner | confirmed |
| D-019 | **Multi-salon platform** (one installation, tenant per salon, path `/slug`); owners edit **prices + opening hours**; services/durations set by the platform admin | owner | confirmed |
| D-020 | Balayage fee 150 € for no-show **and** cancellation < 48 h; mandatory consent checkbox; online changes only until 48 h before; fee recorded, not collected | owner; § 309 Nr. 5 BGB wording | confirmed (legal check pending) |
| D-021 | Only marketing: 10 % birthday discount, one appointment in the birth month, opt-in, month only stored, adults only | owner; DSGVO minimisation; UWG § 7 | confirmed (details A-17) |
| D-022 | Theme presets + contrast-checked accent palette per salon; visitor "Ansicht" menu (text size, contrast, motion, light/dark) | owner; WCAG | proposed |
| D-023 | Logo splash ≤ 2 s, skippable, no focus trap; logo upload only by platform admin | owner | confirmed |
| D-024 | Add-to-calendar: Apple (.ics), Google (link), Outlook (.ics) | owner | confirmed |
| D-025 | Decision 6 (manage link) and 8 (dates in words): implemented as proposed | owner: "confido in te" / "fai te" | confirmed |
| D-026 | Abuse protection: staff approval + rate limit + honeypot + self-hosted proof-of-work; no third-party CAPTCHA | answer to "hai opzioni migliori?" | proposed |
| D-027 | Unanswered requests: staff digest every 6 h; request expires 48 h after it was sent (at latest at start) | owner | confirmed |
| D-028 | Exclusions of decision 10 stay | owner: "non al momento" | confirmed |
| D-029 | No SMS; WhatsApp Business only as optional, disabled channel (provider contract, costs and DPA needed) | owner | confirmed |
| D-030 | Each salon maintains its own price list in an owner admin page | owner | confirmed |
| T-009 | Plain `pg` + hand-written SQL migrations instead of an ORM | exclusion constraints, advisory locks and range queries are clearer in SQL; fewer dependencies | proposed |
| T-010 | Hono + `@hono/zod-openapi`: REST with OpenAPI generated from the same Zod schemas that validate requests | tRPC (no OpenAPI for non-TS clients) | proposed |
| T-011 | Tenant isolation in the application layer (tenant id in every query + tests); Postgres RLS as a later hardening step | RLS now: more moving parts per connection | proposed |
| D-031 | Staff calendar has "Mein Tag" (own clients) and "Team" (all stylists, column per stylist) views; mobile-first with sticky axes, horizontal scroll-snap, full names, light grid; inspired by the owner's screenshot but redesigned (no truncated names, no heavy grey grid, opens at opening hour) | owner message with screenshot | confirmed |

## Phase 3–6 (implementation)

| ID | Decision | Alternatives | Reason |
|---|---|---|---|
| T-012 | Management links = HMAC(secret, appointment id); DB stores only SHA-256 | random token stored hashed | the same working link can be put in every later e-mail without storing it; revocable by clearing the hash |
| T-013 | Self-hosted proof-of-work (ALTCHA-style) instead of a CAPTCHA | reCAPTCHA, hCaptcha, Turnstile | no third party, no cookies, no consent banner, invisible (D-026) |
| T-014 | Outbox table + polling worker with `FOR UPDATE SKIP LOCKED` | send inside the request | a failing mail provider never breaks a booking; safe with several instances |
| T-015 | Advisory lock per stylist+day in addition to the exclusion constraint | constraint only | absences must also block free blocks (A-13), which the constraint (busy only) does not cover |
| T-016 | Client calendar: 3 px/min (45 px per 15′ slot) + list view | smaller grid | ≥ 44 px targets on phones; list view for screen readers |
| T-017 | Staff drag preview rendered as a "ghost" from React state, throttled with rAF; no panel opening on drag start | DOM transforms | cross-column/day drops; opening the panel shifted the layout under the pointer (found by e2e) |
| T-018 | Tenant config cached for 30 s (by slug and id) | parse per request | config validation incl. 10-year DST check cost ~100 ms; calendar p95 dropped from ~290 ms to 46 ms |
| T-019 | e2e against the production build served by the API, frozen clock, fresh DB | Vite dev server | tests the real CSP and static serving; deterministic data for visual baselines |
| T-020 | Seed packs days sequentially with spread gaps | random placement | random placement left only small gaps, so colour services were never bookable in the demo |
| T-021 | `pool.on('error')` handler | – | an idle client error crashed the server when the DB restarted (found while reseeding) |

## Owner answers 2026-10-28

| ID | Decision | Reason | Status |
|---|---|---|---|
| D-032 | Durations per audience: phase field `audienceVariantMinutes` (men's cut 30′ with/without wash; women 30′/45′). Variant `wash_blowdry` removed; women's "mit Waschen" includes Föhnen | owner A-01; alternative "separate services per audience" rejected (duplicates prices and i18n) | confirmed (Föhnen = assumption) |
| D-033 | Strähnen: variants Oberkopf & Konturen 45′ / ganzer Kopf 60′, then Einwirkzeit 30′, cut 30′, styling 30/45′. Strähnen + Dauerwelle also for men; Balayage women only | owner A-03, A-04 | confirmed (phase order = assumption) |
| D-034 | Fee rule can be a fixed amount **or** a formula (labour hours × wage × (1 + employer share) + % of price, rounded up); amount frozen on the appointment. Balayage: 4 h, 13,90 €, 23 %, 15 % → 97 € at 190 € | owner D-020; § 309 Nr. 5 BGB "typical damage" | confirmed (15 % chosen inside owner's 10–20 %) |
| D-035 | Client reschedule of a confirmed appointment keeps the confirmation if it lasts < 60′ (`rescheduleReconfirmMinMinutes`) | owner A-16 | confirmed |
| D-036 | Retention stays 12 months (`retentionMonths`), not 10 years; open fee claims kept until time-barred (3 years, §§ 195, 199 BGB) | the 10-year (now 8-year for receipts) duty covers accounting records, not booking data; DSGVO storage limitation | proposed – owner postponed the decision; 12 months apply meanwhile |
| D-037 | Client calendar: free slots with a fine accent outline and faint tint; other clients' times stay anonymous | owner A-10 | confirmed |
| T-022 | Docker image build could not be verified in the sandbox: the daemon now runs, but pulls from Docker Hub are blocked by the network policy | – | open (verify on a machine with internet) |

## Owner request 2026-11-07

| ID | Decision | Reason | Status |
|---|---|---|---|
| D-038 | Staff-only **client card** (`/team/kunden/:id`): contact, all appointments past/future, colour recipes, team notes, allergies | owner | confirmed |
| D-039 | Allergies stored only with explicit consent confirmed by staff (written consent in the salon); DB constraint `health_notes_need_consent`; withdrawal deletes | Art. 9 DSGVO – health data | proposed (legal review) |
| D-040 | Appointments from yesterday backwards cannot be cancelled (API `PAST_LOCKED`, button hidden); completed/no-show still possible | owner: complete history | confirmed |
| D-041 | Mandatory "Datenschutzhinweise gelesen" checkbox at every online request (no account → cannot detect the first one); stored with version. Not a consent; no cookie banner (no cookies for clients) | owner asked for consent + cookies; legally information (Art. 13) is required, not consent | confirmed with explanation |
| D-042 | "Grund" → **Notiz**: optional note for accept / decline / Rücksprache, sent in the e-mail and shown on the client's booking page; hint sentence always visible | owner | confirmed |

## UI polish 2026-11-09

| ID | Decision | Reason | Status |
|---|---|---|---|
| D-043 | Motion system: 160–240 ms, opacity/transform only (cards fade up, sheets/panel slide in, selected chip "pop", toast); off with "Bewegung reduzieren" or the OS setting | smoother feel without layout shift or extra libraries | done |
| D-044 | Staff on phones: section tabs as bottom bar with icons (incl. Abmelden), "Neuer Termin" as floating button, « » hidden, short date, Hilfe in the toolbar → calendar starts ~40 % higher | the toolbar used more than half the screen before the calendar | done |
| D-045 | Phases of one appointment drawn as one joined card; requests striped; status messages as a toast (6 s) | the phases looked like separate appointments; messages were missed after scrolling | done |
| D-047 | "Now" line: thin semi-transparent line with halo across every column of today + time pill on the axis; moves every 30 s (server time at load + browser time elapsed); "Heute" scrolls it to the middle | owner request 2026-11-09 | done |
| D-046 | POS / till integration: **not built** – needs the owner's choice of till system (cost, contract). Proposed: the till stays the legally required system (TSE, receipt); the booking app only hands over the items to charge | KassenSichV / § 146a AO | waiting for owner |

## Services editor 2026-11-10

| ID | Decision | Alternatives | Reason | Status |
|---|---|---|---|---|
| D-048 | **Services editor** in Einstellungen (owner) and /admin (platform admin): name, Damen/Herren, "nur ab 18", hidden, phases (name, Arbeit/Einwirkzeit, order) and durations per audience × variant as a table. Existing appointments keep their stored blocks; new durations apply to new bookings (and to a client reschedule, which is a new placement). A service or variant with appointments cannot be deleted, only hidden; prices of deleted services are removed. Optimistic lock via a hash of the services. Booking hints are computed from the durations instead of fixed texts. Not editable yet: variants, fee rule, fixed start times, colour notes/finish option | platform admin only (owner answer: both); JSON upload (error-prone); delete with cascade (would break history) | owner 2026-11-10: owner and platform admin edit; existing appointments unchanged; delete only if unused | done |

## Login and navigation 2026-11-10

| ID | Decision | Alternatives | Reason | Status |
|---|---|---|---|---|
| D-049 | **Login with e-mail or user name in one field** ("E-Mail oder Benutzername"). User names are optional, 3–30 characters (a–z, 0–9, `.`, `-`, `_`, no `@`), unique **within the salon**: the salon's login page (`/{slug}/team`) sends its slug, so nobody types the salon. On /admin a user name matches only platform admins. E-mail stays mandatory for every login (password reset, notices). The owner sets/changes user names in Einstellungen › Team. Demo: `maria`, `sophie`, `deniz`, `admin` | user names unique on the whole platform (owner: per salon); user name instead of e-mail (no way to reset a password) | owner request 2026-11-10 | done |
| D-050 | Readable error page ("Seite nicht gefunden" with links to booking/team) instead of the router's developer message; `/{slug}/admin` redirects to `/{slug}/team/einstellungen` | – | owner opened `/salon-beispiel/admin` and saw "Unexpected Application Error" | done |
| D-051 | **Logo = home**: in the staff area it leads to today's calendar (default view), for clients to the booking page. The client's **name in the appointment panel** is the link to the client card (replaces the separate "Kundenkarte öffnen" button). Not on the calendar block itself: the block is draggable and opens the panel (needed to accept requests); a link inside it would trigger by mistake and is a nested interactive control (WCAG) | name on the block as link; double click | owner request 2026-11-10 | done |

## Salon homepage 2026-11-10

| ID | Decision | Alternatives | Reason | Status |
|---|---|---|---|---|
| D-052 | **Public homepage** at `/{slug}` before booking; booking moves to `/{slug}/buchen` (management links unchanged). Sections from existing data: hero (logo, name, owner's slogan, live "geöffnet / ab … Uhr" status, "Termin buchen", "Anrufen"), services with computed durations and "ab" prices (hidden ones excluded), opening hours (today marked), contact with a **"Route planen" link** (no embedded map), owner's "Über uns" text, team, final call to action, sticky booking button on phones. Texts are written by the owner; empty texts hide their section (no invented marketing copy). Neutral wording so other businesses (barber, nails, beauty) fit. **Team only opt-in** and only under a **public name the person chooses** (e.g. first name); the public config no longer contains any staff names (it used to list all full names – staff screens now load them from the staff API). Motion: hero background drift, sections fade in on scroll (not those visible at load: Lighthouse LCP 3.7 s → 0.9 s), cards lift on hover; all off with "Bewegung reduzieren"/OS setting. No photos yet (owner: later) | embedded Google Maps (third-party data transfer, cookie banner); booking stays at `/{slug}` with the homepage elsewhere; full staff names | owner request 2026-11-10 | done |
| D-053 | **Hover glow** on every pressable control (buttons, chips, service rows, segmented buttons, tabs, day strip, month days, free slots): on mouse hover the edge lights up in the accent and fades towards the inside (inset shadow); filled controls glow in a light token. Only for real pointers (`hover: hover` and `pointer: fine`), not on disabled controls; uses the existing transition, so it is instant with reduced motion. Focus outline unchanged (keyboard) | outer glow (gets clipped by scroll containers, looks like focus); colour change only | owner request 2026-11-10 | done |
| D-054 | **Delete staff profiles** (owner, Einstellungen › Team) after a confirmation dialog (modal `<dialog>`, focus inside, Escape cancels, "Abbrechen" focused first). Past appointments stay in the history with the person's name. Upcoming appointments are no longer confirmed: they become "Rücksprache" with `needs_reassign` and wait under "Anfragen", where staff give them to a colleague (same write path as a drag to another column) and then accept, or decline them; accepting before a new person is chosen is refused. Without any history stylist and login are deleted; otherwise only the display name stays on an inactive, hidden stylist row and the login data (e-mail, user name, password, sessions) are erased. Not possible for the own profile or the last owner. Clients are not e-mailed when the person is deleted – staff decide per appointment | refuse while upcoming appointments exist (first version); hard delete with cascade (would erase the salon's records of past work); cancel the upcoming appointments automatically | owner request 2026-11-10 ("la cronologia resta, i futuri aspettano conferma dallo staff") | done |
| D-055 | **Account menu on the user's name** (top right, all screen sizes): "Angemeldet als …", **Profil wechseln** (list of colleagues with a login; choosing one logs out and opens the login with their user name filled in, the password must be typed), Einstellungen, Abmelden. The logout tab in the phone bottom bar and the logout button in the header are gone. Disclosure pattern (button + `aria-expanded`), Escape and click outside close it. The colleague list contains names and user names only, no e-mails | keep a logout button in the bar (owner: too easy to hit); switch without password (anyone at the shared device could act as someone else) | owner request 2026-11-10 | done |
| D-056 | **Client list without a search**: all clients, A–Z with letter headings, 50 per page with automatic loading at the end of the list ("Weitere laden" as fallback); **sort "Nächster Termin"** (soonest first, clients without an upcoming appointment last). Search unchanged (2 characters). One SQL query with LATERAL joins instead of one query per client. Phone/e-mail links get 44 px targets | list only after a search (before) | owner request 2026-11-10 | done |
| D-057 | **Save the note in the requests inbox first**: "Notiz speichern" stores it as a draft (staff only, separate column, the client sees nothing yet); the saved text is shown ("Wird mit Ihrer Antwort gesendet: …"). While the text has unsaved changes the answer buttons are locked ("speichern oder verwerfen"); after the answer the page shows the text that was actually sent | send whatever is in the field (before); auto-save while typing (no clear moment of "this is the text") | owner request 2026-11-10 | done |
| D-058 | **Settings by category**: overview with one large tile per category (Konto, Leistungen & Dauern, Preisliste, Öffnungszeiten, Startseite, Aussehen, Team) and one page per category at `/team/einstellungen/{kategorie}`, with the category list beside the content (desktop) or as a scrollable row above it (phone). Everyone has "Konto"; the salon categories are owner only. `/{slug}/admin` still leads to the overview | one long page (before); tabs without own URLs (no deep links, back button) | owner request 2026-11-10 | done |
| D-059 | **"Ansicht" also in the settings** (category for everyone, second after Konto): the same per-device view settings as the "Aa Ansicht" button (text size, light/dark, contrast, reduced motion), one shared component. **"Notiz speichern" also in the calendar panel**: the panel uses the same answer component as the requests inbox (D-057), including the lock for appointments whose person was deleted (D-054) | button only in the header (before); separate note logic in the panel | owner request 2026-11-10 | done |
