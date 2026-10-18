# 01 — Product Requirements (Version 1)

## 1. Vision
One private place to track **all** personal money: daily spending, every account, every investment
and redemption, debts, goals and safety nets — with SIP planning, rebalancing and an opportunity
fund built in. Inspired by FinBoom (manual-first net-worth tracker) but built on a **ledger**, so
every number (net worth, savings rate, returns, drift) is derived from recorded money movements.

## 2. Principles
- **Manual-first, private.** No bank or broker connections. The user records or confirms everything.
- **Amounts first.** Investments need only *invested amount* and *current value*. Units/price are an
  optional per-holding toggle ("Track units and price").
- **Nothing moves money automatically.** Reminders say what is due; the user confirms once done.
- **Correct by construction.** Transfers are never income/expense; card payments are never expenses
  twice; fees and taxes are explicit; edits recompute everything that depends on them.
- **Fast daily use.** Quick-add from anywhere, keyboard friendly, mobile responsive (PWA-installable).

## 3. User
One person (the owner) managing personal finances in LKR, with optional foreign-currency holdings
(USD, crypto). Architecture stays multi-user safe.

## 4. Scope — every feature below is in Version 1

### 4.1 Accounts
- Types: `bank`, `cash`, `wallet`, `credit_card`, `loan`, `broker_cash`, `opportunity_fund`,
  `receivable` (money lent to others), `payable` (informal money owed to others).
- Opening balance + opening date, currency, institution, notes, archive.
- Credit cards: limit, statement day, due day; shows outstanding, utilisation, next due.
- Flags: `includeInNetWorth`, `countsTowardEmergencyFund`.
- Reconcile: enter the real balance; app posts an `adjustment` transaction for the difference.
- **Earmarks (cash buckets):** split an account's balance between Emergency fund, Opportunity fund
  and Free cash without moving money. Accounts of type `opportunity_fund` are implicitly 100% opportunity; accounts flagged
  `countsTowardEmergencyFund` are implicitly 100% emergency. A dip guard warns before spending earmarked money.
- **Auth:** Forgot/reset password, optional email verification, TOTP two-factor with backup codes,
  active sessions list.

### 4.2 Transactions (the ledger)
Types: `income`, `expense`, `transfer`, `invest`, `redeem`, `investment_income`, `debt_payment`,
`adjustment`, `opening_balance`.
- Categories (2 levels) for income/expense; tags; notes; attachments (receipts).
- Split transactions (one expense across several categories).
- Transfers between any two accounts, including cross-currency (amount out ≠ amount in).
- Fees and taxes as explicit fields on invest/redeem/income.
- Void (never hard delete); edit = void + re-post inside one DB transaction.
- Filters: date range, type, account, category, holding, tag, amount range, text search.
- CSV import of bank statements (column mapping, preview, duplicate detection, auto-category rules).

### 4.3 Assets & holdings
- Asset classes (user-defined, seeded): Equity, Fixed Income, Gold, Crypto, Real Estate, Cash & Equivalents, Other.
- Instrument types: `stock`, `mutual_fund`, `unit_trust`, `etf`, `bond`, `treasury`, `money_market`, `fd`, `gold`,
  `crypto`, `real_estate`, `epf_etf`, `other`.
- Mandatory: name, class, instrument type, invested amount, current value (opening values when added).
- Optional: units, price/NAV, currency, platform/broker, liquidity, tags, notes.
- Toggle "Track units and price" per holding.
- Actions: Buy, Redeem (by amount; by units if tracking), Record income (dividend, interest,
  distribution, rent; paid out or reinvested; with withholding tax), Update value (single + bulk),
  Close holding.
- FD: principal, rate, start, maturity, compounding (`simple`, `monthly`, `quarterly`, `annually`),
  payout (`at_maturity`, `monthly`, `quarterly`); value auto-calculated; maturity → renew or withdraw.
- Real estate: current value only; optional rent income.
- Valuation history per holding; stale indicator; confirmation on >20% change.
- Metrics: invested, current value, unrealised gain, realised gain, income received, total return,
  XIRR, holding period, weight in class and portfolio.

### 4.4 SIP planner
- Plans: name, amount, frequency (`monthly` on day N, `weekly` on weekday), source account,
  start/end date, status (`active`, `paused`, `ended`).
- Allocation defaults to the target allocation (one planned allocation for the whole app); a plan may switch to a custom two-level tree (class % → asset %). Final per-asset
  amount auto-calculated with exact rounding.
- Step-up: increase by X% every N months.
- Missed policy: `skip` or `carry_forward` (shortfall added to the next period).
- Plan versioning: allocation edits create a new version; history keeps the version used.
- Upcoming list (due/overdue), Execute screen pre-filled, adjust actual amount per asset, optional
  units/price, fee per line. Partial execution allowed. Skip with reason.
- History: timeline per plan, planned vs actual, status, consistency score (on-time %), total
  invested vs current value for the plan's assets, XIRR of SIP cashflows.
- Drift-aware suggestion: optionally tilt this period's split toward under-weight classes.

### 4.5 Allocation (target & rebalancing)
- The target allocation is the single planned allocation used by SIP plans,
  rebalancing and opportunity deployments by default. Saving it records history. Emergency-flagged holdings count in the allocation but are never traded by rebalancing.
