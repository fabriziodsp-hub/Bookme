# Accessibility (WCAG 2.2 AA)

## Automated (CI)

- **axe-core** on every page state: booking (empty, with service, details form, month sheet), light/dark/high-contrast themes, Impressum, Datenschutz, login, staff calendar, appointment panel, requests, customers, settings – on iPhone, Android and desktop viewports (`e2e/tests/a11y.spec.ts`).
- **Contrast of every theme combination** (4 presets × 6 accents × light/dark) – text ≥ 4.5:1, UI borders ≥ 3:1 (`apps/web/src/theme/palette.test.ts`). Salons cannot pick free colours.
- **Keyboard only**: skip link, visible focus, booking reachable without pointer; **targets ≥ 44 px** (stricter than 2.5.8).
- **Lighthouse** accessibility score (last local run: 100).

Issues found and fixed by these tests: grid roles without rows, unfocusable scroll regions, accessible names not containing the visible label (2.5.3), 40 px segmented buttons, a low-contrast hint text.

## Design decisions

- Dragging has a full alternative (2.5.7): appointment panel with date/time fields and ±5/±15 buttons for start and every phase; ↑/↓ on a focused block.
- Client calendar has a **list view** with large buttons – easier with screen readers and switch access.
- Live regions announce drag feedback, errors and status changes.
- Dates written in words; colours never carry meaning alone (Einwirkzeit is labelled, requests carry a text tag).
- "Ansicht" menu: text size 100/125/150 %, light/dark, high contrast, reduced motion; OS settings respected by default.
- The logo splash never traps focus, is skippable and ≤ 2 s; no animation with reduced motion.

## Manual screen-reader checklist (NOT yet executed – see README "Not verified")

| # | Check | VoiceOver iOS | TalkBack Android | NVDA + Firefox |
|---|---|---|---|---|
| 1 | Book a haircut end-to-end using only swipe/arrow navigation, list view | ☐ | ☐ | ☐ |
| 2 | Duration bar is read as phases with minutes | ☐ | ☐ | ☐ |
| 3 | Month sheet: chips, dots announced as "freie Termine", Escape closes, focus returns | ☐ | ☐ | ☐ |
| 4 | Form errors announced and first invalid field focused | ☐ | ☐ | ☐ |
| 5 | Result page heading announced ("noch nicht bestätigt") | ☐ | ☐ | ☐ |
| 6 | Staff: block names include client, time, phase; ↑/↓ moves announce the new time | ☐ | ☐ | ☐ |
| 7 | Staff panel: steppers announce "+5: 5 Minuten später" | ☐ | ☐ | ☐ |
| 8 | Text size 150 %: no loss of content, no horizontal page scroll (1.4.10) | ☐ | ☐ | ☐ |
