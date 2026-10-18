import { describe, expect, it } from "vitest";
import {
  accountEffects,
  cashflowOf,
  computeBalance,
  reconcileAdjustment,
  runningBalances,
  validateSplits,
  type LedgerTxn,
} from "@/domain/ledger";

const BANK = "bank";
const CARD = "card";
const USD = "usd";
const LOAN = "loan";

const t = (over: Partial<LedgerTxn> & Pick<LedgerTxn, "type" | "amountMinor">): LedgerTxn => ({
  status: "posted",
  ...over,
});

describe("accountEffects (docs/04 §1)", () => {
  it.each<[string, LedgerTxn, { accountId: string; deltaMinor: number }[]]>([
    [
      "income → +amount to",
      t({ type: "income", amountMinor: 500, toAccountId: BANK }),
      [{ accountId: BANK, deltaMinor: 500 }],
    ],
    [
      "expense → −amount from",
      t({ type: "expense", amountMinor: 300, fromAccountId: CARD }),
      [{ accountId: CARD, deltaMinor: -300 }],
    ],
    [
      "transfer → −amount from, +amount to",
      t({ type: "transfer", amountMinor: 1_000, fromAccountId: BANK, toAccountId: CARD }),
      [
        { accountId: BANK, deltaMinor: -1_000 },
        { accountId: CARD, deltaMinor: 1_000 },
      ],
    ],
    [
      "cross-currency transfer → +toAmount",
      t({
        type: "transfer",
        amountMinor: 30_000_00,
        fromAccountId: BANK,
        toAccountId: USD,
        toAmountMinor: 100_00,
      }),
      [
        { accountId: BANK, deltaMinor: -30_000_00 },
        { accountId: USD, deltaMinor: 100_00 },
      ],
    ],
    [
      "invest → −(amount+fee)",
      t({ type: "invest", amountMinor: 1_000, feeMinor: 15, fromAccountId: BANK }),
      [{ accountId: BANK, deltaMinor: -1_015 }],
    ],
    [
      "redeem → +(amount−fee−tax)",
      t({ type: "redeem", amountMinor: 20_000, feeMinor: 100, taxMinor: 50, toAccountId: BANK }),
      [{ accountId: BANK, deltaMinor: 19_850 }],
    ],
    [
      "investment income paid → +(amount−tax)",
      t({ type: "investment_income", amountMinor: 1_000, taxMinor: 140, toAccountId: BANK }),
      [{ accountId: BANK, deltaMinor: 860 }],
    ],
    [
      "investment income reinvested → none",
      t({ type: "investment_income", amountMinor: 1_000, reinvest: true, toAccountId: BANK }),
      [],
    ],
    [
      "debt payment → −amount from, +principal to loan",
      t({
        type: "debt_payment",
        amountMinor: 50_000,
        principalMinor: 42_000,
        interestMinor: 8_000,
        fromAccountId: BANK,
        loanAccountId: LOAN,
      }),
      [
        { accountId: BANK, deltaMinor: -50_000 },
        { accountId: LOAN, deltaMinor: 42_000 },
      ],
    ],
    [
      "adjustment to → +amount",
      t({ type: "adjustment", amountMinor: 75, toAccountId: BANK }),
      [{ accountId: BANK, deltaMinor: 75 }],
    ],
    [
      "adjustment from → −amount",
      t({ type: "adjustment", amountMinor: 75, fromAccountId: BANK }),
      [{ accountId: BANK, deltaMinor: -75 }],
    ],
    ["opening_balance → none", t({ type: "opening_balance", amountMinor: 10_000 }), []],
    ["void → none", t({ type: "income", amountMinor: 500, toAccountId: BANK, status: "void" }), []],
  ])("%s", (_label, txn, expected) => {
    expect(accountEffects(txn)).toEqual(expected);
  });
});

describe("computeBalance / runningBalances", () => {
  it("card spend + card payment: card back to zero, bank pays once", () => {
    const txns = [
      t({ type: "expense", amountMinor: 12_000, fromAccountId: CARD }),
      t({ type: "expense", amountMinor: 3_000, fromAccountId: CARD }),
      t({ type: "transfer", amountMinor: 15_000, fromAccountId: BANK, toAccountId: CARD }),
    ];
    expect(computeBalance(0, txns, CARD)).toBe(0);
    expect(computeBalance(100_000, txns, BANK)).toBe(85_000);
  });

  it("ignores voided transactions", () => {
    const txns = [
      t({ type: "income", amountMinor: 1_000, toAccountId: BANK }),
      t({ type: "expense", amountMinor: 400, fromAccountId: BANK, status: "void" }),
    ];
    expect(computeBalance(0, txns, BANK)).toBe(1_000);
  });

  it("gives the balance after each transaction from the opening balance", () => {
    const txns = [
      t({ type: "income", amountMinor: 1_000, toAccountId: BANK }),
      t({ type: "expense", amountMinor: 250, fromAccountId: BANK }),
      t({ type: "transfer", amountMinor: 100, fromAccountId: USD, toAccountId: BANK }),
    ];
    expect(runningBalances(500, txns, BANK).map((r) => [r.deltaMinor, r.balanceMinor])).toEqual([
      [1_000, 1_500],
      [-250, 1_250],
      [100, 1_350],
    ]);
  });

  it("a transfer to the same account nets to zero", () => {
    expect(
      computeBalance(
        0,
        [t({ type: "transfer", amountMinor: 5, fromAccountId: BANK, toAccountId: BANK })],
        BANK,
      ),
    ).toBe(0);
  });
});

