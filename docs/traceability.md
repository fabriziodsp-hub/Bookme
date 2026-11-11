# Traceability: requirement → automated test

Every business rule of the brief and every owner decision is checked by at least one automated test.
Test locations: `packages/engine/test` (unit + property, Vitest/fast-check), `apps/api/test` (integration against PostgreSQL), `apps/web/src/**/*.test.ts` (unit), `e2e/tests` (Playwright).

## Business rules (brief)

| Rule | Test(s) |
|---|---|
| Mon–Fri 08–17, break 12–13; Sat 08–14; Sun closed | engine `business-rules.test.ts` › BR-01; property P2 |
| No block (incl. Einwirkzeit) in the break | BR-02; property P2; e2e `staff.spec.ts` › drop into the break is red and not saved |
| Europe/Berlin, DST | `time-tz.test.ts` (gap/overlap, Temporal oracle 2 000 runs, round trip); property P6; `config.test.ts` (config rejecting hours in a DST switch) |
| Service durations (cut Damen 30/45, Herren 30/30; Waschen & Legen 30; colour 45/60 + 30 free + 30/45; Strähnen 45/60 + 30 free + 30 cut + 30/45; perm 30+30+15+15+30) | BR-03 (one case per service/option/audience); `config.test.ts` (audience overrides validated) |
| Einwirkzeit: stylist free for other clients | BR-04; API `concurrency.test.ts` › free blocks may overlap busy blocks |
| Balayage 4 h, only 08:00/13:00, Saturday only morning | BR-05; e2e `client.spec.ts` › Balayage |
| Dauerwelle 120′ consecutive, no free time | BR-03 › Dauerwelle |
| ~~No colour/Strähnen/Balayage/Dauerwelle for minors; age asked first~~ replaced by D-062: no age question, under-16 notice on chemical services (engine rule BR-06 kept for API clients that still send `adult: false`) | BR-06; API `staff.test.ts` › no age check any more; `booking-extras.test.ts` › selection without adult; e2e `client.spec.ts` › no age question… |
| Age check with ID, outcome recorded, no document data | API `staff.test.ts` › age check |
| Required data: first/last name, phone or e-mail | API › validation; e2e › list view, validation errors and focus |
| Client slots every 15′, staff edits 5′ | BR-07; e2e › drag & drop snaps |
| Rules in a config file, not hard-coded | `config.test.ts` (schema, 12 rejection cases) |
| Engine: pure library, multi-stylist | properties P1–P9 (incl. P7 multi-stylist union) |
| Property tests: no overlap, not in break/outside hours, no forbidden service for minors, DST, idempotency | P1, P2, P3, P6, P4 |
| No double booking at DB level, concurrency | API `concurrency.test.ts` (20 parallel requests → 1 success; overlapping starts; raw SQL vs exclusion constraint; optimistic lock) |
| Seed: next 3 months, ~70 % occupied, invented names | `seed.ts` logs the occupancy (70 %); used by every e2e run |

## Owner decisions (2026-10-27)

