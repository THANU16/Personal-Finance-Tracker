# 06 — Build Plan (phases, prompts, acceptance)

Run each phase in a **fresh Claude Code session** (or `/clear` between phases) so context stays
focused. Easiest: type `/build-phase <n>` — the skill reads this file and runs the phase.
Or paste the prompt shown under each phase manually.

Every phase ends with: `npm run verify` green → update `docs/PROGRESS.md` → commit
`feat(phase-<n>): …`. Do not start phase n+1 until phase n's acceptance list passes.

---

## Phase 0 — Project setup & tooling
**Prompt**
```
Phase 0. Read CLAUDE.md and docs/02-ARCHITECTURE.md. Scaffold the project in the current folder
(keep CLAUDE.md, docs/, .claude/, docker-compose.yml, .env.example): latest stable Next.js with
App Router, TypeScript strict, src/ dir, Tailwind, ESLint, Prettier, shadcn/ui init, Vitest,
Playwright, Husky + lint-staged. Add npm scripts: dev, build, start, typecheck, lint, test,
test:e2e, seed, verify. Create the full folder skeleton from the architecture doc with placeholder
index files. Add src/server/env.ts (Zod-validated env). Make `npm run verify` pass. Plan first.
```
**Acceptance:** app starts; `npm run db:check` passes against Atlas (replica set + transaction); verify passes; folder tree matches doc.

## Phase 1 — Foundations
**Prompt**
```
Phase 1. Implement foundations per docs/02 and docs/04:
- src/server/db: connect (cached), withTransaction helper, Mongoose userId-guard plugin.
- src/server/errors.ts (AppError + codes) and action-result.ts (ActionResult, toActionError).
- Auth with Better Auth (email/password, MongoDB adapter): register, login, logout, src/proxy.ts,
  requireUser() returning Ctx {userId, tz, baseCurrency}.
- settings module (model, schemas, service, actions) created on first login with defaults.
- src/domain/money.ts (add/sub, mulBp, roundHalfAwayFromZero, allocateLargestRemainder),
  periods.ts, and src/lib/format.ts (formatMoney, formatPercentBp, compact).
- Shared components: Money, MoneyInput, PercentInput, DatePicker, PageHeader, StatCard,
  EmptyState, ConfirmDialog, DataTable.
- App shell: sidebar groups and routes from docs/05 §1 (placeholder pages), topbar, theme toggle,
  hide-amounts toggle.
- Test helpers: in-memory replica-set DB, factories. Unit tests for money and periods.
```
**Acceptance:** register/login works; unauthenticated redirect; all sidebar routes render; money tests incl. largest remainder pass.

## Phase 2 — Accounts, categories & the transaction ledger
**Prompt**
```
Phase 2. Use the finance-domain skill. Build modules accounts, categories, asset-classes,
transactions and the ledger engine (src/server/ledger: post, void, recompute) per docs/03 and
docs/04 §1, §4, §18:
- Account types incl. credit_card (limit, statement/due day), loan, receivable/payable,
  opportunity_fund; opening balance; reconcile (adjustment); archive.
- Seed system categories and asset classes per user on first login.
- Transactions: income, expense (with splits), transfer (incl. cross-currency), adjustment.
  Zod discriminated union per type. Edit = void + repost in one DB transaction. Void.
- recomputeAccount from ledger; balances shown correctly incl. card spend and card payment.
- Pages: /accounts, /accounts/[id], /transactions with URL-synced filters, Quick add sheet
  (expense, income, transfer tabs).
- Integration tests: card spend + bill payment doesn't double count; void restores balance;
  transfer excluded from cashflow; recompute idempotent.
```
**Acceptance:** all ledger tests pass; balances match a hand-calculated scenario of 20 transactions.

## Phase 3 — Holdings, valuations, investment transactions, FD, returns
**Prompt**
```
Phase 3. Use the finance-domain skill. Build the holdings module per docs/03 and docs/04 §3, §5,
§9, §12:
- Holdings with mandatory invested + current value (opening_balance txn + valuation), optional
  trackUnits, FD fields.
- Transactions invest, redeem (proportional cost + by units), investment_income (paid out /
  reinvest, tax). recomputeHolding.
- Domain: redemption.ts, returns.ts (XIRR), fd.ts — with the worked examples from docs/04 as tests.
- Valuations: single update, bulk /assets/update-values, stale badge, big-change confirm.
- FD maturity actions: withdraw and renew.
- Pages: /assets (by class / all), /assets/[id] tabs, add-holding wizard, Quick add tabs for
  invest, redeem, investment income.
```
**Acceptance:** redemption example (40k/50k/20k/fee 100) exact; XIRR 10% test; FD values correct; stale and big-change work.

