# WealthTrack — Kit Review & Modification Pack

Reviewed: your kit (01-PRD … 06-BUILD-PLAN, CLAUDE.md, AGENTS.md, START-HERE, 6 skills, PROGRESS.md) against the
FinTrack kit I produced earlier and against everything we discussed in this conversation.

## 1. Verdict

**Keep your WealthTrack kit as the base. Do not switch to mine.** It is further along (phases 0–3 built and
logged), and it is better than mine in several places: ledger-first design with `recompute*` caches, entry-order
valuation replay, exact BigInt redemption maths, Better Auth + Next 16 specifics, Windows-safe scripts, userId guard,
SIP versioning/step-up/carry-forward, CSV import with dedupe, backup/restore, FX, a full notification table, the
`build-phase` and `verify` skills, and `paths:`-scoped skill loading.

My kit only adds **9 things** that your kit lacks. Four of them are things you explicitly asked for in this chat.

## 2. File-by-file comparison

| Your file | Compared with mine | Verdict |
|---|---|---|
| `01-PRD.md` | Same scope, yours richer (FX, import, forecast, notifications, backup). Missing from yours: **earmarks (Emergency/Opportunity/Free inside one account)**, **single planned allocation**, **dashboard time ranges (day/week/month/custom + compare)**, **safe to spend**, standing summary (runway, investment rate), net-worth projection, deterministic insights, monthly review | **Add** (see MOD-DOCS) |
| `02-ARCHITECTURE.md` | Yours is better (server actions + queries instead of my REST layer, `proxy.ts`, `withTransaction`, userId guard). Nothing to import | **Keep as is**; add `modules/earmarks`, `modules/dashboard`, `domain/earmarks.ts`, `domain/series.ts` |
| `03-DATA-MODEL.md` | Yours is better (caches, `priceMinorE4`, `importHash` partial index). Missing: `earmarks` collection; emergency settings (`expenseBasis`, manual monthly, target override); SIP/opportunity allocation reference to the single target; target-allocation history | **Add** 4 small items |
| `04-BUSINESS-RULES.md` | Yours is better on holdings, redemption, SIP, loans, FD. Mine is better on: free cash/earmarks (R8), safe to spend, time-series rules (R12), forecast/projection (R21), insights (R22) | **Add** §20 earmarks, §21 safe to spend, §22 time ranges & series; amend §6, §7, §8, §13, §15, §16 |
| `05-UI-SPEC.md` | Yours is better on screens. Missing: TimeRangeBar, BucketBar per account, cash bar + safe to spend on dashboard, "Allocation" naming/tabs, auth pages (forgot/reset/verify/2FA), emergency-fund settings card | **Add** |
| `06-BUILD-PLAN.md` | Phase structure is good. Phases 4, 5, 6, 7, 10, 11 need prompt edits (below). Phases 0–3 need **no re-do**, only two small additions (MOD-1, MOD-2) | **Amend** |
| `CLAUDE.md` | Very good. Add 2 rules (protected money, flows vs stocks) | **Patch** |
| `AGENTS.md` | Managed by `next dev` | **No change** |
| `START-HERE.md` | Fine. Mention the MOD prompts | **Tiny patch** |
| `SKILL_57ccb5` build-phase | Good (plan → build → verify → log → commit) | **Keep** |
| `SKILL_1` finance-domain | Good summary of docs/04; needs earmark + allocation-source lines | **Patch** |
| `SKILL` new-module | Better than my mongo-modules (Next/server-action aware) | **Keep**; my mongo-modules is redundant |
| `SKILL_5e2b0d` testing | Better than my finance-testing (replica set, timezone edge) | **Keep** |
| `SKILL_00c5d3` ui-conventions | Good | **Keep**; add TimeRangeBar/BucketBar to the reuse list |
| `SKILL_dd9c6a` verify | Good | **Keep** |
| *(missing)* | My `finance-charts` has no equivalent | **Add new skill `analytics-charts`** (flows vs stocks, timezone bucketing, gap fill, compare) |

## 3. The 9 things to add (from my kit and this chat)

