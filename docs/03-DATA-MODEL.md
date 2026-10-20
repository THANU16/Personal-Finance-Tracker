# 03 — Data Model (MongoDB)

Conventions for every collection:
- Prices per unit (NAV): `*PriceMinorE4` / `priceMinorE4` = minor units × 10⁴ (4 decimals beyond the
  currency, e.g. NAV 12.3456 LKR = 123456). Units are numbers kept to 6 decimals. (Owner decision, Phase 3.)
- `_id: ObjectId`, `userId: ObjectId` (indexed, required), `createdAt`, `updatedAt` (timestamps).
- Money: `*Minor: number` (integer, minor units). Percent: `*Bp: number` (basis points, 10000 = 100%).
- Currency: ISO code string (`"LKR"`, `"USD"`), crypto allowed (`"BTC"` only for holdings).
- Soft archive via `archivedAt?: Date` for master data; financial records use `status`.
- Fields marked `cache` are derived and rebuilt by recompute functions — never edited directly.

---

## users / sessions / accounts(auth)
Managed by Better Auth (its own collections, prefixed `auth_` if configurable). App code reads `user.id` only.
Collections: `auth_users` (+ `twoFactorEnabled`), `auth_sessions`, `auth_accounts`, `auth_verifications` (reset/verify tokens,
pending 2FA sign-ins), `auth_rate_limits`, `auth_two_factors` (`userId`, `secret` and `backupCodes` encrypted with
BETTER_AUTH_SECRET, `verified`, lockout counters). Unset emergency settings amounts are stored as `null`.

## settings (one per user)
```
userId (unique), baseCurrency: "LKR", timezone: "Asia/Colombo", locale: "en-LK",
staleDays: 30, bigChangeThresholdBp: 2000, driftThresholdBp: 500,
emergencyMonths: 6, lifeCoverIncomeMultiple: 10, healthCoverTargetMinor,
emergencyExpenseBasis: essential|all|manual (default essential), emergencyManualMonthlyMinor?,
emergencyTargetOverrideMinor?,
minBalanceWarningMinor: 0, projectionReturnBp: 800, hideAmounts: false,
notify: { email: boolean, inApp: true, dailyHourLocal: 6 },
onboardingCompletedAt?, bootstrapVersion: 0   # one-time per-user seeding applied (Phase 2)
```

## accounts
```
name, type: bank|cash|wallet|credit_card|loan|broker_cash|opportunity_fund|receivable|payable,
currency, institution?, notes?, color?, icon?,
openingBalanceMinor, openingDate,              # signed; liabilities negative
includeInNetWorth: true, countsTowardEmergencyFund: false,
creditCard?: { limitMinor, statementDay, dueDay },
counterparty?: string,                          # receivable/payable
balanceMinor (cache), lastTransactionAt (cache),
archivedAt?
idx: {userId, type}, {userId, archivedAt}
```
Sign convention: asset accounts positive; `credit_card`, `loan`, `payable` normally negative.

## earmarks
```
bucket: emergency|opportunity, accountId, mode: fixed|percent, amountMinor?, percentBp?, note?
idx: {userId, accountId}, {userId, bucket, accountId} unique
```
Only earmarkable accounts (bank, cash, wallet, broker_cash); dedicated accounts reject earmarks.

## categories
```
name, kind: income|expense, parentId?, icon?, color?, isEssential: false, isSystem: false, archivedAt?
idx: {userId, kind, parentId}
```
System categories (seeded, `isSystem`): "Loan interest", "Bank fees", "Investment fees",
"Investment income", "Balance adjustment", "Uncategorised".

## categoryRules (CSV import auto-categorisation)
```
matchField: description|counterparty, operator: contains|equals|regex, pattern, categoryId, priority
```

## assetClasses
```
name, color, sortOrder, isSystem, archivedAt?
```
Seed: Equity, Fixed Income, Gold, Crypto, Real Estate, Cash & Equivalents, Other.

