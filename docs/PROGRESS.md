# Progress Log

| Phase | Status | Date | Commit |
|---|---|---|---|
| 0 Setup & tooling | ✅ done (Atlas `db:check` to be confirmed by owner) | 2026-10-18 | `feat(phase-0)` |
| 1 Foundations | ✅ done (login against Atlas to be tried by owner) | 2026-10-18 | `feat(phase-1)` |
| 2 Accounts & ledger | ✅ done | 2026-10-18 | `feat(phase-2)` |
| 3 Holdings & returns | ✅ done | 2026-10-18 | `feat(phase-3)` |
| MOD-1 Phase 1 additions | ✅ done | 2026-10-18 | `feat(mod-1)` |
| MOD-2 Phase 2 additions | ⬜ | | |
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
- [2] Ledger engine (`src/server/ledger/post|void|recompute.ts`) is the only writer of transactions and balance caches; `domain/ledger.ts` (`accountEffects`, `computeBalance`, `runningBalances`, `cashflowOf`, `validateSplits`, `reconcileAdjustment`) is the single definition of docs/04 §1/§4 used by the engine, queries and tests. Recompute reads posted txns and applies `accountEffects` (never `$inc`). Phase 2 posts income/expense/transfer/adjustment; other types are rejected until their phases.
- [2] Business dates are stored as local midnight in the user's timezone (`businessDateToUtc`). Changing timezone later keeps the stored instants. A transaction dated before an account's opening date is rejected (opening balance is "as of" that date); moving the opening date after existing transactions is rejected too.
- [2] Seeding: `ensureUserSetup()` (called by `requireUser`) creates settings, then once — guarded by an atomic `settings.bootstrapVersion` claim inside a transaction — seeds the 7 system categories (both kinds of "Uncategorised"; "Balance adjustment" stored as an expense category but excluded from cashflow by type), an editable starter set (owner-approved) and the 7 asset classes. System categories/classes also have unique partial indexes. Phase 1 users are seeded on their next request.
- [2] Adjustments are created only by Reconcile (not Quick add); they always use the system "Balance adjustment" category and `source.kind = reconcile`.
- [2] Edit = void original (`voidReason: "Edited"`) + post replacement (`replacedById` on the original) in one DB transaction; the replacement keeps the original's source and groupId. Income/expense/transfer are user-editable; adjustments can only be voided; owner-managed sources (SIP/deployment) cannot be edited or voided directly.
- [2] Cross-currency transfer: `toAmountMinor` required when currencies differ; implied major-unit rate stored in `fxRate` (12 significant digits); for same-currency transfers `toAmountMinor` is ignored (stored null).
- [2] Liability forms (card, loan, payable) take the amount owed as a positive number and store it negative; Reconcile on a liability likewise asks for "actual amount owed".
- [2] Account `type` is fixed after creation; currency can change only while the account has no transactions. Archive with a non-zero balance needs `force` (the UI confirm states the balance and that it still counts in net worth).
- [2] Before Phase 4 (FX), account subtotals are per currency and the /transactions summary strip sums base-currency income/expense only, showing an "FX missing" badge with the count left out.
- [2] /transactions: URL filters (preset, from/to, type, account, category incl. subcategories and split lines, tag, min/max amount, text search on description/payee/notes, show voided), 50 per page, newest first. Text search uses a case-insensitive regex (partial words) rather than the `$text` index, which stays defined per docs/03. On phones the filters fold behind a toggle.
- [2] Quick add: one global sheet (topbar button, `N` key, per-account "Add transaction"), tabs Expense (single category or split with "Fill remaining") / Income / Transfer (implied rate shown); remembers last accounts in localStorage; switching tabs carries the current account across (bug found in visual review: income went to a different account). Options load per open via a server action because the shell is static.
- [2] Account detail: balance history as a single-series step area chart (dataviz: slot-1 `#2a78d6`/`#3987e5` validated against our surfaces, 2px line, 10% wash, crosshair + tooltip, monthly ticks); the transactions table with running balance is its table view. Fewer than 2 days of history shows a sentence instead of a chart.
- [2] `AUTH_RATE_LIMIT=on|off` (default on, production only). Only the e2e server sets `off` — its `next start` is production mode and tests register more than 5 users a minute.
- [3] **Same-day ordering = entry order (owner decision).** docs/04 §3 said a valuation dated D includes every flow dated ≤ D; that swallowed same-day activity (add a holding today then buy today → buy invisible; value today then redeem today → wrong gain). Events now sort by date, then by entry (createdAt). docs/04 §3 updated with the rule and an example.
- [3] **NAV precision (owner decision):** prices are `priceMinorE4` / `lastPriceMinorE4` = minor units × 10⁴ (NAV 12.3456 LKR = 123456); units are numbers rounded to 6 decimals. docs/03 updated (`priceMinor` → `priceMinorE4`).
- [3] Holding currency must equal the funding/receiving account currency until FX (Phase 4); the error says so.
- [3] `recomputeHolding` replays transactions + valuations (`domain/holdings.replayHolding`) and rewrites redemption figures when they change, so backdated buys/edits correct later redemptions; cash effects never depend on them. Redemption cost uses an exact BigInt `mulDivRound`.
- [3] Fees on redemptions also count in `feesPaidMinor` (docs/04 table lists only buy fees; realised gain already nets them).
- [3] Redeem by amount on a unit-tracked holding removes units proportionally. On buys with units on, the missing one of units/price is derived from the amount.
- [3] Fixed deposits: value is computed live from the terms (§9) on read (it accrues daily; caches refresh on write; monthly `fd_calc` valuations come with the Phase 10 cron). Every FD redemption is a full withdrawal (amount = what the bank paid; realised gain = amount − invested − fee), which also covers early withdrawals with penalties. Withdraw closes the FD; Renew = redeem into an account + invest into a new FD from it (one DB transaction, shared groupId, old FD closed). Payout-FD interest reminders are Phase 10; record payouts as investment income meanwhile.
- [3] Valuations can be deleted (owner-approved: they are inputs, not ledger records); manual valuations are refused on FDs. Big change = exact `|new − old| × 10000 > threshold × old` (a rounded-bp comparison missed 20.001% vs 20% — caught by tests).
- [3] Close holding with value needs `force` (confirm states the value); reopen supported. Asset classes refuse archiving while active holdings use them.
- [3] Portfolio totals/weights/XIRR use base-currency holdings only (other currencies counted under "FX missing"). Closed holdings' flows stay in portfolio and class XIRR. XIRR null under 90 days (shown as "—").
- [3] Transaction lists show holding transactions as "Buy/Redeem/Dividend…" with the holding as the category; amounts are cash-signed (buy −(amount+fee), redeem +(amount−fee−tax), paid income +(amount−tax)); opening balances and reinvested income show "no cash moved"/"reinvested". The /transactions summary counts paid-out investment income as income (docs/04 §4).
- [3] Value vs invested chart: two series → validated slots 1/2 (`--viz-series-1/2`, light and dark), legend, crosshair tooltip listing both.
- [3] `tsconfig` target raised to ES2022 (BigInt literals). Holding enums live in `holdings/constants.ts` so client components don't pull Mongoose into the browser bundle (caught by the production build).
- [3+] **Transfer fee (owner request, after Phase 3):** optional `feeMinor` on transfers, charged to the source account on top of the amount (source currency; receiver gets the full amount/toAmount). The transfer is tagged with the system category "Bank fees" and only the fee counts as expense in cashflow and the /transactions summary. Void/edit/recompute handle it via `accountEffects`. docs/03 and docs/04 §1/§4 updated.
- [2] Settings gained Categories (tree, add/rename/archive/restore, essential flag) and Asset classes (colour, order, add/archive custom) tabs. System categories/classes can't be renamed or archived; colours and essential flags can change.
- [mod] One planned allocation; earmarks (partial-account buckets) added; time-range analytics computed on the fly
  with monthly snapshots as cache; in-transit redemptions use a receivable account — owner decision after Phase 3.
