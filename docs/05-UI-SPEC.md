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
  Phones (owner request, 2026-11-09): tap rows Date · Amount (Fees on transfers) · Category · Asset ·
  Account / From / To · Note, and one bottom panel that replaces the Save bar while open — calculator
  keypad (+ − × ÷ =, OK goes to the next empty field; a new form opens on it), calendar (Sunday first,
  Yesterday / Today), category tiles (main → sub, first tile keeps the main category; recent row on top),
  account / asset tiles with balance and "X free" for earmarked accounts. Everything else (Pay from,
  split, payee, tags, notes, template) sits under a collapsed "More details". Save · Continue (keeps
  date and accounts, reopens the keypad). Desktop unchanged.
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
**Insight cards** (owner request, 2026-11-07; docs/04 §25), desktop: after the cash bar a row **Why did my net worth
change?** (saved / market gain / currency & adjustments bars, "This month" and range switch) · **Investments** (value,
invested, gain, market gain this month, 6-month sparkline, → Assets); after income vs expense / top categories a row
**Spending pace** (spent vs a usual month, expected-by-today line, ahead / on / below chip) · **Fees & interest** (this
year by kind). Phones: hero · Needs attention · cash · net worth change · investments · income vs expense · spending
pace · allocation · goals · essentials · opportunity · net worth trend · top categories · fees & interest · assets vs
liabilities.
Charts: net worth, assets vs liabilities (stacked bars), income vs expense with a separate savings-rate line chart beneath it (owner decision, Phase 4: no dual axis), allocation donut
with drill-down, top categories (click filters Transactions with the same range).

## 3. Accounts `/accounts`, `/accounts/[id]`
- Grouped by type with subtotals: Cash & bank, Cards, Loans, Investment cash, Opportunity fund, Receivables/Payables.
- Card row: outstanding, limit, utilisation bar, next due date.
- Actions: Add account (type-driven form), Reconcile, Archive.
- Detail: balance history line, transactions table filtered to the account, running balance column.
- BucketBar per earmarkable account; "Earmark / Move between buckets" dialog; over-earmarked badge.
- Goal savings accounts (owner request): the account form (bank, cash, wallet) has a "Kept for goal" picker (No — normal
  money, or an active goal; hides "Counts toward emergency fund"). They are listed in their own **Goal savings** group after
  Cash & bank, each row "For <goal>".

## 4. Transactions `/transactions`
- **Day-by-day list** (owner request, 2026-11-05, after the owner's reference app): rows grouped by day; each day header
  shows the day number, a weekday chip, month/year and that day's **income in blue** and **expense in red** (counted
  like the page totals: income + paid-out investment income; expenses + transfer fees). Rows: category · description
  with the account under it · amount (income blue, expense red, everything else muted; signs kept). Phones: list with
  a sticky day header and a detail sheet per row. md+: one table (Category, Description, Account, Amount, ⋯) with a
  header row per day. The filter bar and summary cards stay as they are (Income blue, Expense red). Blue/red on this
  page only; account pages and holding tabs keep their lists. Category names only (no icons yet).
- Filters bar (date presets, type, account, category, holding, tag, amount, search) synced to URL.
- Table: date · description · type icon · category/holding · account(s) · amount (signed per context) · tags · attachment icon · menu (edit, duplicate, void).
- Grouped lines (SIP execution, deployment) show a group chip linking to the owner.
- Monthly summary strip: income, expense, net.
- Quick add and transaction forms: ConfirmDialog for NEEDS_CONFIRMATION warnings ("Use goal money?" for
  WITHDRAWS_FROM_GOAL, naming the goal).
- Quick add never picks a goal savings account by default (nor from the remembered last accounts); they are listed last in
  a **Goal savings** section of the account pickers (phone tiles too, "For <goal>").
- Import `/transactions/import`: upload CSV → choose account → map columns → preview with duplicates
  flagged and categories auto-suggested → import → result summary (undo batch).

Quick add: under "Paid from" / "From" and "Received into" / "To", an optional bucket choice (Normal · Emergency ·
Opportunity, default Normal) for accounts that can hold earmarks, with the current amount in that bucket. The transactions
list shows "From emergency" / "To opportunity" badges.