describe("reconcileAdjustment", () => {
  it.each([
    [10_000, 10_250, { direction: "to", amountMinor: 250 }],
    [10_000, 9_000, { direction: "from", amountMinor: 1_000 }],
    [-50_000, -48_000, { direction: "to", amountMinor: 2_000 }], // card owes less than recorded
    [-50_000, -51_000, { direction: "from", amountMinor: 1_000 }],
    [0, 0, null],
  ])("balance %s, real %s → %j", (balance, real, expected) => {
    expect(reconcileAdjustment(balance, real)).toEqual(expected);
  });
});

describe("validateSplits", () => {
  it.each([
    [
      1_000,
      [
        { categoryId: "a", amountMinor: 600 },
        { categoryId: "b", amountMinor: 400 },
      ],
      null,
    ],
    [
      1_000,
      [
        { categoryId: "a", amountMinor: 600 },
        { categoryId: "b", amountMinor: 399 },
      ],
      "sum_mismatch",
    ],
    [1_000, [{ categoryId: "a", amountMinor: 1_000 }], "too_few_lines"],
    [1_000, [], "too_few_lines"],
    [
      1_000,
      [
        { categoryId: "a", amountMinor: 1_000 },
        { categoryId: "b", amountMinor: 0 },
      ],
      "non_positive_line",
    ],
    [
      1_000,
      [
        { categoryId: "a", amountMinor: 1_100 },
        { categoryId: "b", amountMinor: -100 },
      ],
      "non_positive_line",
    ],
    [
      1_000,
      [
        { categoryId: "a", amountMinor: 500 },
        { categoryId: "a", amountMinor: 500 },
      ],
      "duplicate_category",
    ],
  ] as const)("%s split %j → %s", (amount, splits, expected) => {
    expect(validateSplits(amount, splits)).toBe(expected);
  });
});

describe("cashflowOf (docs/04 §4)", () => {
  it("counts income, expense (splits per category) and interest; excludes transfers etc.", () => {
    const cf = cashflowOf(
      [
        t({ type: "income", amountMinor: 300_000, toAccountId: BANK }),
        t({ type: "investment_income", amountMinor: 5_000, taxMinor: 700, toAccountId: BANK }),
        t({ type: "investment_income", amountMinor: 2_000, reinvest: true }),
        t({ type: "expense", amountMinor: 40_000, fromAccountId: CARD, categoryId: "food" }),
        t({
          type: "expense",
          amountMinor: 10_000,
          fromAccountId: BANK,
          splits: [
            { categoryId: "food", amountMinor: 6_000 },
            { categoryId: "home", amountMinor: 4_000 },
          ],
        }),
        t({
          type: "debt_payment",
          amountMinor: 50_000,
          principalMinor: 42_000,
          interestMinor: 8_000,
        }),
        t({ type: "transfer", amountMinor: 40_000, fromAccountId: BANK, toAccountId: CARD }),
        t({ type: "invest", amountMinor: 20_000, fromAccountId: BANK }),
        t({ type: "redeem", amountMinor: 9_000, toAccountId: BANK }),
        t({ type: "adjustment", amountMinor: 123, toAccountId: BANK }),
        t({ type: "opening_balance", amountMinor: 1_000_000 }),
        t({ type: "income", amountMinor: 999_999, toAccountId: BANK, status: "void" }),
      ],
      { interestCategoryId: "loan-interest" },
    );
    expect(cf.incomeMinor).toBe(300_000);
    expect(cf.investmentIncomeMinor).toBe(5_000);
    expect(cf.expenseMinor).toBe(58_000);
    expect(cf.savingsMinor).toBe(247_000);
    expect(cf.savingsRateBp).toBe(8_098); // 247,000 / 305,000 = 80.98%
    expect(Object.fromEntries(cf.expenseByCategory)).toEqual({
      food: 46_000,
      home: 4_000,
      "loan-interest": 8_000,
    });
  });

  it("card spend counts once; paying the card is not an expense", () => {
    const cf = cashflowOf([
      t({ type: "expense", amountMinor: 15_000, fromAccountId: CARD, categoryId: "x" }),
      t({ type: "transfer", amountMinor: 15_000, fromAccountId: BANK, toAccountId: CARD }),
    ]);
    expect(cf.expenseMinor).toBe(15_000);
  });

  it("savings rate is null without income", () => {
    expect(
      cashflowOf([t({ type: "expense", amountMinor: 10, categoryId: "x" })]).savingsRateBp,
    ).toBeNull();
  });
});