| Decision | Test(s) |
|---|---|
| D-018 request → accept/decline/discuss, slot reserved | API `booking-flow.test.ts` › reserves the slot…; › decline frees the slot; e2e › accept a request |
| D-027 6 h staff digest, 48 h expiry | API › staff digest; › unanswered requests expire |
| D-020 Balayage fee from typical damage (no-show, < 48 h), consent | engine `policies.test.ts` BR-09/BR-10 (formula 88/97/107 €, labour only, fixed amount); API `staff.test.ts` › amount follows the formula and the salon price; › no-show → due → paid; e2e › fee consent required (97 €) |
| A-16 re-confirmation only from 60′ | engine BR-13; API `booking-flow.test.ts` › under 60 minutes stays confirmed; › 60 minutes or more needs re-confirmation |
| A-07 retention, open fee claims kept until time-barred | API `staff.test.ts` › retention anonymises after 12 months; › keeps clients with an open fee claim |
| A-10 free slots outlined | e2e `visual.spec.ts` › client week calendar |
| D-019 multi-salon, tenant isolation | API `tenancy-security.test.ts` › tenant isolation (4 tests) |
| D-021 birthday discount (opt-in, month only, once per year; since D-062 the opt-in text asks for "at least 16") | engine BR-12; API › birthday discount |
| D-022 themes + visitor settings | web `palette.test.ts` (48 combinations, WCAG AA); e2e › "Ansicht"; axe in light/dark/contrast |
| D-023 logo splash ≤ 2 s; logo upload only by platform admin | e2e › splash; API › platform admin… unsafe SVG rejected |
| D-024 add to calendar | API › .ics only once confirmed; e2e › manage page |
| D-026 abuse protection | API › bad proof-of-work, honeypot, rate limit, idempotency |
| D-030 price list per salon | API `staff.test.ts` › price list |
| D-031 Mein Tag / Team | e2e › "Mein Tag" shows only own clients; › team view reassign |
| D-048 services editor (owner + platform admin): names, audiences, age limit, phases, durations | engine `catalog.test.ts` (duration table round trip – property, audience change, ids, validation); API `catalog.test.ts` › new duration only for new bookings; › own name in booking and e-mail; › optimistic lock; › German messages; › only owner/platform admin; e2e `services.spec.ts` (add → book → delete, axe) |
| D-048 hidden services: not bookable, existing appointments stay | engine BR-14; API `catalog.test.ts` › a hidden one is not bookable, its appointments stay |
| D-048 a service/variant with appointments cannot be deleted; prices of deleted services go | API `catalog.test.ts` › cannot be deleted…; e2e › can only be hidden |
| D-048 booking hint computed from the durations | web `labels.test.ts` › booking hint |
| D-049 login with e-mail or user name; user names per salon; e-mail mandatory for a login | API `login.test.ts` (5 tests: per salon, platform admin, lockout, validation, owner edits); e2e `login.spec.ts` › user name |
| D-050 readable 404, `/{slug}/admin` → settings | e2e `login.spec.ts` › /{salon}/admin … readable page |
| D-051 logo = home (staff: today's calendar, clients: booking); client name in the panel opens the card | e2e `navigation.spec.ts` (2 tests); axe in `a11y.spec.ts` › appointment panel |
| D-052 public homepage, booking at /buchen, opt-in team with public name, no staff names in the public config | API `homepage.test.ts`; e2e `homepage.spec.ts` (content + live status + booking link; axe in 3 themes with reduced motion; owner texts and team); Lighthouse `/salon-beispiel` ≥ 90 |
| D-054 delete staff profile with confirmation; history kept, upcoming → Rücksprache until reassigned | API `team-admin.test.ts` (complete removal; history + reassign + accept; own profile / last owner / stylist refused); e2e `account.spec.ts` › owner deletes a staff profile (dialog + axe) |
| D-055 account menu on the name, profile switch, no logout tab | API `team-admin.test.ts` › colleague list…; e2e `account.spec.ts` › account menu… (Escape, focus, prefilled login, axe) |
| D-056 client list without search, A–Z, sort by next appointment, paging | API `team-admin.test.ts` › client list…; e2e `account.spec.ts` › client list… (axe) |
| D-057 note in the requests inbox saved first, sent as saved | API `team-admin.test.ts` › note to the client… |
| D-058 settings by category | e2e `account.spec.ts` › settings by category…; `services.spec.ts` (Leistungen page); `a11y.spec.ts` › settings |
| D-059 Ansicht in the settings; note saving in the calendar panel | e2e `account.spec.ts` › Ansicht is also a settings category; › calendar panel: the note… |
| D-060 calendar fits the screen, Ganzer Tag / Klassisch, full screen, wheel | e2e `calendar-view.spec.ts` (fit without page scroll, remembered view, wheel day by day, full screen); `staff.spec.ts` drag tests read the scale from `data-px`; visual `staff-team` baselines updated |
| D-061 no footer in the staff area, legal links in Konto and login | e2e `account.spec.ts` › settings by category (Konto page) |
| D-063 optional wish for a person in the online booking (public team only) | API `booking-extras.test.ts` › wish for a person… (availability, month dots, next free slot, booking) |
| D-064 staff: client search first, "+" new card, appointment for an existing card | API `booking-extras.test.ts` › existing client card (no duplicate, foreign card 404); e2e `calendar-view.spec.ts` › click on an empty spot… |
| D-065 homepage service card opens the booking with that service | e2e `client.spec.ts` › homepage service card… |
| D-066 Rentner-Schnitt 20′/20 €, Kinder-Schnitt 30′/25 € | engine BR-06 list; API `booking-extras.test.ts` › … new services; e2e `client.spec.ts` (description shown) |
| D-067 click on an empty calendar spot creates an appointment there | e2e `calendar-view.spec.ts` › click on an empty spot… (10:07 → 10:00) |
| BR-17 / D-068 no unusable gaps (< 15′) next to client requests | engine `business-rules.test.ts` BR-17 (10′ after an appointment, 10′ before the break, staff unrestricted, off with 0); visual baseline `client-week` |

## Staff UX (brief)

| Requirement | Test(s) |
|---|---|
| Drag & drop move incl. other day | e2e › move +15 min; › drop on another day |
| Resize each phase | e2e › resize a phase |
| Red feedback when invalid | e2e › drop into the break |
| Keyboard / panel alternative | e2e › keyboard alternative |
| Undo / redo | e2e › … undo restores |
| Absences, no-show, notes, search | API `staff.test.ts` (absences, no-show + undo window, search, notes via panel) |

## Quality

| Requirement | Test(s) |
|---|---|
| WCAG 2.2 AA (axe) | e2e `a11y.spec.ts` (booking states, month sheet, themes, legal, login, staff pages) |
| Focus visible, keyboard only, targets ≥ 44 px | e2e › keyboard only; › touch targets |
| Visual regression of calendars | e2e `visual.spec.ts` (client week, staff team; Android + desktop) |
| Lighthouse ≥ 90 perf & a11y | `e2e/lighthouse.mjs` (CI step); last local run: 96 / 100 |
| Performance with thousands of appointments | e2e `perf.spec.ts` (API p95, no long tasks while dragging) |
| OWASP: CSRF, sessions, rate limits, headers, errors | API `tenancy-security.test.ts` › security (9 tests) |

## Owner request 2026-11-07

| Requirement | Test(s) |
|---|---|
| D-042 Notiz on every decision, e-mail + booking page | API `client-card.test.ts` › accept: note…; › Rücksprache…; `booking-flow.test.ts` › decline… |
| D-041 privacy notice acknowledgement required and stored | API › online requests need it; e2e `client.spec.ts` › validation errors |
| D-038 client card, recipes/notes, author/owner delete | API › shows contact data…; › colour recipes and notes…; e2e `staff.spec.ts` › client card; axe › client card |
| D-039 allergies only with consent, withdrawal deletes | API › allergies only with explicit consent…; DB constraint |
| D-040 past appointments not cancellable | API › cannot be cancelled from yesterday backwards |
| Export/anonymisation cover the card | API › export contains the card; anonymisation deletes… |