| # | Add | Why | Where |
|---|---|---|---|
| 1 | **Earmarks**: Emergency / Opportunity / Free cash inside one account (your 350,000 = 100k + 200k + 50k example) | Your flags are whole-account only | MOD-2 (Phase 2) |
| 2 | **Dip guard**: warn before spending, investing or transferring money that is earmarked | Protects the buckets | MOD-2 |
| 3 | **Emergency target settings** (months × essential / all / manual expense, or fixed override) | You asked for "set how much is needed in Settings" | MOD-1 (Phase 1) |
| 4 | **Auth hardening**: forgot/reset password, optional email verification, TOTP 2FA, sessions list, reset script | You asked for auth pages; real data is going into Atlas | MOD-1 |
| 5 | **One planned allocation**: SIP plans and opportunity deployments default to the target allocation (custom override allowed) | You said "we have one planned allocation"; yours has three separate trees | Docs + Phases 5–7 |
| 6 | **Time ranges on charts**: Day/Week/Month/Custom + compare previous period | You asked for it | Phase 4 |
| 7 | **Safe to spend** and **standing summary** (runway, investment rate, debt load, health score) | "Help me understand where I stand" | Phase 4 (+10) |
| 8 | **Projection, insights, monthly review** | Understanding layer | Phase 10/11 |
| 9 | **`analytics-charts` skill** | Keeps chart maths consistent from Phase 4 onward | MOD-DOCS |

## 4. Things I recommend NOT adding (yours is better or equal)

REST `/api/v1` layer, my `receivables` collection (your receivable/payable accounts + settle transfer is cleaner),
my `instrumentType` node in the allocation tree (your holding-level children are enough), my pending-redeem status,
my `mongo-modules`/`finance-testing` skills, `valuations` back-dating rules, JSON export only (your backup/restore is
better), idempotency keys (optional; your "disable submit while pending" is enough for now).

**In-transit redemption without code:** when you redeem a unit trust that settles in a few days, redeem into a
`receivable` account called "Redemptions in transit" (counts in net worth), then settle it with a transfer to your bank
when the money lands. Net worth never dips and the bank balance stays reconcilable.

## 5. Phase 0–3: what changes

| Phase | Code change needed? | Prompt |
|---|---|---|
| 0 Setup | **No** | – |
| 1 Foundations | **Yes, small**: emergency settings fields + auth hardening (independent of each other) | **MOD-1** |
| 2 Accounts & ledger | **Yes, medium**: earmarks + dip guard in `ledger/post` + account UI | **MOD-2** |
| 3 Holdings | **No** (flag `countsTowardEmergencyFund` already exists; rebalancing will exclude flagged holdings in Phase 6) | – |

## 6. Order to apply (do not skip the order)

1. **MOD-DOCS** — update docs and skills first (the docs are the contract). No app code.
2. **MOD-1** — Phase 1 additions. Commit.
3. **MOD-2** — Phase 2 additions. Commit.
4. **Phase 4 (revised)** — run `/build-phase 4` after MOD-DOCS has replaced the Phase 4 section in `docs/06`.
   (Or paste the revised Phase 4 prompt in section 10.)

Run each in a fresh session (`/clear`). Each ends with `npm run verify`, PROGRESS.md update, commit.

---

## 7. MOD-DOCS — update docs and skills (no app code)

Paste this prompt in Claude Code. It edits only `docs/`, `CLAUDE.md`, `START-HERE.md`, `.claude/skills/` and
`docs/PROGRESS.md`. Appendix A (end of this file) holds the exact text to insert.

~~~~
MOD-DOCS. Documentation and skills update only — do NOT touch src/, tests/ or scripts/.
Read CLAUDE.md, docs/PROGRESS.md and every doc in docs/. Then apply the changes below exactly, keeping each
file's existing style. After editing, show me a summary diff per file and wait for my approval before committing.

Context: owner decisions after Phase 3 —
(1) Emergency / Opportunity / Free cash must be separable inside ONE account (earmarks), with a dip guard.
(2) There is ONE planned allocation (the target allocation). SIP plans and opportunity deployments default to it and
    may override with a custom tree.
(3) Dashboard charts need Day / Week / Month / Custom ranges and compare-to-previous-period.
(4) Emergency target is configurable in Settings.
(5) Auth gets password reset, optional email verification, TOTP 2FA, sessions list.

Edits:
1. docs/01-PRD.md — apply "A1 PRD edits" from the pack.
2. docs/03-DATA-MODEL.md — apply "A2 Data model edits".
3. docs/04-BUSINESS-RULES.md — add sections 20, 21, 22 and amend sections 6, 7, 8, 13, 15, 16, 19 per "A3".
4. docs/05-UI-SPEC.md — apply "A4 UI edits".
5. docs/06-BUILD-PLAN.md — replace the Phase 4, 5, 6, 7, 10 and 11 sections with "A5", and append the
   "Post-phase modifications" section (MOD-1, MOD-2) so the history is reproducible.