## Phase 4 — Dashboard, net worth series, FX, time ranges, buckets
_Revised after Phase 3 (owner decision, MOD-DOCS). Run after MOD-1 and MOD-2 are committed._
**Prompt**
```
Phase 4. Use the finance-domain and analytics-charts skills. Read docs/03, docs/04 §2, §4, §14, §16, §20, §21, §22 and
docs/05 §2. Check the Next.js docs in node_modules/next/dist/docs for cacheComponents/Suspense patterns before writing pages.
Plan first and wait for approval.

1. FX: fxRates CRUD (Settings → FX rates tab), convertToBase(date) with "FX missing" handling (never 1:1). Then lift the
   Phase 2/3 per-currency limitations where docs/PROGRESS.md says "until FX": account subtotals, /transactions summary,
   holding currency vs account currency (still require the same currency unless a cross-currency transfer), portfolio
   totals. Per-currency earmark/free-cash values from MOD-2 now convert to base.
2. Net worth: domain/series.ts with computeNetWorthAsOf(date) and computeNetWorthSeries(from, to, granularity) as a SINGLE
   PASS over sorted events (transactions + valuations), not a replay per date. FDs use the docs/04 §9 formula as of each
   date, never the cached currentValueMinor. Stored monthly snapshots (auto month-end by a callable job function, manual,
   "Rebuild history") are a cache used for month granularity over ranges > 1 year and for "All". Tests: series point ==
   computeNetWorthAsOf for the same date; FD accrual in the series; liabilities negative balances.
3. Time ranges: extend domain/date-range.ts with resolveRange(preset | custom), defaultGranularity (≤31 days → day,
   ≤183 → week, else month), buildBuckets (user timezone, Monday week start), previousPeriod (equal length immediately before),
   bucket-count warning above 400. Client component TimeRangeBar (presets Today/7D/30D/3M/6M/YTD/1Y/All/Custom, Day/Week/Month
   toggle, compare toggle) storing state in the URL (?from=&to=&g=&cmp=) via a useTimeRange() hook; server components read
   searchParams.
4. Analytics queries (modules/dashboard/queries.ts, server-only): netWorthSeries, assetsVsLiabilities (closing values),
   cashflowSeries (flows summed with $dateTrunc + timezone; income, expense, savings, savings rate per bucket; excludes per
   docs/04 §4), allocationAsOf(end date) with class → holdings drill-down, topExpenseCategories (range total, children rolled
   up), portfolioValueSeries (value vs invested). Every series is gap-filled; compare returns aligned previous-period values
   plus total and % change.
5. Standing summary getStanding(ctx, range): net worth and change, savings rate, investment rate (Σ invest amounts ÷ income),
   runway months (cash accounts + high-liquidity holdings ÷ average monthly expense, last 3 complete months), debt load
   (null until Phase 8), health score (null until Phase 10). Nullable fields render as "—".
6. Buckets on the dashboard: BucketBar "Where my cash is" (Emergency / Opportunity / Free, base currency) and Safe to spend
   (docs/04 §21). Extend getUpcoming() items with optional outflowMinor and accountId so later phases feed safe-to-spend
   automatically; include SIP/recurring/EMI as they arrive. Show the breakdown in a popover; negative value shows a warning.
7. Dashboard page per docs/05 §2 with TimeRangeBar: stat cards, standing summary card, net worth trend, assets vs
   liabilities, income vs expense (+ savings-rate line on a right axis), allocation donut (click → Assets filtered),
   top expense categories (click → Transactions filtered with the same range), cash bar, safe to spend, upcoming,
   attention card, goals/essentials/opportunity placeholders. Each widget has skeleton, empty and error states; use Suspense so
   the static shell stays prerendered.
8. Tests: timezone edge (23:30 Asia/Colombo lands on the right day; month boundary), flows summed vs stocks closing,
   gap fill, compare period, Monday week start, series == asOf, FD in series, earmark example on the dashboard, FX missing
   excluded and badged, snapshot rebuild idempotent. E2E: change preset/granularity/custom range and see charts update; URL
   restores the view on reload.
```
**Acceptance:** dashboard numbers equal reports from the seed scenario; rebuild history produces month-end snapshots; day/week/month/custom all render with correct buckets; dashboard < 1s with a few thousand transactions; npm run verify green; docs/PROGRESS.md updated; commit "feat(phase-4): dashboard, series, FX, time ranges".

