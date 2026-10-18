# 05 — UI Specification

## 1. Global
- **Shell:** left sidebar (collapsible; bottom nav on mobile), topbar with search, "hide amounts" eye
  toggle, notifications bell (unread count), theme toggle, user menu.
- **Sidebar groups:**
  Overview: Dashboard · Forecast · Reports
  Money: Accounts · Transactions · Recurring · Budgets
  Invest: Assets · SIP Planner · Allocation · Opportunity Fund
  Plan: Goals · Debts · Essentials
  System: Notifications · Settings
- **Quick add** (button + keyboard `N`): sheet with type tabs Expense · Income · Transfer · Invest ·
  Redeem · Income from investment · Debt payment. Remembers last account. Enter submits.
- **Formatting:** `LKR 1,250,000.00` (or compact `1.25M` on cards with full value in tooltip);
  negatives red with minus sign; gains green/losses red with ▲/▼ chip; percents 1 decimal.
- **Every list:** empty state with a primary action; skeleton loading; pagination or virtualised table.
- **Every form:** inline Zod errors, disabled submit while pending, success toast, focus first error.
- **Destructive actions** (void, undo execution, archive): confirm dialog describing the impact.
- **Badges:** `Stale · 34d`, `Due`, `Overdue`, `Partial`, `Skipped`, `Missed`, `FX missing`.
- Light/dark themes; 360px minimum width; tables become stacked cards on mobile.
- Charts (Recharts): consistent class colours from `assetClasses.color`; tooltips show full amounts.
- **Shared components:** TimeRangeBar (range presets, Day/Week/Month, compare) and BucketBar (Emergency / Opportunity / Free).

## 2. Dashboard `/dashboard`
A **TimeRangeBar** sits under the header and drives every chart.
Row 1 stat cards: Net worth (Δ this month, Δ %), Assets, Liabilities, This month savings rate, and a **Standing summary**
card (net worth change, savings rate, investment rate, runway, debt load, health score chip with two reasons).
Row 2: Net worth trend (area, 12m / 3y / all toggle) · Allocation donut by class (click → Assets filtered).
Row 3: Cashflow this month (income, expense, savings bars + 6-month mini trend) · Top 5 expense categories.
Row 4: **Upcoming (14 days)** list — SIPs (Execute button), recurring (Confirm), EMIs, card dues, FD
maturities, renewals · **Attention** card — stale valuations count (→ Update values), budgets over 80%,
opportunity-fund banner if triggered, forecast warning.
Row 5: Goals progress bars · Essentials mini (emergency months, health score) · Opportunity fund (size vs target, current drawdown).
**Cash bar** ("Where my cash is": Emergency / Opportunity / Free) and **Safe to spend** with a breakdown popover, next to the
emergency progress bar.
Charts: net worth, assets vs liabilities (stacked bars), income vs expense with a separate savings-rate line chart beneath it (owner decision, Phase 4: no dual axis), allocation donut
with drill-down, top categories (click filters Transactions with the same range).

## 3. Accounts `/accounts`, `/accounts/[id]`
- Grouped by type with subtotals: Cash & bank, Cards, Loans, Investment cash, Opportunity fund, Receivables/Payables.
- Card row: outstanding, limit, utilisation bar, next due date.
- Actions: Add account (type-driven form), Reconcile, Archive.
- Detail: balance history line, transactions table filtered to the account, running balance column.
- BucketBar per earmarkable account; "Earmark / Move between buckets" dialog; over-earmarked badge.

## 4. Transactions `/transactions`
- Filters bar (date presets, type, account, category, holding, tag, amount, search) synced to URL.
- Table: date · description · type icon · category/holding · account(s) · amount (signed per context) · tags · attachment icon · menu (edit, duplicate, void).
- Grouped lines (SIP execution, deployment) show a group chip linking to the owner.
- Monthly summary strip: income, expense, net.
- Quick add and transaction forms: ConfirmDialog for NEEDS_CONFIRMATION warnings.
- Import `/transactions/import`: upload CSV → choose account → map columns → preview with duplicates
  flagged and categories auto-suggested → import → result summary (undo batch).

## 5. Assets `/assets`
- Header totals: value, invested, unrealised gain (%), realised gain, income, portfolio XIRR.
- Toggle view: **By class** (accordion per class with class totals, weight, XIRR) / **All holdings** table.
- "Emergency fund: Included / Hidden" switch (when emergency-fund holdings exist): Hidden leaves them out of totals, weights and
  XIRR and states how much is hidden.
- Holding row: name · instrument · invested · value · gain (abs, %) · weight · XIRR · last updated (stale badge) · quick actions (Buy, Redeem, Update value).
- "Update values" button → `/assets/update-values`: table (holding, invested, last value, last updated,
  **new value** input, Δ preview, optional NAV input when trackUnits) → Save all (big-change rows require a tick).
- Add holding wizard: class → instrument (only the types of that class; custom classes show all) → name/details →
  opening invested & current value (or FD terms, switchable off) → optional track units.

### Import valuation history `/assets/import-valuations` (Phase 3b, docs/04 §23)
Entry: Assets header and an "Import CSV" button on the holding's Valuations tab (holding preselected).
1. **Upload** one or more CSV files; each file becomes its own import card.
2. **Setup per file**: holding (suggested from the file name "<Asset Name> - valuations <date>.csv", optional
   "<digits>_" prefix; or create a new holding), funding account (or create "Historical funding (external)"), "first value
   = initial investment" toggle, jump threshold.