6. CLAUDE.md — apply "A6" (two new non-negotiable rules + skill list).
7. .claude/skills/finance-domain/SKILL.md — apply "A7". Create .claude/skills/analytics-charts/SKILL.md from "A8".
   In .claude/skills/ui-conventions/SKILL.md add TimeRangeBar and BucketBar to the reuse list.
8. START-HERE.md — one line under "Build": "Run MOD-1 and MOD-2 (docs/06 → Post-phase modifications) before Phase 4."
9. docs/PROGRESS.md — add table rows "MOD-1 Phase 1 additions ⬜" and "MOD-2 Phase 2 additions ⬜", and under Decisions:
   "- [mod] One planned allocation; earmarks (partial-account buckets) added; time-range analytics computed on the fly
   with monthly snapshots as cache; in-transit redemptions use a receivable account — owner decision after Phase 3."
Flag any contradiction you find between the new text and existing docs instead of silently resolving it.
~~~~

---

## 8. MOD-1 — Phase 1 additions (settings + auth)

Run after MOD-DOCS is committed. Two independent parts; if you only want one now, say so in the prompt.

~~~~
MOD-1 (modifies Phase 1). Read CLAUDE.md, docs/PROGRESS.md, docs/03 (settings), docs/04 §13 and docs/05 §17.
Check the current Better Auth documentation (twoFactor plugin, password reset, email verification, session
management) before using any API — do not rely on memory. Plan first and wait for my approval.

Part A — Emergency fund settings
- settings model/schema/service/actions: add
  emergencyExpenseBasis: "essential" | "all" | "manual" (default "essential"; if no category is flagged essential, the
  effective basis falls back to "all"), emergencyManualMonthlyMinor?: number, emergencyTargetOverrideMinor?: number.
  Target = override ?? (monthly basis × emergencyMonths). Basis monthly: essential/all = average over the last 6 complete
  months (computed in Phase 10), manual = the entered amount.
- Settings → Preferences: new "Emergency fund" card (months, basis radio, manual monthly amount, optional fixed target
  override) with helper text explaining the formula. Validation: manual and override are positive integers in minor units.
- Pure helper domain/essentials.ts: emergencyTarget({ months, basis, manualMonthlyMinor, averageEssentialMinor,
  averageAllMinor, overrideMinor }) → { monthlyBasisMinor, targetMinor, basisUsed }, with unit tests (override wins;
  essential falls back to all when essential average is 0; manual ignores averages).
- Update docs/03 and docs/04 §13 if the implementation differs.

Part B — Auth hardening (Better Auth)
- Mailer: implement the Mailer interface from docs/02 (src/server/mail) with a Resend driver and a console driver for dev
  (used when RESEND_API_KEY is empty). Phase 10 will reuse it.
- Password reset: /forgot-password and /reset-password pages; always show the same message whether or not the email exists.
  Without a configured mail driver, log the link to the console in development and show nothing sensitive in production.
- Email verification: optional, controlled by REQUIRE_EMAIL_VERIFICATION (default false); /verify-email page with resend
  cooldown.
- TOTP two-factor: setup (QR + manual key), confirm with a code, backup codes (shown once), challenge page after password
  login, disable and regenerate codes (requires password). Secrets encrypted at rest.
- Settings → new "Security" tab: change password (existing), two-factor, active sessions list with "sign out other devices".
- scripts/reset-password.ts <email> <newPassword> (tsx) as an offline fallback when mail is not configured; it must use
  Better Auth's password hashing, never write plain text.
- Keep DISABLE_SIGNUP behaviour. Keep existing e2e tests passing (2FA is opt-in per user). Add e2e for reset (with the
  console mail driver captured), 2FA enrol → logout → login with code, backup code single use.
- Add env vars to .env.example and src/server/env.ts (REQUIRE_EMAIL_VERIFICATION, any encryption key needed).
Acceptance: unit + e2e tests pass; npm run verify green; update docs/PROGRESS.md (Decisions, Deviations) and commit
"feat(mod-1): emergency settings and auth hardening".
~~~~

---