## holdings
```
name, assetClassId, instrumentType: stock|mutual_fund|unit_trust|etf|bond|treasury|money_market|fd|gold|crypto|real_estate|epf_etf|other,
currency, platform?, symbol?, liquidity: high|medium|low, tags: [string], notes?,
trackUnits: false,
fd?: { principalMinor, rateBp, startDate, maturityDate,
       compounding: simple|monthly|quarterly|annually,
       payout: at_maturity|monthly|quarterly, payoutAccountId?, autoRenew: false },
countsTowardEmergencyFund: false,
status: active|closed, closedAt?,
# caches (recomputeHolding)
investedMinor, currentValueMinor, units?, avgCostMinor?, realizedGainMinor,
incomeReceivedMinor, feesPaidMinor, taxWithheldMinor, firstInvestedAt?, lastValuedAt?, lastPriceMinorE4?
idx: {userId, status}, {userId, assetClassId}
```

## valuations
```
holdingId, date, valueMinor, priceMinorE4?, units?, source: manual|auto_on_buy|auto_on_redeem|fd_calc|bulk|price_feed|import,
note?, importBatchId?                          # set by an import; undo removes these valuations
recordedAt?                                    # when the value was entered (imports carry the original time); orders same-day events
importHash?                                    # valuation CSV import dedupe (Phase 3b)
idx: {userId, holdingId, date:-1} · {userId, importHash} unique partial (importHash is a string)
```
The latest valuation (by `date`, then `recordedAt`, then `createdAt`) defines `currentValueMinor`, adjusted by
buys/redeems posted **after** that valuation date (see Business Rules §3). The importHash index is partial, not sparse: a
compound sparse index still indexes every document that has `userId` (same as transactions).

## transactions
```
type: income|expense|transfer|invest|redeem|investment_income|debt_payment|adjustment|opening_balance,
date, amountMinor (>0), currency,
fromAccountId?, toAccountId?,
toAmountMinor?, fxRate?,                      # cross-currency transfer
categoryId?, splits?: [{ categoryId, amountMinor, note? }],
holdingId?,
units?, priceMinorE4?,                        # invest/redeem when trackUnits
feeMinor: 0, taxMinor: 0,
incomeKind?: dividend|interest|distribution|rent|other, reinvest?: boolean,   # investment_income
redemption?: { costRemovedMinor, realizedGainMinor, unitsRemoved? },          # redeem (computed)
debtId?, principalMinor?, interestMinor?,     # debt_payment
description?, counterparty?, notes?, tags: [string], attachmentIds: [ObjectId],
source: { kind: manual|sip_execution|recurring|opportunity_deployment|import|reconcile|fd_maturity|system, refId? },
groupId?: ObjectId,                           # links lines of one operation
status: posted|void, voidedAt?, voidReason?, replacedById?,
importHash?                                   # dedupe for CSV import
idx: {userId, date:-1}, {userId, fromAccountId, date}, {userId, toAccountId, date},
     {userId, holdingId, date}, {userId, categoryId, date}, {userId, groupId},
     {userId, importHash} unique partial (importHash is a string) — a compound *sparse* index
     would still index every doc (all have userId) and collide on null; text index on description/notes
```
Field requirements per type (validated by Zod discriminated union):
| type | from | to | holding | category | extra |
|---|---|---|---|---|---|
| income | – | req | – | req (income) | |
| expense | req | – | – | req or splits | |
| transfer | req | req | – | system "Bank fees" if fee | toAmountMinor if currencies differ; optional feeMinor |
| invest | req (cash) | – | req | – | fee, units/price optional |
| redeem | – | req (cash) | req | – | fee, tax, units optional; redemption computed |
| investment_income | – | req unless reinvest | req | system | incomeKind, tax, reinvest |
| debt_payment | req | – (loan account derived from debt) | – | – | debtId, principal+interest = amount |
| adjustment | one of from/to | | – | system | reconcile |
| opening_balance | – | – | req | – | holdings only, created when a holding is added with existing invested amount (accounts use `openingBalanceMinor`) |

## sipPlans
```
name, status: active|paused|ended, amountMinor, currency,
frequency: monthly|weekly, dayOfMonth? (1-28 or "last" as 31), weekday? (0-6),
sourceAccountId, startDate, endDate?,
stepUp?: { percentBp, everyMonths },
missedPolicy: skip|carry_forward, graceDays: 7,
useDriftTilt: false,
currentVersion: number,
notes?
```

