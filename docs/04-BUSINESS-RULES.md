# 04 — Business Rules & Calculations

Every rule here is implemented as a pure function in `src/domain/` with unit tests that include the
worked examples below. All amounts are integer minor units; all percentages are basis points (bp).
Rounding helper: `roundHalfAwayFromZero`. Never use floats for stored money.

---

## 1. Account balance (cache, `recomputeAccount`)
`balance = openingBalanceMinor + Σ effect(t)` over posted transactions touching the account.

| Type | Effect on `fromAccount` | Effect on `toAccount` |
|---|---|---|
| income | – | + amount |
| expense | − amount | – |
| transfer | − (amount + fee) | + (toAmountMinor ?? amount) |
| invest | − (amount + fee) | – |
| redeem | – | + (amount − fee − tax) |
| investment_income (paid out) | – | + (amount − tax) |
| investment_income (reinvest) | – | – |
| debt_payment | − amount | loan account: + principal |
| adjustment | − amount (if from) | + amount (if to) |
| opening_balance | – (holdings only) | – |

Transfer fee (optional, owner request): charged to the source account on top of the amount, in the
source currency; the transfer is tagged with the system category "Bank fees".

Transfers with assets (owner request): the Transfer entry may have an asset on either side. The amount
is what arrives; the optional fee leaves the source on top of it.
- account → asset = `invest` (amount, fee) — account −(amount + fee).
- asset → account = `redeem` of amount + fee with that fee (§3 cost removed / realised gain) — account +amount.
- asset → asset = **switch**: `redeem` of amount + fee (fee) from A and `invest` of amount into B, posted in one DB
  transaction with a shared groupId and `source.kind = switch`; no account changes. Both assets must use one
  currency. A switch is not edited; voiding either leg voids both. Excluded from cashflow like invest/redeem.
- FDs with deposit terms are withdrawn or renewed from their page, not transferred.

Sign convention: liabilities (`credit_card`, `loan`, `payable`) sit below zero. Card spend makes the
card more negative; paying the card is a **transfer** bank → card (never an expense).
A new loan account is created with `openingBalanceMinor = −outstanding`. Loan disbursement into a
bank is a transfer loan → bank.

**Reconcile:** user enters real balance `R`; post `adjustment` for `R − balance` (to-account if
positive, from-account if negative) in category "Balance adjustment".

## 2. Net worth
- Convert every account balance (with `includeInNetWorth`) and every active holding value to base
  currency (§14).
- `assets = Σ positive balances + Σ holding values`; `liabilities = Σ |negative balances|`.
- `netWorth = assets − liabilities`.
- `computeNetWorthAsOf(date)` uses transactions with `date ≤ date` and the latest valuation `≤ date`;
  used to rebuild history snapshots.

## 3. Holding totals (cache, `recomputeHolding`)
Process posted transactions for the holding in date order (ties: createdAt).

| Event | invested | value effect | other |
|---|---|---|---|
| opening_balance | + amount | (valuation created with entered current value) | |
| invest (buy) | + amount + fee | + amount | feesPaid += fee; units += units |
| redeem | − costRemoved | − amount | realizedGain += amount − costRemoved − fee; taxWithheld += tax |
| investment_income paid out | – | – | incomeReceived += amount; taxWithheld += tax |
| investment_income reinvest | + (amount − tax) | + (amount − tax) | incomeReceived += amount; taxWithheld += tax |