## Phase 5 — SIP planner
**Prompt**
```
Phase 5. Use the finance-domain skill. Build the SIP module per docs/03 (sipPlans,
sipPlanVersions, sipExecutions) and docs/04 §6, §7, docs/05 §6:
- domain/allocation.ts (validate, splitByTree), domain/sip.ts (due dates, step-up, carry-forward,
  missed, consistency) with tests for every rule.
- Allocation tree editor component (reused later by rebalancing and opportunity fund).
- Plans CRUD with versioning; generation of due executions (callable job function, idempotent);
  execute (atomic, invest txns with groupId, done/partial), skip, undo.
- Pages: /sip (Planner, Upcoming, History tabs), plan editor, execute screen, history charts and
  consistency. Add SIP items to getUpcoming().
```
**Acceptance:** 100,000 two-level example splits exactly; step-up and carry-forward tests; undo restores balances and holdings.
**Edited after Phase 3 (owner decision, MOD-DOCS)** — applies on top of the prompt above:
```
Phase 5 (edited). SIP planner. As before, plus:
- Build the target allocation first: modules/rebalancing (or allocation) gets the targetAllocations service and the shared
  AllocationTreeEditor in this phase, because SIP depends on it. Saving the target writes a row to targetAllocationHistory.
- sipPlanVersions carry allocationSource: "target" | "custom". Default "target" (the plan uses the live target tree; the
  version records a copy of the tree actually used at execution for history). "custom" stores its own tree as today.
- Execute screen runs the dip guard (docs/04 §20) on the source account and shows ConfirmDialog warnings.
- Add SIP planned amounts to getUpcoming() with outflowMinor/accountId (feeds safe to spend).
Acceptance additions: a plan on "target" follows target edits for future executions only; past executions keep the tree they used.
```

## Phase 6 — Allocation (rebalancing)
**Prompt**
```
Phase 6. Build rebalancing per docs/04 §8 and docs/05 §7: target allocation (tree editor +
threshold), drift by class and asset, full rebalance plan, cashflow rebalance for an amount,
"Apply" pre-filled buy/redeem forms, and drift-tilted split option on the SIP execute screen.
domain/drift.ts fully tested.
```
**Acceptance:** trades sum to zero; cashflow plan only buys; tilt option appears on execute screen.
**Edited after Phase 3 (owner decision, MOD-DOCS)** — applies on top of the prompt above:
```
Phase 6 (edited). Allocation (renamed from Rebalancing; keep route /rebalancing, label "Allocation", tabs Plan · Planned vs
Actual · Rebalance · History).
- Universe excludes holdings flagged countsTowardEmergencyFund and holdings in classes outside the target (docs/04 §8).
- Tolerance band and drift gauges; History tab lists targetAllocationHistory with a simple diff.
- "Invest new money" is the cashflow rebalance; "Use for next SIP" tilts the next execution.
Acceptance additions: flagged holdings do not move drift; saving the target creates a history row.
```

## Phase 7 — Opportunity Fund
**Prompt**
```
Phase 7. Build the opportunity-fund module per docs/04 §15 and docs/05 §8: fund config, market
levels, cycles and reference high, cumulative rules, trigger detection (job function),
banner, suggested amount, record deployment (atomic, tree split), deployment history, undo.
domain/opportunity.ts with the worked example as a test.
```
**Acceptance:** example (1,000,000; −12% → 250,000; −21% → 250,000 more) passes; new high resets cycle.
**Edited after Phase 3 (owner decision, MOD-DOCS)** — applies on top of the prompt above:
```
Phase 7 (edited). Opportunity Fund. As before, plus:
- Fund balance = Σ effective opportunity earmarks (docs/04 §20) + balances of opportunity_fund accounts. fundBalanceAtStart
  uses this total.
- Record deployment: choose a source account that holds opportunity money; post invest lines from it (source
  opportunity_deployment, exempt from the dip guard) and reduce that account's opportunity earmark by the deployed amount (no
  reduction needed for a dedicated opportunity_fund account).
- Deployment allocation defaults to the target allocation (custom override allowed); stored with the deployment.
Acceptance additions: earmark-based example — 200,000 opportunity earmark, rule −10% → 25% suggests 50,000; deploying reduces
the earmark to 150,000 and balance by 50,000.
```

## Phase 8 — Debts & receivables
**Prompt**
```
Phase 8. Build debts per docs/04 §10 and docs/05 §9: loan creation (creates loan account with
negative opening balance), EMI calc, amortisation schedule, debt_payment posting with
principal/interest split, prepayments (reduce tenure / reduce EMI), caches, DTI;
receivables/payables with settle via transfer. Add EMI items to getUpcoming().
domain/loan.ts tested against a known schedule.
```
**Acceptance:** schedule sums to principal; interest counts as expense, principal doesn't.

