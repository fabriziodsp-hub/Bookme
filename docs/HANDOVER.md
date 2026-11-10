# Handover – read this first

Context for a new Claude Code session. The project was built in a Cowork chat (Oct–Nov 2026); everything that matters is in this repository.

## Working agreements
- Answer in **Italian**: short, explain technical terms in brackets, step by step.
- Development machine: Windows with Docker Desktop; real-device tests on an iPhone.
- Give honest pushback with reasons (see `docs/decisions.md`, e.g. retention, consent, fee amount).
- Ask before decisions that belong to the owner (see "Open decisions" below).

## Where things are
- Rules and conventions: `CLAUDE.md`
- Status and next steps (Italian): `docs/STATO-E-PROSSIMI-PASSI.md`
- Every decision with reason: `docs/decisions.md` (D-001 … D-047, T-001 … T-022)
- Spec + owner answers: `docs/spec.md` §10; legal notes: `docs/legal.md`; requirement → test: `docs/traceability.md`
- Portfolio screenshots: `node e2e/portfolio-shots.mjs <outdir>` with `node e2e/start.mjs` running

## Resolved on 2026-11-10
1. GitHub `main` now matches the reference zip (stray root files removed, missing files added; PR #1). CI is green. The original 25-commit history exists only in `salon-booking-completo.zip`; GitHub has the upload history plus one sync commit.
2. `docker compose up --build` verified (cloud sandbox and the owner's Windows PC with Docker Desktop). The Dockerfile keeps pnpm in the image (`COREPACK_HOME`), so the app starts without internet access.
3. The owner's working copy is `%USERPROFILE%\Claude GitHub\Bookme` (a clone of GitHub, outside OneDrive). Old copies in OneDrive contain nothing that is not on GitHub.
4. Upload via the GitHub web UI is no longer needed: work on a branch, open a PR, merge after green CI.

## Open decisions (ask the owner, do not decide alone)
- A-07 retention (owner said "10 years", we keep 12 months for booking data – postponed).
- D-046 till/POS integration: which till system does the salon use, does it have an API?
- Legal review (Impressum, Datenschutz, fee wording, consent form for allergies).

## How to verify
```bash
pnpm install
pnpm lint && pnpm typecheck
pnpm test:engine && pnpm --filter @salon/web test
pnpm test:api      # needs PostgreSQL 16 (TEST_DATABASE_URL)
pnpm test:e2e      # Playwright, starts its own server
docker compose up --build   # demo on http://localhost:3000/salon-beispiel
```
Last full run: engine 94, web 28, API 54, e2e 75 (+6 skipped), Lighthouse 96/100/96/91.
