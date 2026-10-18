# Progress Log

| Phase | Status | Date | Commit |
|---|---|---|---|
| 0 Setup & tooling | ✅ done (Atlas `db:check` to be confirmed by owner) | 2026-10-18 | `feat(phase-0)` |
| 1 Foundations | ✅ done (login against Atlas to be tried by owner) | 2026-10-18 | `feat(phase-1)` |
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
- [0] Vitest projects `unit` (tests/unit) and `integration` (tests/integration, in-memory replica set); `server-only` aliased to a stub in tests. Playwright uses Chromium only (server setup changed in Phase 1, see below).
- [0] Husky pre-commit: `npx lint-staged` then `npm run verify` (docs/02 §7).
- [0] `cn()` comes from shadcn's `cn` package (shadcn-ui/cn) instead of clsx + tailwind-merge — current shadcn default.
- [1] Auth: Better Auth 1.7 email/password, MongoDB adapter with its own lazily-connecting `MongoClient` (Mongoose connects async; two small pools). Collections `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_rate_limits`. Sign-in/up rate limit 5/min (production only, Better Auth default). Password 8–128 chars. `DISABLE_SIGNUP=true` closes registration.
- [1] `requireUser()` (React `cache()`, one session read per request) returns `Ctx {userId, tz, baseCurrency}` and creates settings on first use via an atomic upsert — this is "created on first login". `server/auth` therefore depends on the settings service.
- [1] `src/proxy.ts` only checks that a session cookie exists (→ `/login?next=…`); it does not bounce signed-in users off /login (a stale cookie would loop). `next` is restricted to same-site relative paths.
- [1] cacheComponents: session reads live in components behind `<Suspense>` (topbar `UserArea`, `SettingsContent`); shell and nav are prerendered; the nav highlight (`usePathname`) streams in behind Suspense. Every app route is Partial Prerender.
- [1] "Hide amounts" = `<html data-hide-amounts>` + CSS blur on `[data-money]`, restored before paint from localStorage by an inline script, then synced to `settings.hideAmounts` (source of truth) once the session loads — no flash, no session-dependent context.
- [1] Money format `LKR 1,250,000.00`, negatives `-LKR 1,250.00`, compact `LKR 1.25M` (full value in a tooltip). Formatting passes an exact decimal string to `Intl` (no float division). Percent: 1 decimal, half away from zero.
- [1] `allocateLargestRemainder` supports negative totals (symmetric) and any non-negative integer weights; throws on empty or all-zero weights.
- [1] `MoneyInput` / `PercentInput` keep the typed text and emit integer minor units / bp (NaN while invalid so Zod reports it). Parsing is string-based (`parseScaledDecimal`), never `parseFloat`.
- [1] userId guard via `userScopedModel()` per schema: find/update/delete/count/distinct need `userId`; aggregate's first stage must `$match` it. Opt out with `skipUserIdGuard`. Active outside production only (docs/02 §5).
- [1] Settings page has Profile (name; change password, which signs out other devices) and Preferences tabs now; Categories / Asset classes / FX / Data tabs come with their phases. Ranges: staleDays 1–365, big change 1–100%, drift 0.5–50%, emergency months 1–24, life cover ×1–30.
- [1] Mobile: bottom nav (Dashboard, Transactions, Assets, SIP, More → sidebar sheet). Global search is a disabled placeholder; the notifications bell links to /notifications (unread count in Phase 10).
- [1] E2E: `scripts/e2e-server.ts` starts an in-memory replica set, runs `next build` then `next start` on :3100 (Next 16 refuses a second `next dev` in the same folder; also keeps tests off Atlas). `E2E_SKIP_BUILD=1` reuses the last build. Tests register their own users.
- [1] TanStack Table v9 (`useTable`, explicit `tableFeatures`); `DataTable` exports `dataTableColumns<Row>()` for typed columns.

## Deviations from docs
<!-- Claude: anything built differently from the docs, and why. Update the doc too if the user agrees. -->
- [0] `middleware.ts` → `src/proxy.ts` (Next 16 renamed Middleware to Proxy; with a `src/` dir it lives in `src/`). docs/02 and the Phase 1 prompt updated. Created in Phase 1.
- [0] Phase 0 acceptance "`docker compose up -d` gives a replica set" replaced by "`npm run db:check` passes against Atlas" (owner request). CLAUDE.md, START-HERE.md, docs/02, docs/06 and `.env.example` updated.
- [0] Added `src/instrumentation.ts`, `scripts/db-check.ts`, `src/components/layout/placeholder-page.tsx` (not in docs/02 tree; tree updated for the first two).
- [1] The testing skill says e2e runs "against npm run dev with a seeded test user"; it runs against a production build on an in-memory DB and registers its own users (see Decisions).

## Open questions for the owner
<!-- Claude: questions that need a human answer. -->
- [0] Please run `npm run db:check` in your own terminal and confirm it passes. Claude's sandboxed shell routes Node DNS to 127.0.0.1, so the `mongodb+srv` SRV lookup was refused there (Windows itself resolves the record fine); env validation of `.env.local` did pass.
- [1] Then try register/login in the browser against Atlas (`npm run dev`). All auth flows pass e2e on the in-memory DB. Once your account exists, consider `DISABLE_SIGNUP=true`.

## Known issues / tech debt
- [0] Node v25.8.1 (non-LTS) on the dev machine; everything works so far. Consider Node 24 LTS if a tool breaks.
- [0] `npm audit` reports 5 high-severity issues in dev-only dependencies; production deps: 0.
- [1] `periods.ts` builds calendar dates with the process-local `Date` before converting with date-fns-tz; correct for UTC and Asia/Colombo servers, but a server TZ with a DST jump at midnight could misplace a boundary. Revisit if deploying outside UTC.
- [1] `baseCurrency` can be changed freely for now; once ledger data exists (Phase 2+) it may need a warning or lock.
- [1] Next 16 keeps visited pages mounted but hidden (`<Activity>`), so forms keep their state across navigation (e2e locators filter to visible fields).
- [0] `next dev` maintains a managed block in `AGENTS.md` (Next.js agent rules); commit it as-is.
