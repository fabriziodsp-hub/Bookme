# CLAUDE.md – project conventions

> **New session? Read `docs/HANDOVER.md` first** (working agreements, status, open decisions). Answer the owner in Italian.

## Layout
- `packages/engine` – pure scheduling library. **No imports from UI, DB, Node APIs or the network.** All times are local wall time (`LocalDate` + minute); conversion to UTC only via `tz.ts`.
- `packages/config` – business rules as data (`salon.config.ts`). Never hard-code durations, hours or rules elsewhere.
- `packages/i18n` – German source strings (`de.ts`); `it.ts`/`en.ts` may be partial. UI text always via `t('…')`.
- `apps/api` – Hono + `@hono/zod-openapi`, plain SQL (`pg`). Every query is scoped by `tenant_id` (`ctx.tenantId`). Domain errors are `AppError` with German user messages.
- `apps/web` – React 19, TanStack Query, plain CSS with tokens from `theme/palette.ts`.
- `e2e` – Playwright; starts its own production-like server (`start.mjs`) with a frozen clock.

## Language
UI German (de-DE). Code, comments, commit messages, docs in English.

## Rules for changes
- New business rule → config schema (`engine/src/config.ts`) + `salon.config.ts` + a `BR-xx` test + a line in `docs/traceability.md`.
- Every write path in the API: transaction → `lockStylistDay` → `checkPlacement` → insert/update (exclusion constraint is the final guard) → `appointment_event` → outbox.
- Staff edits require `version` (optimistic lock). Client writes require an idempotency key where repeatable.
- Never store ID-document data, full birth dates or card data. New personal data → update `docs/legal.md`.
- Accessibility: targets ≥ 44 px, visible text contained in the accessible name, every drag action has a keyboard/panel alternative. Run the axe e2e tests.
- Colours only from `theme/palette.ts`; `palette.test.ts` must stay green.
- Decisions go into `docs/decisions.md` (ID, decision, alternatives, reason).

## Commands
```bash
pnpm install
pnpm lint && pnpm typecheck
pnpm test:engine                 # unit + property tests, coverage thresholds
pnpm test:api                    # needs PostgreSQL (TEST_DATABASE_URL, default postgres://postgres@localhost:5432/salon_test)
pnpm --filter @salon/web test    # contrast + helpers
pnpm test:e2e                    # Playwright (E2E_DATABASE_URL, default …/salon_e2e); --update-snapshots after intended UI changes
pnpm lighthouse                  # with the e2e server running (node e2e/start.mjs)
pnpm seed && pnpm dev            # local demo: API :3000, web :5173
```

## Test data
Seed is deterministic (`apps/api/src/seed/seed.ts`); e2e freezes time at `2026-11-02T06:00Z` (Monday 07:00 Berlin). Drag & drop e2e tests use empty days in March 2027 (one week per device profile).
