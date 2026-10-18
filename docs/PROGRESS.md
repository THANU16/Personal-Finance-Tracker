# Progress Log

| Phase | Status | Date | Commit |
|---|---|---|---|
| 0 Setup & tooling | ✅ done (Atlas `db:check` to be confirmed by owner) | 2026-10-18 | `feat(phase-0)` |
| 1 Foundations | ✅ done (login against Atlas to be tried by owner) | 2026-10-18 | `feat(phase-1)` |
| 2 Accounts & ledger | ✅ done | 2026-10-18 | `feat(phase-2)` |
| 3 Holdings & returns | ✅ done | 2026-10-18 | `feat(phase-3)` |
| MOD-1 Phase 1 additions | ✅ done | 2026-10-18 | `feat(mod-1)` |
| MOD-2 Phase 2 additions | ✅ done | 2026-10-18 | `feat(mod-2)` |
| 4 Dashboard, snapshots, FX | ✅ done | 2026-10-18 | `feat(phase-4)` |
| 5 SIP planner | ✅ done | 2026-10-18 | `feat(phase-5)` |
| 6 Allocation (rebalancing) | ✅ done | 2026-10-18 | `feat(phase-6)` |
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
- [3] Holding currency must equal the funding/receiving account currency; the error says so. (Phase 4 kept this rule — only cross-currency transfers mix currencies.)
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
- [mod-2] Earmarks: `domain/earmarks.ts` (pure: `rawEarmark`, `effectiveEarmarks`, `dipCheck`, `earmarksAfterDip`,
  `moveBetweenBuckets`, account rules) and `modules/earmarks` (`setEarmark` upserts one earmark per bucket per account,
  `removeEarmark` deletes it — earmarks are not ledger records; `moveBetweenBuckets`; `getAccountBuckets`, `listAccountBuckets`,
  `getBuckets` per currency until FX in Phase 4). Every earmark write is audited (`earmark_set/remove/move/dip`).
- [mod-2] Dip guard in `postTransaction` (owner-approved decisions): exempt sources apply on every account; the guard uses the
  current balance; a confirmed dip stores the dipped buckets as fixed amounts; voids never restore earmarks. All warnings
  are returned whenever any is unconfirmed, so the dialog always shows the full picture. Warnings carry amount, currency and
  account name; `ActionResult` errors gained `warnings`. docs/04 §20 records these notes.
- [mod-2] Edits: the guard runs after the original is voided (the original outflow is back in the balance), so only the
  increase is checked; an edit that does not increase the outflow on the same account is never guarded.
- [mod-2] UI: shared `BucketBar` (emergency = `--viz-series-1`, opportunity = `--viz-series-2`, free = neutral grey; legend
  and an aria summary, never colour alone). Accounts list shows the bar for earmarked accounts and "All emergency/opportunity
  money" for dedicated ones, plus an Over-earmarked badge; "Earmark / move" in the row menu and on account detail (Earmarks
  card with edit/remove); Quick add (create and edit) shows a confirm dialog; emergency needs a ticked checkbox.