## 9. MOD-2 — Phase 2 additions (earmarks + dip guard)

~~~~
MOD-2 (modifies Phase 2). Use the finance-domain skill. Read CLAUDE.md, docs/PROGRESS.md, docs/03 (earmarks),
docs/04 §1, §14, §20 and docs/05 §3. Plan first and wait for my approval. Phase 2/3 behaviour must not change except as
listed; all existing tests must keep passing.

1. Domain: src/domain/earmarks.ts (pure, unit tested) —
   effectiveEarmarks(balanceMinor, earmarks[]) → { emergencyMinor, opportunityMinor, freeMinor, overEarmarked },
   rawEarmark(balance, earmark), and dipCheck(outflowMinor, effective) → { needsConfirm, dipsOpportunityMinor,
   dipsEmergencyMinor }. Cover the docs/04 §20 worked examples: 350,000 with 100,000 emergency and 200,000 opportunity →
   free 50,000; spend 20,000 → free 30,000; spend 80,000 → opportunity 170,000 after confirmation; percent mode;
   over-earmark reduces opportunity first.
2. Model + module: modules/earmarks { model, schemas, service, actions, queries } for the `earmarks` collection
   (docs/03), userId-guarded, indexes per docs. Rules: only earmarkable accounts (bank, cash, wallet, broker_cash, balance
   > 0, not dedicated). Dedicated accounts = type opportunity_fund (implicit 100% opportunity) and accounts with
   countsTowardEmergencyFund (implicit 100% emergency); they reject explicit earmarks. Validation Σ raw ≤ balance at
   save time.
3. Service functions: setEarmark, removeEarmark, moveBetweenBuckets(ctx, { accountId, from, to, amountMinor }) where
   from/to ∈ free | emergency | opportunity (edits earmarks only, converts percent→fixed, never posts a transaction),
   getAccountBuckets(ctx, accountId) and getBuckets(ctx) (per-currency until FX arrives in Phase 4).
4. Ledger guard in server/ledger/post.ts: for expense, transfer-out (amount + fee), invest (amount + fee) and
   debt_payment from an earmarkable account apply dipCheck. If needed, throw AppError("NEEDS_CONFIRMATION") with
   details.warnings = [{ code: "DIPS_INTO_OPPORTUNITY" | "DIPS_INTO_EMERGENCY", amountMinor }]; extend ActionResult
   errors with an optional `warnings` array. The caller retries with confirmOpportunity and/or confirmEmergency (emergency
   needs its own explicit flag). On confirmation, inside the same DB transaction, reduce stored earmarks (opportunity
   first, then emergency) and write an auditLog entry. Outflows from dedicated accounts warn WITHDRAWS_FROM_EMERGENCY /
   WITHDRAWS_FROM_OPPORTUNITY unless source.kind is opportunity_deployment, fd_maturity or reconcile. Edits (void +
   repost) guard only the increase over the original outflow on the same account. Voids and reconcile are never guarded.
5. UI: Accounts list shows a BucketBar (Emergency / Opportunity / Free) for earmarkable accounts and a total for dedicated
   ones; "Earmark / Move between buckets" dialog (amount or percent, from → to, live result); account detail lists earmarks;
   Quick add and the transaction forms show a ConfirmDialog listing the warnings and resubmit with the confirm flags.
   Create shared component BucketBar. Over-earmarked accounts show a badge.
6. Tests: integration (spend inside free cash needs no confirm; spend beyond free requires confirm and reduces
   opportunity first; emergency needs its own flag; edit guards only the delta; move between buckets changes no balance and
   posts no transaction; dedicated-account rules; userId isolation; atomicity), unit tests above, one e2e: earmark an
   account, spend beyond free cash, confirm.
Acceptance: all tests pass; npm run verify green; docs/PROGRESS.md updated (Decisions, Deviations); commit
"feat(mod-2): earmarks and dip guard".
~~~~

---

## 10. Phase 4 (revised) — Dashboard, net worth series, FX, time ranges, buckets

Normally you run `/build-phase 4` after MOD-DOCS (it replaces the Phase 4 section of docs/06 with this text).
Run it only after MOD-1 and MOD-2 are committed.

~~~~
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
Acceptance: dashboard numbers equal reports from the seed scenario; rebuild history produces month-end snapshots; day/week/
month/custom all render with correct buckets; dashboard < 1s with a few thousand transactions; npm run verify green;
docs/PROGRESS.md updated; commit "feat(phase-4): dashboard, series, FX, time ranges".
~~~~

