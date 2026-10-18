import { describe, expect, it } from "vitest";
import {
  attachFees,
  buildPostingPlan,
  categoryTree,
  classifyRows,
  feeDestination,
  mergeFiles,
  mergeHints,
  mmBalancesByTarget,
  normaliseRows,
  pairTransfers,
  parseAmountMinor,
  resolveAccount,
  resolveCategory,
  signedBalances,
  similarity,
  splitEmoji,
  suggestAccount,
  summariseAccounts,
  type ImportMapping,
  type RawRow,
} from "@/domain/money-manager";

const OPTS = { todayKey: "2026-10-18", baseCurrency: "LKR" };
let n = 0;
const raw = (
  p: Partial<RawRow> & Pick<RawRow, "type" | "account" | "amountText">,
  at = "2025-01-05T10:00:00",
): RawRow => ({
  file: 0,
  rowIndex: ++n,
  period: new Date(`${at}Z`),
  category: "",
  subcategory: "",
  note: "",
  description: "",
  currency: "LKR",
  ...p,
});
const rows = (list: RawRow[]) => normaliseRows(list, OPTS);

describe("normalise", () => {
  it("trims and merges case/space variants of names", () => {
    const r = rows([
      raw({ type: "Exp.", account: "Cash In Hand ", amountText: "100" }),
      raw({ type: "Exp.", account: "cash  in hand", amountText: "200" }),
    ]);
    expect(r.map((x) => x.accountKey)).toEqual(["cash in hand", "cash in hand"]);
    expect(summariseAccounts(r)).toHaveLength(1);
  });

  it("splits a leading emoji into the icon", () => {
    expect(splitEmoji("🍜 Food")).toEqual({ icon: "🍜", name: "Food" });
    expect(splitEmoji("👨‍👩‍👧 Family ")).toEqual({ icon: "👨‍👩‍👧", name: "Family" });
    expect(splitEmoji("Food")).toEqual({ icon: null, name: "Food" });
    expect(splitEmoji("🍜")).toEqual({ icon: null, name: "🍜" });
  });

  it("parses amounts from decimal strings, never floats", () => {
    expect(parseAmountMinor("1234.5", "LKR")).toBe(123_450);
    expect(parseAmountMinor("1,234.50", "LKR")).toBe(123_450);
    expect(parseAmountMinor("1234.4999999999998", "LKR")).toBe(123_450);
    expect(parseAmountMinor("0.005", "LKR")).toBe(1);
    expect(parseAmountMinor("1500", "JPY")).toBe(1_500);
    expect(parseAmountMinor("abc", "LKR")).toBeNull();
  });

  it("flags problems: zero amount, bad date, unknown type, future date", () => {
    const r = rows([
      raw({ type: "Exp.", account: "A", amountText: "0" }),
      raw({ type: "Exp.", account: "A", amountText: "10", period: "not a date" }),
      raw({ type: "Refund", account: "A", amountText: "10" }),
      raw({ type: "Exp.", account: "A", amountText: "10" }, "2027-01-01T00:00:00"),
    ]);
    expect(r.map((x) => x.problems)).toEqual([
      ["Zero amount"],
      ["Unreadable date"],
      ['Unknown row type "Refund"'],
      ["Dated in the future"],
    ]);
  });

  it("flags rows in another currency (blocked until FX)", () => {
    const r = rows([
      raw({ type: "Exp.", account: "A", amountText: "10", currency: "USD" }),
      raw({ type: "Exp.", account: "A", amountText: "10", currency: "XYZ" }),
      raw({ type: "Exp.", account: "A", amountText: "10", currency: "lkr" }),
    ]);
    expect(r[0]!.problems[0]).toMatch(/^In USD, not LKR/);
    expect(r[1]!.problems).toHaveLength(1);
    expect(r[2]!.problems).toEqual([]);
  });

  it("keeps identical rows within a file distinct (occurrence index) and drops cross-file duplicates", () => {
    const a = rows([
      raw({ type: "Exp.", account: "A", amountText: "10" }),
      raw({ type: "Exp.", account: "A", amountText: "10" }),
    ]);
    expect(new Set(a.map((x) => x.hash)).size).toBe(2);
    const b = normaliseRows(
      [{ ...raw({ type: "Exp.", account: "A", amountText: "10" }), file: 1 }],
      OPTS,
    );
    const merged = mergeFiles([a, b]);
    expect(merged.rows).toHaveLength(2);
    expect(merged.duplicates).toHaveLength(1);
  });

  it("orders newest-first exports chronologically, keeping same-second entry order", () => {
    const file = rows([
      raw({ type: "Exp.", account: "A", amountText: "3", note: "third" }, "2025-01-06T09:00:00"),
      raw({ type: "Exp.", account: "A", amountText: "2", note: "second" }, "2025-01-05T09:00:00"),
      raw({ type: "Exp.", account: "A", amountText: "1", note: "first" }, "2025-01-05T09:00:00"),
    ]);
    expect(mergeFiles([file]).rows.map((r) => r.note)).toEqual(["first", "second", "third"]);
  });
});