- [mod-1] Emergency settings: `emergencyExpenseBasis` (essential|all|manual, default essential), `emergencyManualMonthlyMinor`,
  `emergencyTargetOverrideMinor` (positive minor units, `null` = unset). "Manual needs an amount" is checked in the service
  on the merged result (updates are partial) and in the form. `domain/essentials.emergencyTarget()` is pure; the 6-month
  averages are its inputs (Phase 10). The Preferences card explains the formula but shows no live target until then.
- [mod-1] Mailer (`src/server/mail`): Resend via its REST API with `fetch` (no SDK); console driver when `RESEND_API_KEY` is
  empty — development logs the whole email, production logs only "mail not configured" (no link/token). `MAIL_CAPTURE_FILE`
  (test only) makes the console driver append each email as JSON; only the e2e server sets it.
- [mod-1] Better Auth: `requestPasswordReset` → `/reset-password?token=` (1 h, revokes all sessions); verification only when
  `REQUIRE_EMAIL_VERIFICATION=true` (sent on sign-up, 24 h link, auto sign-in after verifying; unverified login → 403
  `EMAIL_NOT_VERIFIED` → /verify-email with a 60 s resend cooldown). Twofactor plugin: issuer WealthTrack, collection
  `auth_two_factors`, enabled only after the first code is confirmed, 10 backup codes, lockout after 5 failed codes for 15 min,
  "trust this device" 30 days. Secret and backup codes are encrypted by Better Auth with `BETTER_AUTH_SECRET` — no new key;
  rotating that secret breaks existing enrolments (documented in `.env.example`).
- [mod-1] `session.freshAge: 0` so the session list works on any session (Better Auth otherwise refuses after 1 day); enabling,
  disabling 2FA and new backup codes still require the password. Session tokens never reach the browser: revoking one
  device is a server action that takes the session id.
