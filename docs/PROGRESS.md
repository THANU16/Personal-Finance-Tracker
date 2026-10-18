# Progress Log

| Phase | Status | Date | Commit |
|---|---|---|---|
| 0 Setup & tooling | ✅ done (Atlas `db:check` to be confirmed by owner) | 2026-10-18 | `feat(phase-0)` |
| 1 Foundations | ⬜ | | |
| 2 Accounts & ledger | ⬜ | | |
| 3 Holdings & returns | ⬜ | | |
| 4 Dashboard, snapshots, FX | ⬜ | | |
| 5 SIP planner | ⬜ | | |
| 6 Rebalancing | ⬜ | | |
| 7 Opportunity Fund | ⬜ | | |
| 8 Debts & receivables | ⬜ | | |
| 9 Recurring, budgets, goals | ⬜ | | |
| 10 Essentials, notifications, cron, forecast | ⬜ | | |
| 11 Reports, import/export, attachments | ⬜ | | |
| 12 Hardening & release | ⬜ | | |

Status values: ⬜ not started · 🟡 in progress · ✅ done

## Decisions
<!-- Claude: record choices made where docs were silent. Format: - [phase] decision — reason -->
- [0] Next.js 16.4.2 / React 19.3 / Mongoose 9 / Zod 4 / Vitest 4 / Tailwind 4 / shadcn (base-nova, neutral). `cacheComponents` left on as scaffolded.
- [0] Dev DB is MongoDB Atlas (owner on Windows, no Docker). `docker-compose.yml` kept as an optional local replica set. Added `npm run db:check` (connect → assert replica set → commit a transaction on `_dbcheck`, then delete the doc).
- [0] npm scripts are shell-neutral (PowerShell/cmd/bash); helper scripts are TS in `scripts/` run with `tsx --conditions=react-server` so modules importing `server-only` work outside Next.
- [0] `src/server/env.ts` exports `envSchema`, `parseEnv(source)` and a memoised `getEnv()`; `src/instrumentation.ts` calls it at server start so bad env fails fast. Errors list variable names, never values. Min lengths: `BETTER_AUTH_SECRET` ≥ 32, `CRON_SECRET` ≥ 16; S3 vars required when `STORAGE_DRIVER=s3`; `MAIL_FROM` required when `RESEND_API_KEY` set; empty strings = unset.
- [0] Skeleton: every page in docs/02 §3 exists as a `PlaceholderPage` ("Coming in Phase N"); route handlers return 501; empty folders hold `.gitkeep` (no empty domain/module stubs — each phase creates real files).
- [0] `/` → `/dashboard` via `next.config.ts` `redirects()` (temporary) instead of a page that calls `redirect()` (that logs a prerender error under cacheComponents).
- [0] ESLint enforces `no-explicit-any` and `import/no-default-export` (off for Next.js page/layout/error/not-found files, `src/proxy.ts`, `*.config.*`). Prettier skips `*.md` and `.claude/` so specs keep their authored formatting.
- [0] Vitest projects `unit` (tests/unit) and `integration` (tests/integration, in-memory replica set); `server-only` aliased to a stub in tests. Playwright uses Chromium only and starts `npm run dev`.
- [0] Husky pre-commit: `npx lint-staged` then `npm run verify` (docs/02 §7).
- [0] `cn()` comes from shadcn's `cn` package (shadcn-ui/cn) instead of clsx + tailwind-merge — current shadcn default.

## Deviations from docs
<!-- Claude: anything built differently from the docs, and why. Update the doc too if the user agrees. -->
- [0] `middleware.ts` → `src/proxy.ts` (Next 16 renamed Middleware to Proxy; with a `src/` dir it lives in `src/`). docs/02 and the Phase 1 prompt updated. Not created yet — Phase 1.
- [0] Phase 0 acceptance "`docker compose up -d` gives a replica set" replaced by "`npm run db:check` passes against Atlas" (owner request). CLAUDE.md, START-HERE.md, docs/02, docs/06 and `.env.example` updated.
- [0] Added `src/instrumentation.ts`, `scripts/db-check.ts`, `src/components/layout/placeholder-page.tsx` (not in docs/02 tree; tree updated for the first two).

## Open questions for the owner
<!-- Claude: questions that need a human answer. -->
- [0] Please run `npm run db:check` in your own terminal and confirm it passes. Claude's sandboxed shell routes Node DNS to 127.0.0.1, so the `mongodb+srv` SRV lookup was refused there (Windows itself resolves the record fine); env validation of `.env.local` did pass.

## Known issues / tech debt
- [0] Node v25.8.1 (non-LTS) on the dev machine; everything works so far. Consider Node 24 LTS if a tool breaks.
- [0] `npm audit` reports 5 high-severity issues in dev-only dependencies; production deps: 0.
- [0] `tests/integration/smoke-db.test.ts` is a placeholder; Phase 1 replaces it with `tests/helpers/test-db.ts`.
- [0] `next dev` maintains a managed block in `AGENTS.md` (Next.js agent rules); commit it as-is.