- [4] FX: `domain/fx.ts` (latest rate on/before the date, direct else inverse, null when missing — never 1:1; conversion respects
  each currency's minor digits, half away from zero). `fxRates` unique per user/pair/day (saving again replaces); Settings → FX
  rates tab. Now converted to base: account group subtotals (today's rate), the /transactions summary (each day's rate),
  portfolio totals/weights (today) and portfolio/class XIRR (each flow at its date; a holding with any missing rate is left out),
  earmark buckets (`getBucketsInBase`). Anything without a rate is excluded and badged "FX rate missing".
- [4] Net worth: `domain/series.ts` `computeNetWorthSeries` is one pass over transactions + valuations sorted by (date, entry
  order); holdings use the same incremental replayer as `recomputeHolding` (`createHoldingReplayer`, extracted from
  `replayHolding` without behaviour change); FDs use §9 at each date. Accounts count from their opening date. Assets = positive
  balances + holding values; liabilities = |negative balances| (an overdrawn bank counts as a liability); cash = positive balances
  of bank/cash/wallet/broker_cash/opportunity_fund.
- [4] Snapshots: `rebuildHistory` upserts every completed month-end in one pass and removes stale auto snapshots (idempotent);
  `ensureMonthEndSnapshot` is the job function for the Phase 10 cron; manual snapshot = today. Month granularity over ranges ≥ 366
  days or "All" reads the cache and computes only missing month-ends live.
- [4] Time ranges: presets Today/7D/30D/3M/6M/YTD/1Y/All/Custom (default 6M), `?r=&from=&to=&g=&cmp=` in the URL (`r` added
  so rolling presets stay rolling on reload). Buckets are business-date keys clipped to the range; weeks start Monday; the
  previous period has the same number of days and is aligned by bucket index (missing buckets → null).
- [4] Flows: one aggregation per range — `$dateTrunc` to the day in the user timezone, grouped by day/type/currency, converted at
  that day's rate, then bucketed in the domain. Income = income + investment income paid out; expense = expense + transfer fees +
  loan interest; invest amounts exclude fees (investment rate). Top categories roll children up to their parent, count split lines
  and file transfer fees under their category (Bank fees).
- [4] Standing: runway = (cash + high-liquidity holdings) ÷ average expense of the last 3 complete months, in tenths of a month;
  debt load and health score are null until Phases 8/10 and show "—". Safe to spend = free cash (base) − unposted outflows due by
  month end; today only card dues contribute (full outstanding, owner decision) — `getUpcoming` items carry
  `outflowMinor`/`accountId` so SIPs (5), EMIs (8) and recurring (9) plug in.
- [4] Charts (owner decisions): savings rate is its own small chart under income vs expense (no dual axis); asset classes use the
  validated categorical palette in fixed slot order (blue, orange, aqua, yellow, magenta, green, violet) via `--viz-cat-N`
  light/dark tokens. Bootstrap v3 moves untouched system class colours to it; the class colour picker offers palette swatches.
  Every chart has a legend, an aria summary and a table view; the previous period is a neutral dashed line; > 30 bars scroll
  horizontally. /assets accepts `?class=` (donut click-through); top categories open /transactions with the same range.
- [4] Dashboard widgets each sit in their own Suspense boundary with skeleton, empty and error states (an error card keeps the rest
  of the page working); the ledger is read once per request (React `cache`).
- [fix] Duplicate starter categories (owner report): the first-login seed is now idempotent (upserts by kind/parent/name) and
  bootstrap v2 merges existing duplicates into the oldest copy, moving transactions, split lines (combined when they collide)
  and sub-categories first. Commit `fix(categories)`.
- [fix] Categories duplicated ~180× on the owner's account: a long-running dev server kept the Phase 1 Settings model
  (`userScopedModel` reused cached models on hot reload), so Mongoose dropped the unknown `bootstrapVersion` from the
  claim query and update — first-login setup re-ran on every request. Models are now recompiled on re-evaluation; the
  claim treats a missing version as 0; the merge is batched per group and runs as bootstrap v4 for everyone.
  `npm run repair:categories -- <email>` repairs one account on demand (owner's account: 3,507 → 27, all references intact).
- [seed] `npm run seed -- <email> [--append]` adds ~6 months of demo data to one existing user (Phase 12 will extend it).
- [5] Allocation: `domain/allocation.ts` (`validateTree`, `splitByTree` — largest remainder at both levels, ties → earlier;
  `autoBalance`) and `domain/rebalance.ts` `cashflowSplit` (§8, used for the SIP drift tilt now). The target allocation lives in
  `modules/allocation` (one per user + `targetAllocationHistory` row on every save) and is edited on /rebalancing → Plan (owner
  decision: the rest of that page is Phase 6). Sidebar/heading renamed "Allocation" (docs/05 §1). The target may leave a class
  without holdings; SIP custom trees must name holdings in the plan's currency.
- [5] SIP engine (`domain/sip.ts`, `modules/sip`): monthly day 31 = last day; weekly 0 = Sunday, ISO week keys; step-up from
  plan start in whole major units; carry-in from the previous period when missed/partial (carry_forward). Executions are created
  idempotently (unique planId+periodKey) up to today + 7 days by `generateDueExecutions`, which also re-plans every not-yet-
  executed `due` execution (version, step-up, carry-in, tree) and marks overdue ones missed. Until the Phase 10 cron, it runs
  whenever SIP data is read (SIP pages, dashboard Upcoming) — owner decision.
- [5] Versions: amount or allocation changes create version N+1 effective from the next unexecuted due date; name/notes/rules
  edits don't; schedule changes drop unexecuted periods and regenerate. Target-based plans store the tree actually used in
  `allocationUsed` at generation and it is frozen at execution, so target edits change future periods only.
- [5] Execute (one DB transaction): the dip guard runs once on the TOTAL (Σ actual + fee) via `guardGroupOutflow`; postings then
  carry the internal `dipGuardDone` flag so earmarks are reduced once. One `invest` per line with actual > 0 (source
  sip_execution, shared groupId, optional units/price). Actual 0 is rejected (skip instead). A class without a holding in the tree
  asks for one at execution (owner decision). Below-zero source balance warns, never blocks. Undo voids the group through its
  owner and resets the period to due (or missed past grace); skips can be undone too.
- [5] Plan performance = estimated share (plan invested in a holding ÷ holding invested × holding value), XIRR from the plan's
  invest flows + estimated terminal value; consistency = on-time done ÷ periods due so far.
- [5] Upcoming/safe to spend: `getUpcoming` includes generated due/missed periods and projected ones up to the requested date;
  `outflowMinor` only when the source account is earmarkable (§21).
- [6] `domain/drift.ts`: universe = active holdings with value whose class is in the target, excluding emergency-flagged
  ones (classes outside the target and the emergency amount are reported separately). Drift in bp; flagged at |drift| ≥
  threshold (exactly at the threshold counts). Asset drift is within the class; holdings in a class with holding targets but
  not listed count with a 0% target (owner decision) — the full rebalance suggests selling them.
- [6] Full rebalance: target amounts by largest remainder over class% × asset% weights, so Σ trades = 0 exactly; a class without
  holding targets gives one class-level line (pick the holding in Quick add). FD lines are shown but not applicable ("withdraw
  or renew the FD instead", owner decision). "Invest new money" = cashflow rebalance (only buys).
- [6] Values = today's base-currency values from the dashboard's single pass (FDs via §9; no FX rate → left out + badge).
- [6] Apply opens Quick add pre-filled (type invest/redeem, holding, amount — Quick add gained `amountMinor` prefill).
  "Use for next SIP" sets `useTilt` on the plan's next due period; its Execute screen opens on the drift-tilted split.
- [6] /rebalancing tabs Plan · Planned vs Actual · Rebalance · History (?tab=). History diffs each saved target against the
  previous one (class % changes, holdings added/removed, threshold). Drift gauge shades the tolerance band (± threshold) and
  always shows the drift and an OK/Over/Under chip with an icon. Dashboard Attention shows "N asset classes off target".

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
- [4] docs/05 §2 "savings-rate line on a right axis" → a separate savings-rate chart (owner-approved; docs/05 and the
  analytics-charts skill updated). Seeded asset-class colours replaced by the validated palette (owner-approved).
- [4] Acceptance "equal reports from the seed scenario" → fixed-scenario integration tests until Phases 11/12 (owner-approved).
- [4] docs/05 §2 "Net worth trend (12m / 3y / all toggle)" is served by the page-wide TimeRangeBar instead of a per-card toggle.

## Open questions for the owner
<!-- Claude: questions that need a human answer. -->
- [0] Please run `npm run db:check` in your own terminal and confirm it passes. Claude's sandboxed shell routes Node DNS to 127.0.0.1, so the `mongodb+srv` SRV lookup was refused there (Windows itself resolves the record fine); env validation of `.env.local` did pass.
- [1] Then try register/login in the browser against Atlas (`npm run dev`). All auth flows pass e2e on the in-memory DB. Once your account exists, consider `DISABLE_SIGNUP=true`.

## Known issues / tech debt
- [5] Projected SIP periods in Upcoming ignore carry-in (only generated periods know it).
- [5] "Cumulative invested vs estimated value" shows the invested line with today's estimated value as a reference line (no
  per-date estimated history yet; holdings have valuation history but a plan's share over time is not stored).
- [4] Acceptance "dashboard numbers equal reports from the seed scenario": Reports (Phase 11) and the seed script (Phase 12) do not
  exist yet, so a fixed scenario in `tests/integration/dashboard.test.ts` checks every dashboard number against an independent
  calculation (ledger `cashflowOf`, `computeNetWorthAsOf`, account balances). Re-check against real reports in Phase 11.
- [4] "< 1 s with a few thousand transactions" is measured on the queries (all dashboard queries for 1Y with ~3,000 transactions
  run in parallel under 1 s on the in-memory DB); end-to-end page time against Atlas is not measured yet (Phase 12 perf check).
- [4] The series loads every posted transaction and valuation of the user per request (single pass); fine for thousands, revisit
  with snapshots-as-checkpoints if a user has hundreds of thousands.
- [mod-2] The `over_earmarked` notification is not raised yet (Phase 10 notification job); MOD-2 shows the badge only.
- [mod-2] Emergency-flagged holdings in `getBuckets` use the cached value (FDs: today's §9 value); other holdings' values are as
  of their last valuation.
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