## 5. Assets `/assets`
- Header totals: value, invested, unrealised gain (%), realised gain, income, portfolio XIRR.
- **Invested vs value** card (docs/04 §24): filter All investments / one class / one holding (`?chart=`; follows the page's
  class filter and the emergency switch), range 1M · 3M · 6M · YTD · 1Y · All · Custom (default 1Y), summary (value,
  invested, gain %, market gain in the range), smooth value curve (no dots; the tooltip names each value's source), invested step line, gain/loss
  shading, "Dividends & interest received" as a number, table view.
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
Header (value, gain, XIRR, income) · **Invested vs value** card (docs/04 §24: range 1M–All + Custom, default All;
value, invested, gain, market gain in the range; smooth value curve (no dots, no jumps); invested step line; gain/loss shading; dividends & interest as a number; table view) · tabs: Transactions · Valuations ·
Income · Details (edit, track-units toggle, close). FD variant: maturity countdown, accrued interest,
Renew / Withdraw actions.

Allocation `/rebalancing` (Planned vs Actual, Rebalance): "Emergency fund: Hidden / Included" switch when emergency-fund
holdings exist; Hidden (default) states the amount left out, Included marks them "emergency fund (locked)".

Holding page: an Earmarks card (bucket bar, Earmark / move, edit, remove) like accounts; the Assets list shows "Emergency X" /
"Opportunity Y" badges. Quick add: buys can "Put into" and sales can "Sell from" the holding's bucket (under the holding
picker). Opportunity Fund: holdings with an opportunity part appear as deployment sources.

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
  - An "Opportunity fund" row (% and amount) in the tree editor; classes + opportunity must total 100%
    (docs/04 §6). With the target allocation the list shows its share read-only.
  - "Opportunity fund X%" card (when the share > 0): From (SIP source / another account) · Keep it (in the
    same account / move to another account / put in an asset) · In account / In asset — the default route.
- Upcoming: due/overdue executions grouped by plan, Execute · Skip.
- Execute `/sip/execute/[executionId]`: header (plan, period, planned total incl. carry-in, source
  account balance after) · toggle Normal split / Drift-tilted split · lines grouped by class: planned,
  **actual** input, fee, optional units/price (units auto = actual ÷ price) · totals and status preview
  (done / partial) · Confirm. When the period has an opportunity share: an "Opportunity fund" card with the
  planned amount, Amount input (default planned), the route fields (default = plan's route) and a Bank fee
  input when money moves; the header shows "+ X opportunity fund" and the balance-after counts the move.
- History: filters (plan, status, date) · timeline list with planned vs actual and status chips ·
  per-plan charts: cumulative invested vs estimated value, monthly bars planned vs actual ·
  consistency score · Undo on recent executions.

## 7. Allocation `/rebalancing`
Tabs: Plan · Planned vs Actual · Rebalance · History.
- Target editor (same tree editor, with the Opportunity fund row) + threshold.
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

Loan page and the loan account page (owner request): "Total paid so far" and "Total interest of this loan" cards (docs/04
§10); the account page links to the loan. In a loan account's transactions, a payment shows the amount paid with "Loan
reduced by <principal>" under it (the running balance moves by the principal).

## 10. Recurring `/recurring`
Table: name, kind, amount, account, frequency, next due, status; Confirm (dialog with editable amount),
Skip, Pause, Edit. Calendar view of the month optional tab.

## 11. Budgets `/budgets`
Month picker · "Copy last month" · rows: category, budget, spent, remaining, progress bar (amber ≥80%,
red ≥100%) · Unbudgeted spending row · total.
Repeating budgets (owner request): the budget dialog has "Applies to" — Every month from now on (default for a new
budget) · Every month until… (a month picker) · This month only. Repeating rows show a chip ("Every month" / "Until Jun
2027"). Removing a repeating row asks "Only <month>" or "<month> and later months"; a one-month row is removed directly.

## 12. Goals `/goals`
Cards: name, target, date, progress ring, current, required monthly, status chip; detail drawer with
linked items and shares.
Repeating goals (owner request): the goal form has a **One-time / Repeats** switch; Repeats shows presets (Every year,
Every 2 years, Every 6 months, Every 3 months, Every month, Custom: every N months/years), "Amount each time" and
"First due date" ("Next due date" when editing). The card shows "Amount due <date>", a "Repeats every …" chip,
**Complete cycle** and **Skip** buttons (each behind a confirm stating the next due date moves on and no money moves) and
a "Past cycles" list (due date, Done/Skipped, progress of target).
Goal savings accounts on the card: a **Funded by** box listing them with balances and a "+ Goal savings account" link (the
account form with this goal chosen); **Pay from goal** (when the goal has one) opens Quick add as an Expense from the first
of them with the target amount and the goal name filled in and no goal-money question; for a repeating goal the success
toast offers **Complete cycle**.

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
Monthly summary (owner request): "Expenses by category" and "Income by category" cards, each a donut (top 5 + Other,
total in the centre) over a table (category, amount, share, vs previous) showing the top 5 with "Show all N categories".
vs previous reads "New" when last month was 0 and ">+999%" above that. Paid-out investment income is one income row.
Investing section (owner request): Money in & out (bought, sold, net invested, buy & sell fees, realised gains) ·
Investment income (received = paid out + reinvested, tax withheld) · Portfolio value (start + new holdings at cost + net
invested + income reinvested net of tax + market, interest & FX = end) · a by-holding table (top 5, Show all) · SIPs line;
a note when holdings have stale values (their market change shows as 0).

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