---

## 11. Later phases — edited prompts (applied to docs/06 by MOD-DOCS; shown here for review)

~~~~
Phase 5 (edited). SIP planner. As before, plus:
- Build the target allocation first: modules/rebalancing (or allocation) gets the targetAllocations service and the shared
  AllocationTreeEditor in this phase, because SIP depends on it. Saving the target writes a row to targetAllocationHistory.
- sipPlanVersions carry allocationSource: "target" | "custom". Default "target" (the plan uses the live target tree; the
  version records a copy of the tree actually used at execution for history). "custom" stores its own tree as today.
- Execute screen runs the dip guard (docs/04 §20) on the source account and shows ConfirmDialog warnings.
- Add SIP planned amounts to getUpcoming() with outflowMinor/accountId (feeds safe to spend).
Acceptance additions: a plan on "target" follows target edits for future executions only; past executions keep the tree they used.

Phase 6 (edited). Allocation (renamed from Rebalancing; keep route /rebalancing, label "Allocation", tabs Plan · Planned vs
Actual · Rebalance · History).
- Universe excludes holdings flagged countsTowardEmergencyFund and holdings in classes outside the target (docs/04 §8).
- Tolerance band and drift gauges; History tab lists targetAllocationHistory with a simple diff.
- "Invest new money" is the cashflow rebalance; "Use for next SIP" tilts the next execution.
Acceptance additions: flagged holdings do not move drift; saving the target creates a history row.

Phase 7 (edited). Opportunity Fund. As before, plus:
- Fund balance = Σ effective opportunity earmarks (docs/04 §20) + balances of opportunity_fund accounts. fundBalanceAtStart
  uses this total.
- Record deployment: choose a source account that holds opportunity money; post invest lines from it (source
  opportunity_deployment, exempt from the dip guard) and reduce that account's opportunity earmark by the deployed amount (no
  reduction needed for a dedicated opportunity_fund account).
- Deployment allocation defaults to the target allocation (custom override allowed); stored with the deployment.
Acceptance additions: earmark-based example — 200,000 opportunity earmark, rule −10% → 25% suggests 50,000; deploying reduces
the earmark to 150,000 and balance by 50,000.

Phase 10 (edited). Essentials, notifications, cron, forecast. As before, plus:
- Emergency fund uses docs/04 §13 with the MOD-1 basis settings; current = emergency earmarks + flagged accounts + flagged
  holdings; show "available immediately" (accounts and high-liquidity holdings) vs locked; progress bar red < 50%, amber
  50–99%, green ≥ 100%; "Use emergency fund" action (expense or transfer that reduces the earmark with a clear label).
- Wire the health score into getStanding(); wire recurring, EMI and card dues into safe to spend.
- Net worth projection (5/10 years, three scenarios) and deterministic insights (docs/04 §22) with unit tests.
- Notifications: add over_earmarked (dedupe `earm:<accountId>`).
Acceptance additions: emergency target honours override and basis fallback; running the cron twice creates no duplicates.

Phase 11 (edited). Reports, import/export, attachments. As before, plus:
- Monthly review (generated on the 1st by the cron; viewable under Reports): income, expense, savings rate, top categories
  with change vs previous month, budget results, net worth change, SIPs done/missed, realised gains, fees paid, 3 insights.
- JSON backup/restore includes the new collections: earmarks, targetAllocationHistory, monthly reviews.
Acceptance additions: backup → wipe → restore reproduces earmarks and the same free cash.
~~~~

---

# Appendix A — Exact text to insert

## A1. docs/01-PRD.md edits
- §4.1 Accounts, add bullet: "**Earmarks (cash buckets):** split an account's balance between Emergency fund, Opportunity fund
  and Free cash without moving money. Accounts of type `opportunity_fund` are implicitly 100% opportunity; accounts flagged
  `countsTowardEmergencyFund` are implicitly 100% emergency. A dip guard warns before spending earmarked money."
- §4.4 SIP: replace "Two-level allocation" bullet start with "Allocation defaults to the target allocation (one planned
  allocation for the whole app); a plan may switch to a custom two-level tree (class % → asset %)."
- §4.5: rename to "Allocation (target & rebalancing)". Add "The target allocation is the single planned allocation used by SIP plans,
  rebalancing and opportunity deployments by default. Saving it records history. Emergency-flagged holdings are excluded."
