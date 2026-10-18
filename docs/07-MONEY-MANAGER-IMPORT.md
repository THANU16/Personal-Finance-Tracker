# 07 — Money Manager Import (spec + Claude Code prompt)

Imports the Excel exports of the Money Manager app (2025 and 2026 sheets) into WealthTrack. Built from an analysis of the real
2025 file (1,035 rows). Nothing is written until the final confirm step; everything is written in ONE DB transaction.

## 1. Source format (observed)
Columns: `Period` (datetime) · `Accounts` · `Category` · `Subcategory` · `Note` · `LKR` · `Income/Expense` · `Description` ·
`Amount` · `Currency` · `Accounts` (duplicate of Amount; ignore). Row types in `Income/Expense`:
`Exp.`, `Income`, `Transfer-Out`, `Transfer-In`.
- Account and category names carry trailing spaces ("Cash In Hand " vs "Cash In Hand") → trim; merge case/space variants.
- Category names may start with an emoji ("🍜 Food") → emoji goes to `category.icon`, name stays plain text.
- Transfer rows: `Accounts` = this side, `Category` = the other account. Out and In rows share the same `Period` and `Amount`.
- Fees are separate `Exp.` rows: `Note = "Fees"`, category "Other", `Description = "<source> → <destination>"`, same `Period`
  (to the second) as the transfer-out from the same account.
- "Difference" (`Note = "Difference"`) rows are Money Manager balance corrections (any category; one is "Salary", one "Entertainment").
- Balances start at 0 on the first date (no opening rows). Files may overlap or start mid-year.

## 2. Pipeline after upload (server, no DB writes to the ledger yet)
1. **Parse** every uploaded .xlsx (use a maintained reader such as ExcelJS; check current security advisories, avoid the
   unmaintained npm `xlsx`). Validate the header; reject unknown files with a clear message. Max size 10 MB per file.
2. **Normalise** each row: trimmed names, emoji split, `Amount` → minor units (string-based parsing, never float), `Period` → UTC
   instant + business date (user tz), stable `rowIndex`. Non-LKR currency rows are flagged (blocked until FX exists).
3. **Merge files** in time order (ties: file order). Detect overlap between files and exact duplicate rows; duplicates inside the same
   file are kept (use occurrence index in the hash), duplicates across files are dropped with a warning.
4. **Pair transfers**: match Transfer-Out with Transfer-In on (Period, Amount, out.Account = in.Category, out.Category = in.Account).
   Unpaired halves are listed as problems.
5. **Attach fees**: for each fee row find transfer-outs from the same account at the same Period; if several, pick the one whose
   destination matches the fee's `Description` (fuzzy: "Give to frds" ≈ "Give to Others"); if still ambiguous or none, keep the fee as a
   standalone expense in the system category "Bank fees". Matched fees set `feeMinor` on the transfer.
6. **Classify "Difference" rows** as `adjustment` (for account targets) or `valuation/opening` (for holding targets) — decided after
   mapping, shown in the review step.
7. **Suggest mappings** (see §3 heuristics) and store a draft batch (`importBatches` status `draft`, plus `importRows` staging with
   kind and hash). The wizard works on the saved draft so the user can leave and return.

## 3. Mapping interface (wizard)
Progress bar: 1 Upload · 2 Accounts · 3 Expense categories · 4 Income categories · 5 Review special rows · 6 Opening balances ·
7 Preview · 8 Import. Back is always available; Next is disabled until every item on the step is resolved.

### Step 2 — Accounts (table; one row per distinct trimmed account)
Columns: Money Manager account · rows · in/out totals · first–last date · **Treat as** · **Target** · status.
- **Treat as**: `Account`, `Holding`, or `Ignore`.
- **Target** (depends on Treat as): existing account | **Create new account** (name, type bank/cash/wallet/credit_card/loan/
  broker_cash/opportunity_fund/receivable/payable, currency) | existing holding | **Create new holding** (name, asset class,
  instrument type, liquidity) | **Merge into** another Money Manager account in this list.
- Heuristic defaults (editable): exact name match → that account; names containing "Give to"/"From" → receivable/payable;
  names with Fixed/Money Market/CDS/Equity/Binance/Fund → Holding with suggested class (Fixed income, Equity, Crypto);
  "Cash" → cash; "Bank" → bank; everything else → new bank/wallet account.
- Row expands to show 5 sample transactions. Bulk actions: "Create all unmatched as new", "Apply suggestions".
- Warnings: mapping to an FD-type holding when that account has "Difference" rows (valuations are not allowed on FDs: choose another
  instrument type); two accounts merged with different currencies; a transfer whose two sides end up on the same target.

### Steps 3 and 4 — Categories (separate screens for expense and income)
Tree table: Money Manager category (with subcategories as children) · rows · total · **Action** · **Target**.
- Actions: **Map to existing** (category picker, parent or subcategory), **Create new** (name, parent, essential flag for expense),
  **Merge into** another Money Manager category, **Uncategorised**.
- Defaults: case-insensitive name match; emoji stripped for matching and stored as icon; suggested merges for duplicates such as
  "Petrol" ≈ "Bike → Petrol", "Saloon" ≈ "Beauty → Saloon", "Abi" ≈ "Apparel → Abi" (shown as hints, never automatic).
- Income and expense are separate namespaces ("Family" exists in both).
- Rows of type fee/Difference/transfer are excluded from category counts (they are handled in step 5).