**Current value:** take the latest valuation `V` at date `D`. Events are processed by date and,
within the same date, **in the order they were entered** (owner decision, Phase 3): `V` includes
flows dated before `D` and same-day flows entered before it; flows entered after it on `D`, and
flows dated after `D`, adjust it. `currentValue = V.value + Σ value effects of those later flows`.
(Example: add a holding today with today's value, then buy today → the buy adds to the value.) With no
valuation, start from 0. For `trackUnits` holdings with a known price: `currentValue = units × lastPrice`
where `lastPrice` is the most recent price from a valuation or transaction.
`fd` holdings: value from §9, not manual valuations.

**Unrealised gain** = currentValue − invested. **Total return** = unrealised + realised + incomeReceived − taxWithheld.
**Return %** = unrealised ÷ invested (show "—" if invested = 0).

### Redemption — proportional cost method (default)
```
share        = amount / currentValue            (exact rational, not rounded)
costRemoved  = round(invested × share)
realizedGain = amount − costRemoved − fee
cashToAccount= amount − fee − tax
```
If `amount ≥ currentValue` → full redemption: costRemoved = invested, value afterwards = 0, holding
offered "Close holding". If currentValue is stale (§12) show a prompt to update value first.

**Worked example:** invested 40,000, value 50,000, redeem 20,000, fee 100 →
share 40%, costRemoved 16,000, realised gain 3,900, cash in 19,900, remaining invested 24,000,
remaining value 30,000.

### Redemption by units (trackUnits on)
`costRemoved = round(invested × unitsSold / unitsHeld)`; `amount = unitsSold × price`.

### Buying with units on
`avgCostMinor = round(invested / units)` (per unit, fees included).

## 4. Cashflow & savings rate (monthly, user timezone)
- **Income** = Σ `income` + Σ `investment_income` paid out (shown as a separate "Investment income" line).
- **Expense** = Σ `expense` (splits counted per category) + Σ interest portion of `debt_payment`
  + Σ transfer fees ("Bank fees").
- Excluded: transfer amounts (only their fee counts), invest, redeem, principal portion of debt_payment, adjustment, opening_balance.
- **Savings** = income − expense; **Savings rate** = savings ÷ income (— if income = 0).
- Investment fees are part of investment return, not expenses. Card spend counts on the spend date.

## 5. Returns — XIRR
Cashflows (investor perspective) per holding:
- invest: −(amount + fee) on its date
- redeem: +(amount − fee − tax)
- investment_income paid out: +(amount − tax); reinvested: no external cashflow
- opening_balance: −invested amount on the opening date
- terminal: +currentValue today (if holding active)

Portfolio XIRR = all holdings' flows combined. Class XIRR = holdings in the class.
Solver: Newton–Raphson from 0.1, fallback bisection on [−0.9999, 10]; tolerance 1e-7; 100 iterations.
Return `null` when flows lack a sign change or span < 90 days (then show simple return only).
Test: flows −10,000 (2025-01-01), +11,000 (2026-01-01) → ≈ 10.00%.

## 6. Allocation trees (SIP, target, opportunity fund)
Allocation trees are used by the target allocation (the single planned allocation), by SIP versions that choose `custom`, and by
opportunity deployments that choose `custom`. SIP and deployments default to the target.

Structure: `[{ assetClassId, percentBp, assets: [{ holdingId, percentBp }] }]`.
Validation:
- class percents sum to exactly 10000; each class with assets: asset percents sum to 10000;
- no duplicate classes or holdings; every holding is active and belongs to that class;
- percents are integers 0–10000; a class at 0% is allowed but warned.

**Split** (`splitByTree(total, tree)`): allocate `total` across classes with the largest-remainder
method, then each class amount across its assets the same way. Lines always sum to `total`.
Largest remainder: `floor` each share, then distribute leftover minor units to the largest fractional
remainders (ties → earlier item).
**Example:** 100,000.00 with Equity 50% (A 40%, B 20%, MF 40%), Fixed 30% (UT 100%), Gold 10%,
Crypto 10% → A 20,000; B 10,000; MF 20,000; UT 30,000; Gold 10,000; BTC 10,000.
**UI editing:** changing a class % keeps its asset percents (asset amounts rescale); changing an asset
% affects only that class; an "auto-balance" button distributes the remaining bp to the last row.

## 7. SIP engine
- **Periods:** monthly due date = `dayOfMonth` (31 = last day; clamp to month length); weekly =
  next `weekday`. Computed in the user timezone. Period key `YYYY-MM` / `YYYY-Www`.
- **Generation (daily job):** for each active plan, create `sipExecutions` with status `due` for every
  period from `startDate` until today + 7 days (idempotent by unique `{planId, periodKey}`); stop at `endDate`.
- **Step-up:** `stepped = round(amount × (1 + percentBp/10000)^floor(monthsSinceStart / everyMonths))`,
  rounded to whole major units.
- **Planned total** = stepped + carryIn. `carryIn` = previous period shortfall
  (planned − actual) when `missedPolicy = carry_forward` and previous status is `missed` or `partial`.
- **Version:** use the `sipPlanVersions` entry with the greatest `effectiveFrom ≤ dueDate`.
- **Missed:** status `due` and `today > dueDate + graceDays` → `missed` (daily job).
- **Execute** (one DB transaction): validate lines (actual ≥ 0, fee ≥ 0, holdings active); run the dip guard (§20) on the source account; for each
  line with actual > 0 post `invest` from `sourceAccountId` (source `sip_execution`, shared `groupId`);
  set `actualTotal`, `executedAt`, `onTime = executedAt ≤ dueDate + graceDays`;
  status = `done` if actualTotal ≥ plannedTotal, `partial` if 0 < actualTotal < plannedTotal.
  Over-investing is allowed (status done). Warn (don't block) if source balance would go negative.
- **Skip:** status `skipped` with reason; no transactions.
- **Undo:** void every transaction in `groupId`, reset execution to `due` (or `missed` if past grace).
- **Paused plans** generate nothing; resuming does not back-fill paused periods.
- **Consistency** = on-time done executions ÷ executions with dueDate ≤ today (skipped count as not on time).
- **Plan performance:** invested = Σ actual of done/partial lines; current value = Σ of each line's
  holding value × (that plan's invested in the holding ÷ holding invested) — label as "estimated
  share". XIRR from the plan's invest flows + estimated terminal value.
- **Drift tilt** (§8 cashflow rebalance) when `useDriftTilt`: show suggested split beside the normal
  split; user chooses which to pre-fill.

## 8. Rebalancing
- Universe: active holdings whose class is in the target; other classes reported as "outside target".
  Universe excludes holdings flagged `countsTowardEmergencyFund`.
- `V = Σ values in universe`; `weight_i = value_i / V`; `drift_i = weight_i − target_i` (bp).
- Class flagged when `|drift| ≥ thresholdBp`; asset drift computed within its class against the
  class's asset targets (if defined).
- **Full rebalance:** `trade_i = round(target_i × V − value_i)` (positive buy, negative sell);
  lines sum to 0 after largest-remainder fix.
- **Cashflow rebalance** for new money `S`: `deficit_i = max(0, target_i × (V + S) − value_i)`;
  allocate `S` proportionally to deficits (largest remainder); if Σ deficits = 0 use the target split.
  Within a class, split by asset targets, or by the SIP version's asset percents if none.

## 9. Fixed deposits
- Deposit terms are optional (owner decision). An FD **with** terms is valued by the formulas below; an FD
  **without** terms takes opening invested + current value and later valuations like any market holding (§3),
  and has no maturity reminders or withdraw/renew actions. The Money Manager import creates FDs without terms.
- days = maturity or today (whichever earlier) − start; years = days / 365.
- Simple: `P × (1 + r × years)`. Compounding m per year: `P × (1 + r/m)^(m × years)`.
- Payout FDs (`monthly`/`quarterly`): value = principal; interest per period
  `round(P × r / periodsPerYear)` is due as `investment_income` (interest) to `payoutAccountId`;
  generated as a reminder, posted on confirm.
- Maturity: notify 7 days before. Actions: **withdraw** (redeem full maturity value into an account,
  close) or **renew** (redeem + new FD holding funded by the proceeds, linked by groupId).
- Daily job writes an `fd_calc` valuation on the 1st of each month and at maturity for history.

## 10. Loans
- `r = annualRateBp / 10000 / 12`; `EMI = P × r × (1+r)^n / ((1+r)^n − 1)`; r = 0 → `P / n`. Round to minor unit.
- Schedule row: `interest = round(outstanding × r)`, `principal = EMI − interest`; final row pays the
  remaining outstanding.
- **Payment posting:** interest = round(outstanding × r); principal = amount − interest (if amount <
  interest, all interest, warn). Excess over scheduled EMI is a prepayment of principal.
- **Prepayment:** `reduce_tenure` keeps EMI and recomputes n; `reduce_emi` keeps n and recomputes EMI.
- Caches: outstanding = −(loan account balance); principalPaid, interestPaid, nextDueDate, projected payoff.
- Debt-to-income = Σ EMIs ÷ average monthly income (last 3 months).

## 11. Recurring rules
- `nextDueDate` per frequency (monthly day clamp, weekly weekday, yearly month/day, every N months).
- Confirm → creates the real transaction (amount editable), advances `nextDueDate`, source `recurring`.
- Skip → advances without posting. Never auto-post. Reminder at `nextDueDate − reminderDaysBefore`.

## 12. Valuation safeguards
- **Stale:** active, non-FD holding with value > 0 and `lastValuedAt` older than `staleDays`.
- **Big change:** `|new − old| / old > bigChangeThresholdBp` → action requires `confirmBigChange: true`.
- Bulk update: one valuation per changed row, all in one DB transaction.

## 13. Budgets, goals, essentials, health score
- **Budget actual** = expense in the category and its children for the month (splits included).
  Alerts at 80% and 100% (once per category per month).
- **Goal current** = Σ linked value × shareBp. **Required monthly** (r = expectedReturnBp/12, n months left):
  r = 0 → `(target − current)/n`; else `(target − current×(1+r)^n) × r / ((1+r)^n − 1)`.
  On track if required monthly ≤ 110% of the average net monthly contribution to linked items over the
  last 3 months; achieved when current ≥ target.
- **Emergency fund:** basis = settings.emergencyExpenseBasis (essential falls back to all when no category is flagged essential; manual uses
  emergencyManualMonthlyMinor); target = emergencyTargetOverrideMinor ?? basis × emergencyMonths; current = emergency bucket (§20).
  Essential/all basis = average monthly expense (in `isEssential` categories, or all categories) over the last 6 complete months;
  coverage months = current ÷ basis.
- **Insurance check:** life cover target = annual income (last 12 months) × lifeCoverIncomeMultiple;
  health cover target from settings.
- **Health score (0–100):** emergency 30 × min(1, current/target); insurance 25 (12.5 life, 12.5 health,
  each min(1, cover/target)); debt 20 (DTI ≤ 30% → 20, ≥ 60% → 0, linear); savings 25 (rate ≥ 30% →
  25, ≤ 0 → 0, linear). Round to integer.

## 14. Currency
- Each account/holding has a currency; transactions inherit it.
- Conversion to base: latest `fxRates` rate on or before the date (direct, else inverse). Missing →
  show "FX rate missing" badge and exclude from totals (never assume 1:1).
- Cross-currency transfer stores both amounts; implied rate saved.

## 15. Opportunity Fund
- `drawdownBp = round((referenceHigh − latestLevel) / referenceHigh × 10000)`.
- New level > referenceHigh → new cycle: referenceHigh = level, triggered list cleared,
  `fundBalanceAtStartMinor` = current fund balance.
- Rules are **cumulative** targets: rule k triggers when drawdown ≥ drawdownBp_k and not yet triggered
  → notification + banner. Suggested deployment =
  `deployPercentBp_k × fundBalanceAtStart − deployed this cycle` (floored at 0, capped at fund balance).
- Fund balance = opportunity bucket (§20). `fundBalanceAtStartMinor` uses it. Deployment posts from a chosen source account holding
  opportunity money and reduces its opportunity earmark by the amount.
- Deployment (one DB transaction): split by the fund's allocation tree (the target allocation unless `custom`, §6); post `invest` from
  the source account per line (source `opportunity_deployment`, groupId); record deployment.
- Example: fund 1,000,000; rules −10%→25%, −20%→50%, −30%→100%; at −12% suggest 250,000; at −21%
  (250,000 deployed) suggest 250,000 more.

## 16. Snapshots
- Daily job: on the 1st (user tz) create the `auto` snapshot for the previous month-end using
  `computeNetWorthAsOf(monthEnd)` (idempotent). Manual snapshot = now.
- "Rebuild history" recomputes all month-end snapshots from the ledger.
- Day/week series are computed on the fly (§22); month-end snapshots remain a cache. Snapshots must use the §9 FD formula, never the
  cached FD value.

## 17. Forecast
- Horizon 30/60/90 days from today; starting balances = current caches.
- Events: recurring rules (active), SIP plans (planned stepped amount from source account), EMIs, card
  dues (card outstanding at statement date payable on due day from the default payment account if set).
- Output per day per account and total; flag first date below 0 or below `minBalanceWarningMinor`.

## 18. Edits, voids, integrity
- Edit = void old + post new (`replacedById`) in one DB transaction; recompute affected caches.
- Transactions with `source.kind` of `sip_execution` / `opportunity_deployment` are edited only through
  their owner (undo execution / deployment).
- An account with a non-zero balance cannot be archived, and a holding with a non-zero value cannot
  be closed, without explicit confirmation.
- `scripts/recompute-all.ts` rebuilds all caches; a test asserts recompute is idempotent.

## 19. Notifications (daily job, idempotent by `dedupeKey`)
| Type | When | dedupeKey |
|---|---|---|
| sip_due | execution due within 2 days | `sip_due:<executionId>` |
| sip_overdue | due date passed, not executed | `sip_overdue:<executionId>` |
| recurring_due | reminder date reached | `rec:<ruleId>:<dueDate>` |
| emi_due | 3 days before payment day | `emi:<debtId>:<period>` |
| card_due | 5 days before card due day, outstanding > 0 | `card:<accountId>:<period>` |
| fd_maturing | 7 days before maturity | `fd:<holdingId>` |
| insurance_renewal | 30 days before renewal | `ins:<policyId>:<renewalDate>` |
| stale_values | weekly (Mon) if any stale | `stale:<isoWeek>` |
| budget_80 / budget_100 | threshold crossed | `bud:<categoryId>:<month>:<80|100>` |
| goal_off_track | 1st of month | `goal:<goalId>:<month>` |
| opportunity_trigger | rule triggered | `opp:<cycleStart>:<ruleIdx>` |
| negative_forecast | 30-day forecast below minimum | `fc:<accountId>:<date>` |
| over_earmarked | account over-earmarked | `earm:<accountId>` |
Email sent only if enabled and `RESEND_API_KEY` is configured.

## 20. Earmarks (cash buckets) and free cash
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
- Implementation notes (MOD-2, owner-approved): the source exemption (opportunity_deployment, fd_maturity, reconcile) applies to
  every account, not only dedicated ones (an FD renewal redeems into an account and reinvests the same day). The guard uses the
  account's current balance. A confirmed dip stores each dipped bucket as a fixed amount (effective − dip). Voiding a confirmed
  outflow returns the money to free cash; earmarks are not restored. An account with explicit earmarks cannot be flagged
  `countsTowardEmergencyFund` until they are removed.

## 21. Safe to spend
`safeToSpend = freeCash − Σ outflowMinor of upcoming items due on or before the end of the current month (user tz) that are not yet
posted` (recurring expenses, EMIs, card dues, planned SIPs paid from earmarkable accounts). May be negative → show a warning.
Card dues count their full outstanding when the next due date falls on or before month end (owner decision, Phase 4).

## 22. Time ranges and series
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