- §4.6 Opportunity Fund: "Fund balance = opportunity earmarks + balances of opportunity_fund accounts. Deployment allocation
  defaults to the target allocation."
- §4.11 Essentials: "Emergency target is configured in Settings: months × monthly basis (essential expenses, all expenses or a manual
  amount), or a fixed override. Progress bar on the dashboard shows current/target, months covered, available immediately."
- §4.12 Dashboard: add "Time range controls (Today…All, custom; Day/Week/Month; compare to previous period) drive every chart.
  Standing summary (net worth, savings rate, investment rate, runway, debt load, health score), cash bar (Emergency/Opportunity/Free)
  and Safe to spend."
- §4.1 Auth (new bullet list, also in §4.16): "Forgot/reset password, optional email verification, TOTP two-factor with backup codes,
  active sessions list."
- §4.13 Reports: add "Monthly review (auto-generated)". §4.14 Forecast: add "Net worth projection (5/10 years, 3 scenarios)" and
  "Deterministic insights".

## A2. docs/03-DATA-MODEL.md edits
- settings: add `emergencyExpenseBasis: essential|all|manual (default essential)`, `emergencyManualMonthlyMinor?`,
  `emergencyTargetOverrideMinor?`.
- New collection:
```
## earmarks
bucket: emergency|opportunity, accountId, mode: fixed|percent, amountMinor?, percentBp?, note?
idx: {userId, accountId}, {userId, bucket, accountId} unique
```
  Only earmarkable accounts (bank, cash, wallet, broker_cash); dedicated accounts reject earmarks.
- sipPlanVersions: add `allocationSource: target|custom` (default target); `allocation` is required only when custom, and a copy of
  the tree used is stored on each execution line set (`sipExecutions.allocationUsed`).
- opportunityFund: `allocation` becomes optional with `allocationSource: target|custom`.
- New collection `targetAllocationHistory`: `allocation, thresholdBp, savedAt, note?`.
- snapshots: note "monthly month-end snapshots are a cache; day/week series are computed on the fly (docs/04 §22)".
- notifications.type: add `over_earmarked`.

## A3. docs/04-BUSINESS-RULES.md
Add after §19:

### §20 Earmarks (cash buckets) and free cash
- Earmarkable accounts: bank, cash, wallet, broker_cash with balance > 0 and not dedicated.
- Dedicated accounts: type `opportunity_fund` (implicitly 100% opportunity) and any account with `countsTowardEmergencyFund` (implicitly
  100% emergency). They cannot carry explicit earmarks.
- Raw earmark on account balance B: fixed → `amountMinor`; percent → `round(B × percentBp / 10000)`.
- Effective earmarks: if Σ raw > B (over-earmarked) reduce opportunity first, then emergency, until Σ = B. Stored values are untouched;
  show an "Over-earmarked" badge and raise `over_earmarked`.
- `freeOnAccount = B − Σ effective`. **Free cash** = Σ freeOnAccount over earmarkable accounts, converted to base (§14).
- Emergency bucket = Σ effective emergency earmarks + balances of emergency-flagged accounts + values of emergency-flagged holdings.
  Opportunity bucket = Σ effective opportunity earmarks + balances of `opportunity_fund` accounts.
- Move between buckets (free/emergency/opportunity on one account) edits earmarks, never posts a transaction; percent earmarks become
  fixed when moved.
- Worked example: Commercial Bank 350,000, emergency 100,000, opportunity 200,000 → free 50,000. Spend 20,000 → balance 330,000, free
  30,000. Spend 80,000 → NEEDS_CONFIRMATION (DIPS_INTO_OPPORTUNITY 30,000); confirmed → balance 270,000, opportunity 170,000,
  emergency 100,000, free 0.
- **Dip guard** (ledger post): for an outflow X from an earmarkable account (expense, transfer out incl. fee, invest incl. fee,
  debt_payment) with X > freeOnAccount, reject with `NEEDS_CONFIRMATION` and warnings `DIPS_INTO_OPPORTUNITY(min(X − free, effOpp))`
  then `DIPS_INTO_EMERGENCY(rest)`. Retry with `confirmOpportunity` / `confirmEmergency`; on confirmation the same DB transaction
  reduces stored earmarks (opportunity first) and writes an audit entry. Outflows from dedicated accounts warn
  `WITHDRAWS_FROM_EMERGENCY` / `WITHDRAWS_FROM_OPPORTUNITY` unless `source.kind` is opportunity_deployment, fd_maturity or reconcile.
  Edits guard only the increase over the voided original on the same account; voids and reconcile are never guarded.