## sipPlanVersions
```
planId, version, effectiveFrom, amountMinor,
allocationSource: target|custom (default target),
allocation?: [{ assetClassId, percentBp, assets: [{ holdingId, percentBp }] }]   # required only when custom
idx: {userId, planId, version} unique
```

## sipExecutions
```
planId, planVersion, periodKey, dueDate,
status: due|done|partial|skipped|missed,
plannedTotalMinor, carryInMinor: 0, actualTotalMinor: 0, executedAt?, skipReason?,
lines: [{ assetClassId, holdingId, plannedMinor, actualMinor, feeMinor, units?, priceMinor?, transactionId? }],
groupId?, onTime?: boolean,
allocationUsed: [{ assetClassId, percentBp, assets: [{ holdingId, percentBp }] }]   # copy of the tree used
idx: {userId, planId, periodKey} unique, {userId, status, dueDate}
```

## targetAllocations (one active per user)
```
allocation: [{ assetClassId, percentBp, assets: [{ holdingId, percentBp }] }],  # assets optional per class
thresholdBp, updatedAt
```

## targetAllocationHistory
```
allocation, thresholdBp, savedAt, note?
```

## opportunityFunds (one per user)
```
benchmarkName: "ASPI", targetSizeMinor?,
rules: [{ drawdownBp, deployPercentBp }],           # ascending drawdown, cumulative deploy %
allocationSource: target|custom (default target),
allocation?: [{ assetClassId, percentBp, assets: [{ holdingId, percentBp }] }],   # only when custom
defaultSourceAccountId?,                            # any account holding opportunity money can be the source
cycle: { startedAt (business date of the level that opened it), fundBalanceAtStartMinor }
idx: {userId} unique
```
Reference high, latest level, drawdown and triggered rules are replayed from `marketLevels` (never stored), so backdated
or deleted levels cannot leave them stale. Only the cycle start and the fund balance at that moment are stored.

## marketLevels
```
benchmarkName, date (business date YYYY-MM-DD), level (number), note?
idx: {userId, benchmarkName, date} unique          # adding a level for an existing date replaces it
```

## opportunityDeployments
```
date (business date), amountMinor (Σ line amounts, excl. fees), currency, sourceAccountId, ruleIdx?, drawdownBpAtDeploy,
marketLevel?, cycleStartedAt, allocationUsed, lines: [{ assetClassId, holdingId, amountMinor, feeMinor, transactionId }],
earmarkReducedMinor (restored on undo), groupId, notes?, status: posted|undone, undoneAt?
idx: {userId, date:-1}
```

## debts
```
name, kind: bank_loan|leasing|personal|other, accountId (type loan), paymentAccountId?,
principalMinor, annualRateBp, tenureMonths (current plan), startDate, paymentDay, emiMinor,
lender?, paidBeforeTracking (instalments paid before the loan was added), status: active|closed, closedAt?,
prepayments: [{ date, amountMinor, mode: reduce_tenure|reduce_emi, transactionId,
                emiBeforeMinor, tenureBeforeMonths, emiAfterMinor, tenureAfterMonths, reverted }],
# caches (recomputeDebt, after every post/void with a debtId)
outstandingMinor, principalPaidMinor, interestPaidMinor, paymentsCount, nextDueDate, projectedPayoffDate
idx: {userId, accountId} unique · {userId, status}
```
Dates are business date keys. A `debt_payment` transaction stores the paying account as `fromAccountId`, the loan account
as `toAccountId` (it receives the principal), `debtId`, `principalMinor`, `interestMinor` and the "Loan interest" category.

## recurringRules
```
name, kind: income|expense|transfer|debt_payment,
template: { amountMinor, currency, fromAccountId?, toAccountId?, categoryId?, debtId?, description?, tags },
frequency: monthly|weekly|yearly|every_n_months, interval: 1, dayOfMonth?, weekday?, monthOfYear?,
startDate, endDate?, nextDueDate (null once ended), reminderDaysBefore: 2, isVariableAmount: false,
status: active|paused|ended, lastConfirmedAt?
idx: {userId, status, nextDueDate}
```
Dates are business date keys. `weekday`: 0 = Sunday. Confirm posts with `source: { kind: "recurring", refId: ruleId }`.