/** A transfer pair as Money Manager exports it. */
const transfer = (from: string, to: string, amount: string, at: string) => [
  raw({ type: "Transfer-Out", account: from, category: to, amountText: amount }, at),
  raw({ type: "Transfer-In", account: to, category: from, amountText: amount }, at),
];
const fee = (account: string, amount: string, at: string, description: string) =>
  raw(
    { type: "Exp.", account, category: "Other", note: "Fees", amountText: amount, description },
    at,
  );

describe("transfers and fees", () => {
  it("pairs out/in on time, amount and the two account names", () => {
    const list = rows([
      ...transfer("Bank", "Cash In Hand ", "500", "2025-02-01T08:00:00"),
      ...transfer("Bank", "Wallet", "500", "2025-02-01T08:00:00"),
    ]);
    const { pairs, unpaired } = pairTransfers(list);
    expect(pairs).toHaveLength(2);
    expect(unpaired).toEqual([]);
    expect(pairs.map((p) => p.in.accountKey).sort()).toEqual(["cash in hand", "wallet"]);
  });

  it("pairs a 289-transfer data shape with nothing left over", () => {
    const list: RawRow[] = [];
    for (let i = 0; i < 289; i++) {
      const at = `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00`;
      list.push(
        ...transfer(
          i % 2 ? "Bank" : "Cash",
          i % 3 ? "Wallet" : "Give to Others",
          String(100 + i),
          at,
        ),
      );
    }
    const { pairs, unpaired } = pairTransfers(rows(list));
    expect(pairs).toHaveLength(289);
    expect(unpaired).toHaveLength(0);
  });

  it("an unpaired half is a problem", () => {
    const c = classifyRows(
      rows([raw({ type: "Transfer-Out", account: "Bank", category: "Wallet", amountText: "50" })]),
    );
    expect(c.problems.map((p) => p.reason)).toEqual(["Transfer without its other half"]);
  });

  it("a fee with 2 candidate transfers is resolved by its description", () => {
    const at = "2025-03-01T12:00:00";
    const list = rows([
      ...transfer("Bank", "Give to Others", "1000", at),
      ...transfer("Bank", "Wallet", "1000", at),
      fee("Bank", "25", at, "Bank → Give to frds"),
    ]);
    const { pairs } = pairTransfers(list);
    const { attached, standalone } = attachFees(
      pairs,
      list.filter((r) => r.note === "Fees"),
    );
    expect(standalone).toEqual([]);
    expect(attached).toHaveLength(1);
    expect(attached[0]!.in.accountKey).toBe("give to others");
    expect(similarity(feeDestination("Bank → Give to frds"), "Give to Others")).toBeGreaterThan(0);
  });

  it("a fee with no matching transfer is a standalone Bank fees expense", () => {
    const c = classifyRows(rows([fee("Bank", "10", "2025-03-02T10:00:00", "Bank → Nowhere")]));
    expect(c.standaloneFees).toHaveLength(1);
  });

  it("a tie between candidates stays standalone (ambiguous)", () => {
    const at = "2025-03-03T12:00:00";
    const list = rows([
      ...transfer("Bank", "Alpha", "1", at),
      ...transfer("Bank", "Beta", "1", at),
      fee("Bank", "5", at, "Bank → Gamma"),
    ]);
    const c = classifyRows(list);
    expect(c.ambiguousFees).toHaveLength(1);
    expect(c.pairs.every((p) => !p.fee)).toBe(true);
  });
});