### §21 Safe to spend
`safeToSpend = freeCash − Σ outflowMinor of upcoming items due on or before the end of the current month (user tz) that are not yet
posted` (recurring expenses, EMIs, card dues, planned SIPs paid from earmarkable accounts). May be negative → show a warning.

### §22 Time ranges and series
- Presets: Today, 7D, 30D, 3M, 6M, YTD, 1Y, All, Custom. Default granularity: ≤ 31 days day, ≤ 183 days week, else month; user can
  override; warn above 400 buckets. Week starts Monday. All bucketing in the user timezone (`$dateTrunc` with `timezone`).
- **Flows** (income, expense, invest, SIP amounts) are summed per bucket. **Stocks** (net worth, assets, liabilities, allocation,
  balances) use the closing value of the bucket, carried forward across empty buckets. Every bucket in the range is returned.
- Compare = the same-length period immediately before the range, aligned bucket by bucket, with total and % change.
- `computeNetWorthSeries(from, to, granularity)` is a single pass over sorted transactions and valuations; FDs use §9 as of each date.
  Monthly snapshots are a cache for month granularity over ranges > 1 year and for "All".
- Investment rate = Σ invest amounts (excl. fees) ÷ income for the range. Runway = (cash accounts + high-liquidity holdings) ÷ average
  monthly expense over the last 3 complete months.
- Net worth projection: monthly contribution = Σ active SIP monthly equivalents; start = investable base; annual return from settings
  (default 8%) ± 2 points; monthly compounding; always labelled an estimate.
- Insights (max 5, ranked): category spend > 30% above its 3-month average; fees paid this quarter above a threshold; stale values or FD
  maturing within 30 days; budget ≥ 80% before day 20; free cash idle > 3 × monthly expense with emergency full; drift beyond
  tolerance or missed SIP; savings rate down ≥ 10 points vs previous period.

Amend:
- §6: "Allocation trees are used by the target allocation (the single planned allocation), by SIP versions that choose `custom`, and by
  opportunity deployments that choose `custom`. SIP and deployments default to the target."
- §7 (Execute): add "run the dip guard (§20) on the source account".
- §8: "Universe excludes holdings flagged `countsTowardEmergencyFund`."
- §13 Emergency fund: "basis = settings.emergencyExpenseBasis (essential falls back to all when no category is flagged essential; manual uses
  emergencyManualMonthlyMinor); target = emergencyTargetOverrideMinor ?? basis × emergencyMonths; current = emergency bucket (§20)."
- §15: "Fund balance = opportunity bucket (§20). `fundBalanceAtStartMinor` uses it. Deployment posts from a chosen source account holding
  opportunity money and reduces its opportunity earmark by the amount."
- §16: "Day/week series are computed on the fly (§22); month-end snapshots remain a cache. Snapshots must use the §9 FD formula, never the
  cached FD value."
- §19: add row `over_earmarked | account over-earmarked | earm:<accountId>`.

## A4. docs/05-UI-SPEC.md edits
- §1 sidebar: rename "Rebalancing" to "Allocation". Add shared components TimeRangeBar and BucketBar.
- §2 Dashboard: add a TimeRangeBar under the header; row 1 add Standing summary card (net worth change, savings rate, investment rate, runway,
  debt load, health score chip with two reasons); add Cash bar ("Where my cash is") and Safe to spend with breakdown popover next to the
  emergency progress bar; charts: net worth, assets vs liabilities (stacked bars), income vs expense with savings-rate line on a right axis,
  allocation donut with drill-down, top categories (click filters Transactions with the same range).
- §3 Accounts: BucketBar per earmarkable account; "Earmark / Move between buckets" dialog; over-earmarked badge.
- §4 Transactions/Quick add: ConfirmDialog for NEEDS_CONFIRMATION warnings.
- §7: rename to "Allocation" with tabs Plan · Planned vs Actual · Rebalance · History.
- §13 Essentials: emergency card with target source (months × basis or override), progress bar (red/amber/green), months covered,
  available immediately vs locked, sources, "Use emergency fund".