3. **Preview** (oldest first): date · recorded at · value · change vs previous day · badges (Duplicate, Same day, Big change,
   Error) · for flagged jumps an action select (Deposit / Withdrawal / Market move) with amount and date. Superseded
   same-day rows are greyed out. **Summary**: rows to import, duplicates, errors, total deposits/withdrawals and the
   resulting invested, current value, unrealised gain and XIRR, recalculated live.
4. **Confirm** → result with a link to the holding, "Rebuild net-worth history" and "Undo import". History in Settings → Data.

### Holding detail `/assets/[id]`
Header (value, gain, XIRR, income) · value vs invested line chart · tabs: Transactions · Valuations ·
Income · Details (edit, track-units toggle, close). FD variant: maturity countdown, accrued interest,
Renew / Withdraw actions.

Allocation `/rebalancing` (Planned vs Actual, Rebalance): "Emergency fund: Hidden / Included" switch when emergency-fund
holdings exist; Hidden (default) states the amount left out, Included marks them "emergency fund (locked)".

## 6. SIP Planner `/sip`
Tabs: **Planner** · **Upcoming** · **History**.
- Planner: plan cards (name, amount, frequency, next due, status, consistency %, invested vs value).
  "New plan".
- Plan editor `/sip/plans/new`, `/sip/plans/[id]`: basics (name, amount, frequency, day, source account,
  start/end), step-up, missed policy, drift tilt toggle, **Allocation tree editor**:
  - Class rows with % input + slider and live amount; expandable asset rows inside with % of class,
    % of total and amount; "Add asset" (holding picker filtered by class, or create holding inline);
    totals bar turns red unless 100%; Auto-balance button.
  - Saving allocation changes on an existing plan shows "This creates version N, effective from <date>".
- Upcoming: due/overdue executions grouped by plan, Execute · Skip.
- Execute `/sip/execute/[executionId]`: header (plan, period, planned total incl. carry-in, source
  account balance after) · toggle Normal split / Drift-tilted split · lines grouped by class: planned,
  **actual** input, fee, optional units/price (units auto = actual ÷ price) · totals and status preview
  (done / partial) · Confirm.
- History: filters (plan, status, date) · timeline list with planned vs actual and status chips ·
  per-plan charts: cumulative invested vs estimated value, monthly bars planned vs actual ·
  consistency score · Undo on recent executions.

## 7. Allocation `/rebalancing`
Tabs: Plan · Planned vs Actual · Rebalance · History.
- Target editor (same tree editor) + threshold.
- Table: class · current value · current % · target % · drift (bp shown as %) with bar · status chip
  (OK / Over / Under) · expand to assets.
- Plan panel: tabs "Invest new money" (amount input → suggested split) and "Full rebalance" (buy/sell
  per asset). "Apply" opens pre-filled Buy/Redeem forms; "Use for next SIP" tilts next execution.

## 8. Opportunity Fund `/opportunity-fund`
- Banner "Market drop detected — rule −20% reached. Suggested deployment LKR X" with Record deployment.
- Cards: fund balance vs target, benchmark latest level, reference high, current drawdown gauge.
- Market levels: add level form + line chart with reference high and rule lines.
- Rules editor (drawdown %, cumulative deploy %) + allocation tree.
- Record deployment dialog (pre-filled amount and split; editable lines) · deployment history table.

## 9. Debts `/debts`, `/debts/[id]`
List: loan, outstanding, EMI, rate, next due, payoff date, progress bar; totals; DTI chip.
Detail: amortisation schedule table (paid rows ticked), principal vs interest chart, Record payment
(pre-filled EMI with split preview), Prepayment (mode choice with before/after payoff comparison).
Receivables/payables section with Settle action (transfer).

## 10. Recurring `/recurring`
Table: name, kind, amount, account, frequency, next due, status; Confirm (dialog with editable amount),
Skip, Pause, Edit. Calendar view of the month optional tab.

## 11. Budgets `/budgets`
Month picker · "Copy last month" · rows: category, budget, spent, remaining, progress bar (amber ≥80%,
red ≥100%) · Unbudgeted spending row · total.

## 12. Goals `/goals`
Cards: name, target, date, progress ring, current, required monthly, status chip; detail drawer with
linked items and shares.

## 13. Essentials `/essentials`
Health score gauge with 4 sub-scores · Emergency fund (target, current, coverage months, which accounts
count) · Insurance policies table + coverage vs target · Debt-to-income · Savings rate trend.
Emergency card: target source (months × basis or override), progress bar (red/amber/green), months covered,
available immediately vs locked, sources, "Use emergency fund".

## 14. Forecast `/forecast`
Horizon toggle 30/60/90 · total balance line with danger zone · per-account table of lowest point and
date · upcoming events list.

## 15. Reports `/reports`
Tabs: Monthly summary · Income vs expense (12m) · Categories · Investment performance · Realised gains
(year) · Investment income & tax (year) · Net worth history. Each with Export CSV.

## 16. Notifications `/notifications`
List grouped Today / This week / Earlier; mark read, snooze 1d/3d/7d; link to action.

## 17. Settings `/settings`
Tabs: Profile · Preferences (currency, timezone, thresholds, emergency months, insurance targets,
notifications) · Categories (tree, essential flag, rules for import) · Asset classes · FX rates ·
Data (export JSON, restore JSON, export transactions CSV, rebuild snapshots, recompute caches).
Preferences gains the Emergency fund card; new Security tab (password, two-factor, sessions); auth pages /forgot-password,
/reset-password, /verify-email, /two-factor.

## 18. Onboarding (first login)
Steps: preferences → add accounts with opening balances → add holdings → (optional) create first SIP →
done. Can skip; "Load demo data" option in development.