describe("classify and balances", () => {
  const list = rows([
    raw(
      { type: "Income", account: "Bank", category: "💰 Salary", amountText: "300000" },
      "2025-01-25T09:00:00",
    ),
    raw(
      {
        type: "Exp.",
        account: "Bank",
        category: "🍜 Food",
        subcategory: "Lunch",
        amountText: "1200",
      },
      "2025-01-26T13:00:00",
    ),
    raw(
      {
        type: "Exp.",
        account: "Bank",
        category: "Entertainment",
        note: "Difference",
        amountText: "300",
      },
      "2025-01-27T13:00:00",
    ),
    raw(
      { type: "Income", account: "Bank", category: "Salary", note: "Difference", amountText: "50" },
      "2025-01-28T13:00:00",
    ),
    ...transfer("Bank", "Cash", "2000", "2025-01-29T10:00:00"),
    fee("Bank", "25", "2025-01-29T10:00:00", "Bank → Cash"),
  ]);
  const c = classifyRows(list);

  it("splits rows into real expenses/incomes, transfers, fees and Difference rows", () => {
    expect([
      c.expenses.length,
      c.incomes.length,
      c.pairs.length,
      c.differences.length,
      c.standaloneFees.length,
    ]).toEqual([1, 1, 1, 2, 0]);
    expect(c.pairs[0]!.fee?.amountMinor).toBe(2_500);
  });

  it("signed running balances: Income + Transfer-In − Exp. − Transfer-Out", () => {
    expect(Object.fromEntries(signedBalances(list))).toEqual({
      bank: 300_000_00 - 1_200_00 - 300_00 + 50_00 - 2_000_00 - 25_00,
      cash: 2_000_00,
    });
  });

  it("category tree with subcategories; merge hints", () => {
    const tree = categoryTree(c.expenses);
    expect(tree.map((t) => [t.key, t.parentKey, t.icon])).toEqual([
      ["food", null, "🍜"],
      ["food>lunch", "food", null],
    ]);
    expect(
      mergeHints([
        ...tree,
        { key: "lunch", name: "Lunch", icon: null, parentKey: null, rows: 1, totalMinor: 1 },
      ]),
    ).toEqual([{ from: "lunch", to: "food>lunch" }]);
  });
});

describe("mapping resolution and suggestions", () => {
  const mapping: ImportMapping = {
    accounts: {
      "cash in hand": { treatAs: "merge", into: "cash" },
      cash: { treatAs: "account", ref: "acc:cash" },
      loop1: { treatAs: "merge", into: "loop2" },
      loop2: { treatAs: "merge", into: "loop1" },
      gone: { treatAs: "ignore" },
    },
    expenseCategories: {
      food: { ref: "cat:food" },
      "food>lunch": { merge: "food" },
      misc: { uncategorised: true },
    },
    incomeCategories: {},
  };
  it("follows merges; guards cycles; ignore → null", () => {
    expect(resolveAccount(mapping, "cash in hand")).toEqual({ kind: "account", ref: "acc:cash" });
    expect(resolveAccount(mapping, "loop1")).toBeNull();
    expect(resolveAccount(mapping, "gone")).toBeNull();
    expect(
      resolveCategory(mapping.expenseCategories, { categoryKey: "food", subcategoryKey: "lunch" }),
    ).toBe("cat:food");
    expect(
      resolveCategory(mapping.expenseCategories, { categoryKey: "misc", subcategoryKey: "" }),
    ).toBe("uncategorised");
  });

  it("suggests targets from names", () => {
    expect(suggestAccount("Give to Others")).toEqual({ treatAs: "account", type: "receivable" });
    expect(suggestAccount("From Amma")).toEqual({ treatAs: "account", type: "payable" });
    expect(suggestAccount("CAL Money Market")).toMatchObject({
      treatAs: "holding",
      assetClass: "Fixed Income",
      instrument: "money_market",
    });
    expect(suggestAccount("Binance")).toMatchObject({ treatAs: "holding", assetClass: "Crypto" });
    expect(suggestAccount("Sampath FD")).toMatchObject({
      assetClass: "Fixed Income",
      instrument: "fd",
    });
    expect(suggestAccount("NSB Fixed Deposit")).toMatchObject({ instrument: "fd" });
    expect(suggestAccount("CDS Account")).toMatchObject({
      treatAs: "holding",
      assetClass: "Equity",
    });
    expect(suggestAccount("Cash In Hand")).toEqual({ treatAs: "account", type: "cash" });
    expect(suggestAccount("Sampath Bank")).toEqual({ treatAs: "account", type: "bank" });
    expect(suggestAccount("eZ Cash")).toEqual({ treatAs: "account", type: "cash" });
    expect(suggestAccount("Genie")).toEqual({ treatAs: "account", type: "wallet" });
  });
});

