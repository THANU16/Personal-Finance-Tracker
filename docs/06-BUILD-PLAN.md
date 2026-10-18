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

## Phase 4 — Dashboard, net worth, snapshots, FX
**Prompt**
```
Phase 4. Build fx, snapshots and the dashboard per docs/04 §2, §4, §14, §16 and docs/05 §2:
- fxRates CRUD in settings; conversion helper with "FX missing" handling.
- computeNetWorthAsOf(date); snapshots (auto month-end, manual, rebuild history).
- Cashflow & savings rate queries by month.
- Dashboard rows 1–3 and 5 (upcoming list can show placeholders until later phases; wire it to a
  single getUpcoming() query you will extend).
```
**Acceptance:** dashboard numbers equal reports from the seed scenario; rebuild history produces 12 snapshots.

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

## Phase 6 — Rebalancing
**Prompt**
```
Phase 6. Build rebalancing per docs/04 §8 and docs/05 §7: target allocation (tree editor +
threshold), drift by class and asset, full rebalance plan, cashflow rebalance for an amount,
"Apply" pre-filled buy/redeem forms, and drift-tilted split option on the SIP execute screen.
domain/drift.ts fully tested.
```
**Acceptance:** trades sum to zero; cashflow plan only buys; tilt option appears on execute screen.

## Phase 7 — Opportunity Fund
**Prompt**
```
Phase 7. Build the opportunity-fund module per docs/04 §15 and docs/05 §8: fund config, market
levels, cycles and reference high, cumulative rules, trigger detection (job function),
banner, suggested amount, record deployment (atomic, tree split), deployment history, undo.
domain/opportunity.ts with the worked example as a test.
```
**Acceptance:** example (1,000,000; −12% → 250,000; −21% → 250,000 more) passes; new high resets cycle.

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

---

## Alternative: one long session
Not recommended (context fills up and quality drops), but if preferred:
```
Read CLAUDE.md and all docs. Build the application phase by phase following docs/06-BUILD-PLAN.md
from Phase 0 to Phase 12. After each phase run npm run verify, update docs/PROGRESS.md and commit.
Stop and ask me if a doc is ambiguous or contradictory.
```