- Target allocation (two-level, independent of SIP) + drift threshold (default 5%).
- Current vs target by class, then by asset within class; drift in % points and amount.
- Two plans: **cashflow rebalance** (where to put the next N amount, no selling) and **full
  rebalance** (buy/sell amounts to hit target). Plans are suggestions; "Apply" opens pre-filled
  invest/redeem forms.

### 4.6 Opportunity Fund
- Linked to an `opportunity_fund` account (cash reserve) and a benchmark (default "ASPI").
- Market levels entered manually (date, level); reference high = highest level since last reset.
- Rules: drawdown % → deploy % of the fund balance at cycle start (e.g. −10% → 25%, −20% → 50%, −30% → 100%).
- Banner "Market drop detected" + notification when a rule triggers; each rule fires once per cycle;
  cycle resets on a new high.
- Record deployment: amount split by its own two-level allocation, posted as invest transactions
  from the fund account; deployment history.
- Target fund size and progress.
- Fund balance = opportunity earmarks + balances of opportunity_fund accounts. Deployment allocation
  defaults to the target allocation.

### 4.7 Debts & receivables
- Loans (linked to a `loan` account): principal, annual rate, tenure, start date, EMI (calculated
  or entered), payment day. Amortisation schedule; payment splits principal/interest; prepayment
  (reduce tenure or reduce EMI); payoff date and total interest; progress.
- Credit cards handled as liability accounts (see accounts).
- Receivables/payables: counterparty, expected date, partial settlements via transfers.

### 4.8 Recurring transactions
- Templates for salary, rent, bills, subscriptions, transfers, EMIs (income/expense/transfer/
  debt_payment). Frequency, next due date, reminder lead days. Confirm creates the real transaction
  (editable amount). Skip. Never auto-posts.

### 4.9 Budgets
- Monthly budget per expense category (copy forward each month). Budget vs actual, % used,
  alerts at 80% and 100%. Unbudgeted spending shown.

### 4.10 Goals
- Name, target amount, target date, priority, linked holdings/accounts (with optional % of each).
- Progress, shortfall, required monthly contribution, on-track status.

### 4.11 Essentials
- Emergency fund: months target (default 6) × average monthly *essential* expenses (categories
  flagged essential, trailing 6 months). Current = flagged accounts + flagged liquid holdings.
- Emergency target is configured in Settings: months × monthly basis (essential expenses, all expenses or a manual
  amount), or a fixed override. Progress bar on the dashboard shows current/target, months covered, available immediately.
- Insurance policies: type (life, health, vehicle, home, critical illness, other), provider, cover,
  premium, frequency, renewal date, nominee note. Coverage check vs targets (life cover multiple of
  annual income, health cover amount) set in settings.
- Health score combining emergency fund, insurance, debt-to-income and savings rate.

### 4.12 Dashboard
Net worth (+ change this month), assets vs liabilities, net worth trend, cashflow this month
(income, expense, savings, savings rate), top expense categories, allocation donut, upcoming
(SIPs, bills, EMIs, FD maturities, renewals — next 14 days), stale valuations count, goal progress,
essentials summary, opportunity-fund status, budget status.
Time range controls (Today…All, custom; Day/Week/Month; compare to previous period) drive every chart.
Standing summary (net worth, savings rate, investment rate, runway, debt load, health score), cash bar (Emergency/Opportunity/Free)
and Safe to spend.

### 4.13 Reports
Monthly summary, income vs expense trend (12 months), category breakdown, investment performance
(by holding/class: invested, value, realised, unrealised, income, XIRR), realised gains for a
year, investment income & tax withheld for a year, net worth history. Export each as CSV.
Monthly review (auto-generated).

### 4.14 Cashflow forecast
30/60/90-day projection per account and total using recurring templates, SIP plans and EMIs;
warns when a projected balance goes below zero or below a minimum.
Net worth projection (5/10 years, 3 scenarios). Deterministic insights.

### 4.15 Notifications & reminders
In-app notification centre + optional email. Daily job (06:00 user timezone) generates: SIP due /
overdue, recurring due, EMI due, card payment due, FD maturing (7 days), insurance renewal (30
days), stale valuations, budget 80%/100%, goal off-track (monthly), opportunity-fund trigger,
projected negative balance. Deduplicated; mark read; snooze.

### 4.16 Data & settings
Settings: base currency, timezone, stale days (30), drift threshold, emergency months, insurance
targets, big-change threshold (20%), notification preferences. FX rates (manual). Full JSON
backup/restore; CSV export of transactions. Net-worth snapshots monthly (auto) + manual.
Auth: forgot/reset password, optional email verification, TOTP two-factor with backup codes,
active sessions list.

## 5. Out of scope (V1)
Bank/broker sync, live price feeds (design an interface for it), family/shared accounts, tax
filing, billing/subscriptions, native mobile apps (PWA instead), AI advice.

## 6. Non-functional
- Pages load < 1s with 10k transactions; aggregations indexed.
- Every money operation atomic; recompute endpoint can rebuild all caches from the ledger.
- Auth required for every page except login/register; secure cookies; rate-limited login.
- Accessible (keyboard, labels, contrast), light/dark mode, responsive to 360px.
