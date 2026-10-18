---
name: finance-domain
description: WealthTrack money rules — ledger posting, balances, holdings, redemption, XIRR, SIP, allocation splits, rebalancing, loans, FD, opportunity fund. Use whenever writing or reviewing code that creates transactions, changes balances or holding values, or calculates any financial figure.
paths:
  - "src/domain/**"
  - "src/server/ledger/**"
  - "src/modules/transactions/**"
  - "src/modules/holdings/**"
  - "src/modules/sip/**"
  - "src/modules/debts/**"
  - "src/modules/opportunity-fund/**"
  - "src/modules/rebalancing/**"
---

# Finance domain rules (summary — full detail in docs/04-BUSINESS-RULES.md)

Read the matching section of `docs/04-BUSINESS-RULES.md` before implementing. If this summary and
the doc disagree, the doc wins; tell the user.

## Invariants (check every change against these)
1. Money = integer minor units (`*Minor`). Percent = basis points (`*Bp`, 10000 = 100%). No floats stored.
2. Ledger is truth. Balances and holding totals are caches from `recomputeAccount` / `recomputeHolding`.
   Only `src/server/ledger/` posts or voids transactions.
3. Multi-document writes inside `withTransaction`; pass `{ session }` to every query in it.
4. All queries filter by `ctx.userId`.
5. Split amounts with largest remainder — lines must sum exactly to the total.
6. Business dates in user timezone; store UTC.
7. Never hard-delete posted transactions: void, then recompute.

## Posting cheat sheet
| Type | from account | to account | holding |
|---|---|---|---|
| income | – | +amt | – |
| expense | −amt | – | – |
| transfer | −amt | +(toAmt ?? amt) | – |
| invest | −(amt+fee) | – | invested += amt+fee; value += amt |
| redeem | – | +(amt−fee−tax) | invested −= costRemoved; value −= amt |
| investment_income paid | – | +(amt−tax) | incomeReceived += amt |
| investment_income reinvest | – | – | invested,value += amt−tax |
| debt_payment | −amt | loan += principal | interest → "Loan interest" expense |

Liabilities are negative balances. Card payment = transfer bank → card (never expense).

## Key formulas
- Redemption: `costRemoved = round(invested × amount / currentValue)`; `realised = amount − costRemoved − fee`.
  Example 40,000 / 50,000 / redeem 20,000 / fee 100 → cost 16,000, gain 3,900, cash 19,900.
- Current value = latest valuation + value effects of flows dated after it.
- Cashflow excludes transfer, invest, redeem, principal, adjustment. Interest is an expense.
- XIRR: invest −(amt+fee), redeem +(amt−fee−tax), payout +(amt−tax), terminal +value; null if < 90 days.
- Two-level split: classes (sum 10000) then assets within class (sum 10000), largest remainder at each level.
- SIP: step-up `round(amount × (1+p)^floor(months/every))`; carry-forward adds previous shortfall;
  missed after due + graceDays; done if actual ≥ planned else partial.
- Drift = weight − target; full trade = target×V − value; cashflow plan allocates S by deficits.
- EMI = P·r·(1+r)^n / ((1+r)^n − 1), r = annual/12.
- Opportunity rules are cumulative % of fund balance at cycle start; new high resets the cycle.

## Before finishing any finance change
- [ ] Unit tests include the worked example from docs/04 for the rule touched.
- [ ] An integration test posts → voids → recomputes and asserts caches return to the start.
- [ ] Amounts recomputed on the server; client totals ignored.
- [ ] No `Number` division result stored without rounding.