## budgets
```
month: "YYYY-MM", categoryId (expense), amountMinor (base currency), rollover: false (stored, not applied yet)
idx: {userId, month, categoryId} unique
```

## goals
```
name, targetMinor, targetDate, priority: 1-5, icon?, notes?,
links: [{ kind: holding|account, refId, shareBp: 10000 }],   # one item's shares across active goals ≤ 10000
status: active|achieved|archived, expectedReturnBp: 0
idx: {userId, status}
```
`targetDate` is a business date key. "achieved" / on-track status is computed on read; the stored status is active or archived.

## insurancePolicies
```
type: life|health|critical_illness|vehicle|home|other, provider, policyNumberLast4?,
coverMinor, premiumMinor, premiumFrequency: monthly|quarterly|yearly,
startDate, renewalDate, nominee?, notes?, status: active|lapsed
idx: {userId, status}   # base currency; dates are business date keys (Phase 10)
```

## snapshots
```
date (month-end, user tz), kind: auto|manual,
netWorthMinor, assetsMinor, liabilitiesMinor,
byClass: [{ assetClassId, valueMinor }], byAccountType: [{ type, valueMinor }],
investedMinor, cashMinor, holdingsValueMinor, fxMissing   # fxMissing: items left out (no FX rate on that date)
idx: {userId, date} unique for kind=auto
```
Monthly month-end snapshots are a cache; day/week series are computed on the fly (docs/04 §22).

## notifications
```
type: sip_due|sip_overdue|recurring_due|emi_due|card_due|fd_maturing|insurance_renewal|stale_values|
      budget_80|budget_100|goal_off_track|opportunity_trigger|negative_forecast|over_earmarked|system,
title, body, link, dueDate?, severity: info|warning|critical,
dedupeKey (unique per user), readAt?, snoozedUntil?, emailedAt?
idx: {userId, dedupeKey} unique; {userId, readAt, createdAt:-1}
```

## fxRates
```
date, base: "USD", quote: "LKR", rate (number, quote per 1 base), source: manual
idx: {userId, base, quote, date:-1} unique (one rate per pair per day; saving again replaces it)
```

## attachments
```
storageKey, fileName, mimeType, sizeBytes, transactionId?
```

## importBatches
```
kind: transactions|valuations (default transactions),
source: money_manager|bank_csv|valuation_csv, status: draft|previewed|imported|reverted,
holdingId?, fundingAccountId?                  # valuation imports (Phase 3b)
files: [{ name, sheet, rows, from?, to? }],    # one entry per sheet read; from/to = business dates
mapping                                        # wizard state (docs/07 §3): accounts, expenseCategories, incomeCategories,
                                               # skipRowIds, detachFeeIds, openings — validated by imports/schemas.ts
warnings: [string], summary?,                  # preview/commit counts
createdItems: { accountIds, categoryIds, holdingIds },
importedAt?, revertedAt?
summary (valuations): { rows, imported, duplicates, errors, deposits, withdrawals, depositMinor, withdrawalMinor }
idx: {userId, createdAt:-1}
```
Bank CSV import (Phase 11) adds its own mapping (date/description/amount columns, dateFormat, accountId) in `mapping`.
Transactions of a batch carry `source: { kind: "import", refId: batchId }` and an `importHash`; undo voids them and suffixes
the hash (`:undone:<batchId>`) so the same rows can be imported again.

## importRows (staging; docs/07 §5)
```
batchId, seq (merged chronological order), rowId ("file:row"), kind: expense|income|transfer|fee|difference|problem,
normalized (the normalised Money Manager row), hash, alreadyImported (row of an earlier imported batch → never posted again)
idx: {userId, batchId, seq}
```
Kept after import: the hashes of imported batches decide what a later file adds.

## importMappings (reused for the next file)
```
source, kind: account|expense_category|income_category, sourceKey (trimmed lower-case name; "cat>sub" for subcategories),
action (the saved choice; created items replaced by their ids)
idx: {userId, source, kind, sourceKey} unique
```

## auditLog
```
action, entity, entityId, before?, after?, at
```
Written by the ledger engine for post/void/recompute and by settings changes.