- §17 Settings: Preferences gains the Emergency fund card; new Security tab (password, two-factor, sessions); auth pages /forgot-password,
  /reset-password, /verify-email, /two-factor.

## A5. docs/06-BUILD-PLAN.md
Replace Phase 4 with section 10 of this pack and Phases 5, 6, 7, 10, 11 with section 11. Append:

"## Post-phase modifications
After Phase 3 the owner approved MOD-1 (emergency settings + auth hardening) and MOD-2 (earmarks + dip guard). They are recorded here for
reproducibility; the prompts are in the review pack. Run them before Phase 4."

## A6. CLAUDE.md patch
Add to Non-negotiable rules:
"11. **Earmarked money is protected.** Emergency/opportunity earmarks (docs/04 §20) must be honoured: outflows from earmarkable accounts go
through the dip guard; never spend into earmarks without the confirm flags. Free cash is computed, never stored.
12. **Flows are summed, stocks are closing values** per bucket; bucket in the user timezone; gap-fill every series (docs/04 §22).
13. **One planned allocation.** SIP plans and opportunity deployments default to the target allocation; custom trees are the exception."
Add to Workflow: "Use `analytics-charts` for any chart, series or time-range work."

## A7. finance-domain skill patch
Append under "Invariants": "8. Earmarks (docs/04 §20): free cash = balance − effective earmarks; outflows run the dip guard; moving between
buckets edits earmarks and posts no transaction. 9. SIP and opportunity allocation default to the target allocation." Add to the cheat sheet:
"Spend X from account A with X > free → NEEDS_CONFIRMATION; confirm reduces opportunity then emergency earmarks in the same transaction."
Add `src/domain/earmarks.ts`, `src/modules/earmarks/**`, `src/modules/dashboard/**` to `paths:`.

## A8. New skill: .claude/skills/analytics-charts/SKILL.md
~~~~
---
name: analytics-charts
description: Build charts, series and time-range analytics for WealthTrack — Recharts components, flows-versus-stocks aggregation, timezone-aware bucketing, gap filling, compare-to-previous-period, TimeRangeBar URL state, snapshot cache, fixed asset-class colours. Use whenever adding or changing a chart, a dashboard widget, a report series or any Day/Week/Month/Custom range logic, even if the user does not say "analytics".
paths:
  - "src/modules/dashboard/**"
  - "src/modules/reports/**"
  - "src/modules/snapshots/**"
  - "src/domain/series.ts"
  - "src/domain/date-range.ts"
  - "src/components/charts/**"
---

# Analytics & charts

Read docs/04 §2, §4, §16, §22 and docs/05 first. Rules:
- Flows (income, expense, invest, SIP) are SUMMED per bucket; stocks (net worth, assets, liabilities, allocation, balances) take the CLOSING
  value of the bucket, carried forward across empty buckets. Return every bucket in the range.
- Bucket in the user's timezone (Asia/Colombo default), week starts Monday. Aggregations use $dateTrunc with timezone; pure bucket helpers live in
  domain/date-range.ts and are unit tested (23:30 local, month boundaries, week boundary).
- Default granularity ≤31 days day, ≤183 week, else month; user override allowed; warn above 400 buckets.
- compare = equal-length previous period aligned by bucket, with total and % change.
- Net worth series = one pass over sorted events (computeNetWorthSeries); FDs use the §9 formula as of each date; monthly snapshots are only a
  cache for month granularity over long ranges. A series point must equal computeNetWorthAsOf for the same date (test it).
- Range state lives in the URL (?from=&to=&g=&cmp=) via useTimeRange(); server components read searchParams; do not hold range in component state.
- Cashflow excludes transfers (except their fee), invest, redeem, debt principal, adjustments (docs/04 §4). Savings rate per bucket = (income −
  expense) / income, null when income is 0.
- Charts: Recharts client components, fixed class colours from assetClasses.color, validated series tokens for single/dual series, crosshair tooltip with
  full amounts and delta vs previous bucket, compact axis ticks, savings-rate on a right axis, aria summary text, horizontal scroll above ~30 bars on
  mobile. Every widget has skeleton, empty and error states and sits behind Suspense (cacheComponents).
- No business maths in components: queries return ready-to-plot values.
Checklist: gap-filled, correct flow/stock handling, timezone passed, compare works, tests cover boundaries, empty/loading/error present.
~~~~