- [mod-1] Production rate limits added: password-reset requests and verification resends 3/min, `/two-factor/*` 5/min (plus
  Better Auth's built-in 3 per 10 s). `AUTH_RATE_LIMIT=off` (e2e) still disables them all.
- [mod-1] Settings: the password form moved from Profile to the new Security tab (password, two-factor, sessions).
  QR codes are rendered client-side with `qrcode` (SVG). Login keeps `?next=` through /two-factor.
- [mod-1] `npm run reset-password -- <email> <newPassword>` (`scripts/reset-password.ts`) uses Better Auth's own hashing and
  adapter (`ctx.password.hash`, `internalAdapter.updatePassword`) and signs the user out everywhere; 2FA is left as is.

## Deviations from docs
<!-- Claude: anything built differently from the docs, and why. Update the doc too if the user agrees. -->
- [0] `middleware.ts` → `src/proxy.ts` (Next 16 renamed Middleware to Proxy; with a `src/` dir it lives in `src/`). docs/02 and the Phase 1 prompt updated. Created in Phase 1.
- [0] Phase 0 acceptance "`docker compose up -d` gives a replica set" replaced by "`npm run db:check` passes against Atlas" (owner request). CLAUDE.md, START-HERE.md, docs/02, docs/06 and `.env.example` updated.
- [0] Added `src/instrumentation.ts`, `scripts/db-check.ts`, `src/components/layout/placeholder-page.tsx` (not in docs/02 tree; tree updated for the first two).
- [1] The testing skill says e2e runs "against npm run dev with a seeded test user"; it runs against a production build on an in-memory DB and registers its own users (see Decisions).
- [2] docs/03 `{userId, importHash} unique sparse` → unique **partial** index (`importHash` is a string). A compound sparse index indexes every document that has `userId`, so all non-imported transactions collided on `importHash: null` (caught by the first integration test). docs/03 updated.
- [2] `settings.bootstrapVersion` added (not in docs/03) for exactly-once seeding; docs/03 updated.
- [2] `categoryRules` collection not created yet — it belongs to CSV import (Phase 11).
- [3] docs/04 §3 same-day valuation rule changed to entry order (owner-approved); docs/03 price fields renamed to `*PriceMinorE4` (owner-approved). Both docs updated.
- [3] No `auto_on_buy` / `auto_on_redeem` valuations are written: values follow from the §3 replay rule, so they would duplicate it. The enum values remain for later use.

## Open questions for the owner
<!-- Claude: questions that need a human answer. -->
- [0] Please run `npm run db:check` in your own terminal and confirm it passes. Claude's sandboxed shell routes Node DNS to 127.0.0.1, so the `mongodb+srv` SRV lookup was refused there (Windows itself resolves the record fine); env validation of `.env.local` did pass.
- [1] Then try register/login in the browser against Atlas (`npm run dev`). All auth flows pass e2e on the in-memory DB. Once your account exists, consider `DISABLE_SIGNUP=true`.

## Known issues / tech debt
- [0] Node v25.8.1 (non-LTS) on the dev machine; everything works so far. Consider Node 24 LTS if a tool breaks.
- [0] `npm audit` reports 5 high-severity issues in dev-only dependencies; production deps: 0.
  [mod-1] Now 9 high, all in tooling (`shadcn` CLI and its `ts-morph`/`fast-glob`/`micromatch`/`braces` chain,
  `eslint-config-next`); none in `qrcode` or runtime code. `shadcn` sits in `dependencies` and could move to devDependencies.
- [mod-1] Better Auth TOTP has no replay protection inside the 30 s window (a code can be reused once more in that window);
  lockout and rate limits bound guessing. Email verification is integration-tested only (e2e runs with it off).
- [1] `periods.ts` builds calendar dates with the process-local `Date` before converting with date-fns-tz; correct for UTC and Asia/Colombo servers, but a server TZ with a DST jump at midnight could misplace a boundary. Revisit if deploying outside UTC.
- [1] `baseCurrency` can be changed freely for now; once ledger data exists (Phase 2+) it may need a warning or lock.
- [1] Next 16 keeps visited pages mounted but hidden (`<Activity>`), so forms keep their state across navigation (e2e locators filter to visible fields).
- [2] Debt payments will need the loan account found through their debt when recomputing (Phase 8): `recomputeAccount` currently looks only at `fromAccountId`/`toAccountId`.
- [2] `recomputeAccount` loads all of an account's posted transactions (fine for thousands; Phase 12 perf check with 10k transactions may move it to an aggregation using the same effect rules).
- [3] Back-filling caveat of the entry-order rule: a buy dated the same day as an existing valuation, entered later, adds on top of it (date it a day earlier or re-enter the valuation after it).
- [3] FD values shown are live; the stored cache only refreshes on writes until the Phase 10 cron. Anything reading `holdings.currentValueMinor` directly for FDs (e.g. Phase 4 snapshots) must use the §9 formula instead.
- [3] Portfolio queries replay nothing for list XIRR (they use transaction flows only) but load every holding transaction once; fine for thousands, revisit in the Phase 12 perf check.
- [3] Fixed during this phase: the shared DatePicker could not navigate past the current year (react-day-picker dropdown captions default to it) — FD maturities were impossible to pick.
- [2] Recharts tooltip can overlap the y-axis labels near the left edge; cosmetic.
- [0] `next dev` maintains a managed block in `AGENTS.md` (Next.js agent rules); commit it as-is.