## Phase 9 — Recurring, budgets, goals
**Prompt**
```
Phase 9. Build recurring rules (confirm/skip/pause, next due), budgets (monthly per category,
copy forward, 80/100% status, unbudgeted), goals (links with shares, required monthly, on-track)
per docs/04 §11, §13 and docs/05 §10–12. Add recurring items to getUpcoming() and Quick add
"from template".
```
**Acceptance:** confirming a rule posts once and advances; budget actual includes child categories and splits.

## Phase 10 — Essentials, notifications, cron, forecast
**Prompt**
```
Phase 10. Build essentials (emergency fund, insurance policies, health score), the notifications
module (centre, bell, read/snooze), the daily cron route /api/cron/daily (CRON_SECRET) that runs:
SIP generation + missed marking, FD valuations and maturity, opportunity triggers, snapshots,
and every notification in docs/04 §19 idempotently; optional email via Resend behind a Mailer
interface; and the cashflow forecast (domain/forecast.ts, /forecast page). Per docs/04 §13, §17,
§19 and docs/05 §13, §14, §16.
```
**Acceptance:** running the cron twice creates no duplicates; forecast flags a seeded negative balance.
**Edited after Phase 3 (owner decision, MOD-DOCS)** — applies on top of the prompt above:
```
Phase 10 (edited). Essentials, notifications, cron, forecast. As before, plus:
- Emergency fund uses docs/04 §13 with the MOD-1 basis settings; current = emergency earmarks + flagged accounts + flagged
  holdings; show "available immediately" (accounts and high-liquidity holdings) vs locked; progress bar red < 50%, amber
  50–99%, green ≥ 100%; "Use emergency fund" action (expense or transfer that reduces the earmark with a clear label).
- Wire the health score into getStanding(); wire recurring, EMI and card dues into safe to spend.
- Net worth projection (5/10 years, three scenarios) and deterministic insights (docs/04 §22) with unit tests.
- Notifications: add over_earmarked (dedupe `earm:<accountId>`).
Acceptance additions: emergency target honours override and basis fallback; running the cron twice creates no duplicates.
```

## Phase 11 — Reports, import/export, attachments
**Prompt**
```
Phase 11. Build reports (all tabs in docs/05 §15 with CSV export), CSV bank import (mapping,
preview, dedupe by importHash, category rules, undo batch), JSON backup/restore (all user
collections, versioned format, restore into empty account only), transactions CSV export,
attachments (StorageProvider local + S3-compatible, authenticated download), and the Settings
Data tab.
```
**Acceptance:** export → wipe → restore reproduces identical net worth; re-importing the same CSV imports 0 rows.
**Edited after Phase 3 (owner decision, MOD-DOCS)** — applies on top of the prompt above:
```
Phase 11 (edited). Reports, import/export, attachments. As before, plus:
- Monthly review (generated on the 1st by the cron; viewable under Reports): income, expense, savings rate, top categories
  with change vs previous month, budget results, net worth change, SIPs done/missed, realised gains, fees paid, 3 insights.
- JSON backup/restore includes the new collections: earmarks, targetAllocationHistory, monthly reviews.
Acceptance additions: backup → wipe → restore reproduces earmarks and the same free cash.
```

## Phase 12 — Hardening & release
**Prompt**
```
Phase 12. Hardening: write scripts/seed.ts with 18 months of realistic LKR data across every
module; Playwright e2e for: register → onboarding → add account → expense → holding → SIP execute
→ dashboard; performance check with 10k transactions (indexes per docs/03, explain slow queries);
security review against docs/02 §5; accessibility pass; PWA manifest and icons; onboarding flow
(docs/05 §18); README with setup, env, deploy (Vercel + Atlas, and Docker). Fix everything found.
```
**Acceptance:** e2e green; dashboard < 1s with 10k txns; README lets a new machine run the app.

## Post-phase modifications
After Phase 3 the owner approved MOD-1 (emergency settings + auth hardening) and MOD-2 (earmarks + dip guard). They are recorded here for
reproducibility; the prompts are in the review pack. Run them before Phase 4.

---

## Alternative: one long session
Not recommended (context fills up and quality drops), but if preferred:
```
Read CLAUDE.md and all docs. Build the application phase by phase following docs/06-BUILD-PLAN.md
from Phase 0 to Phase 12. After each phase run npm run verify, update docs/PROGRESS.md and commit.
Stop and ask me if a doc is ambiguous or contradictory.
```