describe("buildPostingPlan (docs/07 §4)", () => {
  const list = rows([
    raw(
      { type: "Income", account: "Bank", category: "Salary", amountText: "100000" },
      "2025-01-01T09:00:00",
    ),
    raw(
      {
        type: "Exp.",
        account: "Bank",
        category: "Food",
        amountText: "1000",
        note: "Lunch",
        description: "With team",
      },
      "2025-01-02T09:00:00",
    ),
    ...transfer("Bank", "Cash", "5000", "2025-01-03T09:00:00"),
    fee("Bank", "50", "2025-01-03T09:00:00", "Bank → Cash"),
    ...transfer("Bank", "Money Market", "20000", "2025-01-04T09:00:00"),
    raw(
      {
        type: "Income",
        account: "Money Market",
        category: "Interest",
        note: "Difference",
        amountText: "500",
      },
      "2025-01-20T09:00:00",
    ),
    ...transfer("Money Market", "Bank", "25000", "2025-01-25T09:00:00"),
    raw(
      {
        type: "Income",
        account: "Binance",
        category: "Other",
        note: "Difference",
        amountText: "800",
      },
      "2025-01-26T09:00:00",
    ),
    ...transfer("Binance", "Money Market", "300", "2025-01-27T09:00:00"),
    raw(
      { type: "Exp.", account: "Bank", category: "Other", note: "Difference", amountText: "100" },
      "2025-01-28T09:00:00",
    ),
    raw(
      { type: "Exp.", account: "Old Wallet", category: "Food", amountText: "99" },
      "2025-01-29T09:00:00",
    ),
  ]);
  const c = classifyRows(list);
  const mapping: ImportMapping = {
    accounts: {
      bank: { treatAs: "account", ref: "bank" },
      cash: { treatAs: "account", ref: "cash" },
      "money market": { treatAs: "holding", ref: "mm" },
      binance: { treatAs: "holding", ref: "btc" },
      "old wallet": { treatAs: "ignore" },
    },
    expenseCategories: { food: { ref: "food" } },
    incomeCategories: { salary: { ref: "salary" } },
  };
  const plan = buildPostingPlan(c, mapping);

  it("produces ordered operations per the posting table", () => {
    expect(plan.ops.map((o) => o.op)).toEqual([
      "income",
      "expense",
      "transfer",
      "invest",
      "valuation", // Difference on a holding → value = running balance
      "valuation", // redeem 25,000 > modelled 20,500 → value set to 25,000 first
      "redeem",
      "opening", // first Difference on an empty holding → opening + valuation
      "valuation",
      "redeem", // holding → holding: redeem + invest in one group
      "invest",
      "adjustment",
    ]);
    const t = plan.ops.find((o) => o.op === "transfer")!;
    expect(t).toMatchObject({ from: "bank", to: "cash", amountMinor: 5_000_00, feeMinor: 50_00 });
    const e = plan.ops.find((o) => o.op === "expense")!;
    expect(e).toMatchObject({ description: "Lunch", notes: "With team", category: "food" });
    const v = plan.ops.filter((o) => o.op === "valuation");
    expect(
      v.map((o) => (o.op === "valuation" ? [o.holding, o.valueMinor, o.reason] : null)),
    ).toEqual([
      ["mm", 20_500_00, "difference"],
      ["mm", 25_000_00, "before_redeem"],
      ["btc", 800_00, "difference"],
    ]);
    const group = plan.ops.filter((o) => (o.op === "redeem" || o.op === "invest") && o.group);
    expect(new Set(group.map((o) => ("group" in o ? o.group : null))).size).toBe(1);
  });

  it("account balances equal Money Manager's signed running totals", () => {
    const mm = mmBalancesByTarget(list, mapping);
    expect(plan.accountBalances.get("bank")).toBe(mm.get("bank"));
    expect(plan.accountBalances.get("cash")).toBe(mm.get("cash"));
    expect(plan.holdingValues.get("mm")).toBe(300_00); // 20,000 + 500, valued to 25,000, redeemed, +300
  });

  it("skips ignored accounts and unmapped categories with a reason", () => {
    expect(plan.skipped.map((s) => s.reason)).toEqual(["Ignored account"]);
    const p2 = buildPostingPlan(c, { ...mapping, expenseCategories: {} });
    expect(p2.skipped.some((s) => s.reason === "Category not mapped")).toBe(true);
  });

  it("a transfer between merged accounts vanishes but its fee is still an expense; openings add up", () => {
    const m2 = {
      ...mapping,
      accounts: { ...mapping.accounts, cash: { treatAs: "merge" as const, into: "bank" } },
    };
    const merged = buildPostingPlan(c, m2, { bank: 1_000 });
    expect(merged.skipped.some((s) => s.reason === "Both sides map to the same place")).toBe(true);
    expect(merged.ops.some((o) => o.op === "expense" && o.category === "system:bank_fees")).toBe(
      true,
    );
    // equal to Money Manager's running total (opening + all rows of both merged accounts)
    expect(merged.accountBalances.get("bank")).toBe(
      mmBalancesByTarget(list, m2, { bank: 1_000 }).get("bank"),
    );
  });
});

describe("Excel date precision", () => {
  it("rounds 12:29:59.999 (Excel day-fraction error) to 12:30:00", () => {
    const [r] = normaliseRows(
      [
        raw({
          type: "Exp.",
          account: "A",
          amountText: "1",
          period: new Date("2025-01-02T12:29:59.999Z"),
        }),
      ],
      OPTS,
    );
    expect(r!.wallClock).toBe("2025-01-02T12:30:00");
  });
});