### Step 5 — Review special rows
Three collapsible panels with counts and a table each: **Transfers** (pairs found, unpaired list with manual pairing), **Fees**
(attached to transfer / standalone, with a dropdown to change), **Difference rows** (proposed handling per row; bulk "treat all as
adjustments"). Plus **Problem rows** (zero amount, bad date, non-LKR, future dates) with Fix/Skip.

### Step 6 — Opening balances
Per target account: opening date (default = first transaction date of that account, start of day) and opening balance (default 0
because Money Manager started from zero; editable if the user wants real balances). Holdings: opening invested 0 (the first
Difference-income on a holding is treated as its opening value).

### Step 7 — Preview (dry run, nothing saved)
- What will be created: new accounts, categories, holdings; transactions by type; adjustments/valuations; skipped rows.
- **Verification table**: for each account, the balance WealthTrack will have after import vs Money Manager's own running balance
  (sum of signed rows + opening); any difference is red. Monthly income and expense totals per year, matching the sheet.
- Confirm checkbox: "I reviewed the mapping".

### Step 8 — Import
One DB transaction; progress and result screen (counts, links, "Undo this import").

## 4. Posting rules (all through the ledger engine, chronological order so same-day entry order is preserved)
| Money Manager row(s) | Target types | WealthTrack result |
|---|---|---|
| Exp. | account | `expense` (category/subcategory mapped; Note → description; Description → notes) |
| Income | account | `income` |
| Transfer pair | account → account | `transfer` (+`feeMinor` when a fee row was attached) |
| Transfer pair | account → holding | `invest` from the account (fee → invest fee) |
| Transfer pair | holding → account | `redeem` into the account (amount ≥ holding value → full redemption) |
| Transfer pair | holding → holding | `redeem` + `invest` sharing a groupId |
| Standalone fee row | account | `expense` in system category "Bank fees" |
| Difference (Income / Exp.) | account | `adjustment` (to / from account), category "Balance adjustment", `source.kind = import` |
| Difference | holding | `valuation` with value = holding balance after the row; if the holding value is 0, an `opening_balance` (invested = value) instead |
| Receivable/payable accounts | | ordinary accounts; liabilities stored negative |
- Signed running balance of an account = opening + Income + Transfer-In − Exp. − Transfer-Out (this must equal WealthTrack's balance).
- Imports bypass the earmark dip guard (historical data). A row dated before an account's opening date is impossible because the
  opening date defaults to the account's first row.
- `importHash = sha1(source | period | account | category | subcategory | type | amount | note | occurrenceIndex)`; transfer pairs hash both
  sides. Re-importing the same file adds 0 rows. Cross-file duplicates are dropped.
- Undo batch: void every transaction of the batch (and remove its valuations/openings), recompute caches. Created accounts/holdings/
  categories remain unless unused (offer "delete unused items created by this import").
- Saved mappings (`importMappings`: source, kind, sourceKey → target) are reused for the next file.

## 5. Data model additions (docs/03)
- `importBatches`: add `source: money_manager|bank_csv`, `files: [{name, rows, from, to}]`, `status: draft|previewed|imported|reverted`,
  `summary`, `createdItems: {accountIds, categoryIds, holdingIds}`.
- `importRows` (staging): `batchId, rowIndex, kind (expense|income|transfer|fee|difference|problem), normalized, hash, resolved`.
- `importMappings`: `source, kind: account|expense_category|income_category, sourceKey, action, targetId?, createSpec?`.
- `transactions.source.kind = import` already exists; `importHash` has the unique partial index.

## 6. Acceptance for the 2025 file alone
- 1,035 rows parsed; 13 accounts after trimming ("Cash In Hand" variants merged); 289 transfer pairs, 0 unpaired.
- 28 fee rows: 27 attached to transfers, 1 standalone "Bank fees" expense.
- 17 Difference rows classified (10 expense-side, 7 income-side); 385 real expenses and 27 real incomes.
- Ledger transactions created: 385 + 27 + 289 + 1 = 702, plus 17 difference-derived entries.
- Per-account balances equal Money Manager's running totals; monthly income/expense totals equal the sheet (excluding transfers).
- Re-import adds 0 rows; undo restores the empty state; `recompute-all` is idempotent afterwards.

## 7. Claude Code prompt (run after Phase 4, as its own task)
```
Money Manager import. Read CLAUDE.md, docs/PROGRESS.md, docs/03 (importBatches, transactions), docs/04 §1, §3, §4, §18 and
docs/07-MONEY-MANAGER-IMPORT.md. Use the finance-domain, new-module and ui-conventions skills. Check current docs for the Excel
reader and Next.js upload handling before coding. Plan first and wait for my approval.
1. Domain (pure, unit tested, in src/domain/money-manager.ts): normaliseRow, splitEmoji, pairTransfers, attachFees (with description
   matching), classifyRows, signedBalances, buildPostingPlan(mapping, rows) producing ordered ledger operations, importHash.
   Tests use the observed cases: trailing spaces, emoji categories, 289-pair data shape, a fee with 2 candidate transfers resolved by
   description, a fee with none, Difference on account vs holding, opening-value Difference on an empty holding.
2. Module imports (extend): importBatches/importRows/importMappings models, services (createDraft, saveMapping, preview, commit,
   undo), upload route handler /api/import/money-manager (auth, size/type validation, multi-file).
3. Wizard UI per docs/07 §3: steps 1-8 with the account, expense-category and income-category mapping tables, special-rows review,
   opening balances, preview with the balance-verification table, and result screen with Undo. Entry buttons in Transactions →
   Import and Settings → Data.
4. Commit runs in ONE withTransaction, posts through the ledger engine in chronological order, bypasses the dip guard for
   source.kind = import, creates accounts/categories/holdings declared in the mapping first.
5. Tests: integration against a small anonymised fixture mirroring the 2025 structure; re-import adds 0; undo; atomic failure leaves
   nothing; balances match signed running totals. E2E: upload fixture, map (existing + create new), preview, import.
Acceptance: docs/07 §6 on the fixture; npm run verify green; update docs/PROGRESS.md and docs/03; commit "feat: money manager import".
```
