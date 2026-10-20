import { describe, expect, it } from "vitest";
import {
  bankRowKeys,
  guessMapping,
  normalizeBankRows,
  parseBankAmount,
  parseBankDate,
  type BankMapping,
} from "@/domain/bank-import";

describe("parseBankDate", () => {
  it("parses each format and rejects impossible dates", () => {
    expect(parseBankDate("2026-01-31", "yyyy-MM-dd")).toBe("2026-01-31");
    expect(parseBankDate("31/01/2026", "dd/MM/yyyy")).toBe("2026-01-31");
    expect(parseBankDate("01/31/2026", "MM/dd/yyyy")).toBe("2026-01-31");
    expect(parseBankDate("31.01.2026", "dd.MM.yyyy")).toBe("2026-01-31");
    expect(parseBankDate("31-Jan-2026", "dd-MMM-yyyy")).toBe("2026-01-31");
    expect(parseBankDate("5 March 2026", "dd MMM yyyy")).toBe("2026-03-05");
    expect(parseBankDate("2026-01-31 14:05", "yyyy-MM-dd")).toBe("2026-01-31");
    expect(parseBankDate("31/02/2026", "dd/MM/yyyy")).toBeNull();
    expect(parseBankDate("2026-01-31", "dd/MM/yyyy")).toBeNull();
  });
});

describe("parseBankAmount", () => {
  it("handles separators, currency, parentheses, trailing minus and DR/CR", () => {
    expect(parseBankAmount("1,234.50", "LKR")).toBe(123_450);
    expect(parseBankAmount("-1,234.50", "LKR")).toBe(-123_450);
    expect(parseBankAmount("LKR 2,000.00", "LKR")).toBe(200_000);
    expect(parseBankAmount("Rs. 10.00", "LKR")).toBe(1_000);
    expect(parseBankAmount("$5", "USD")).toBe(500);
    expect(parseBankAmount("(500.00)", "LKR")).toBe(-50_000);
    expect(parseBankAmount("500.00-", "LKR")).toBe(-50_000);
    expect(parseBankAmount("500.00 DR", "LKR")).toBe(-50_000);
    expect(parseBankAmount("500.00 CR", "LKR")).toBe(50_000);
    expect(parseBankAmount("", "LKR")).toBeNull();
    expect(() => parseBankAmount("abc", "LKR")).toThrow();
  });
});

const signed: BankMapping = {
  hasHeader: true,
  dateColumn: 0,
  dateFormat: "dd/MM/yyyy",
  descriptionColumn: 1,
  counterpartyColumn: null,
  amountMode: "signed",
  amountColumn: 2,
  debitColumn: null,
  creditColumn: null,
  negate: false,
};

describe("guessMapping", () => {
  it("finds debit/credit columns and the date format", () => {
    const m = guessMapping(
      ["Txn Date", "Narration", "Withdrawal", "Deposit", "Balance"],
      [
        ["02/01/2026", "Shop", "1,500.00", "", "10,000.00"],
        ["25/01/2026", "Salary", "", "100,000.00", "110,000.00"],
      ],
    );
    expect(m).toMatchObject({
      dateColumn: 0,
      dateFormat: "dd/MM/yyyy",
      descriptionColumn: 1,
      amountMode: "debit_credit",
      debitColumn: 2,
      creditColumn: 3,
    });
  });

  it("a single Amount column is signed", () => {
    const m = guessMapping(["Date", "Description", "Amount"], [["2026-01-02", "x", "-1"]]);
    expect(m).toMatchObject({ amountMode: "signed", amountColumn: 2, dateFormat: "yyyy-MM-dd" });
  });
});

describe("normalizeBankRows", () => {
  it("signed amounts, negate, debit/credit; errors per line; zero is an error", () => {
    const table = [
      ["Date", "Desc", "Amount"],
      ["02/01/2026", "  Shop   A ", "-1,500.00"],
      ["25/01/2026", "Salary", "100000"],
      ["bad", "x", "1"],
      ["26/01/2026", "Nothing", "0"],
    ];
    const { rows, errors } = normalizeBankRows(table, signed, "LKR");
    expect(rows).toEqual([
      {
        line: 2,
        date: "2026-01-02",
        amountMinor: -150_000,
        description: "Shop A",
        counterparty: null,
      },
      {
        line: 3,
        date: "2026-01-25",
        amountMinor: 10_000_000,
        description: "Salary",
        counterparty: null,
      },
    ]);
    expect(errors.map((e) => e.line)).toEqual([4, 5]);
    expect(normalizeBankRows(table, { ...signed, negate: true }, "LKR").rows[0]!.amountMinor).toBe(
      150_000,
    );
    const dc = normalizeBankRows(
      [
        ["d", "x", "dr", "cr"],
        ["02/01/2026", "Shop", "1,500.00", ""],
        ["03/01/2026", "Pay", "", "200.00"],
      ],
      {
        ...signed,
        amountMode: "debit_credit",
        amountColumn: null,
        debitColumn: 2,
        creditColumn: 3,
      },
      "LKR",
    );
    expect(dc.rows.map((r) => r.amountMinor)).toEqual([-150_000, 20_000]);
  });
});

describe("bankRowKeys", () => {
  it("numbers identical rows so both import, and is stable across runs", () => {
    const r = {
      line: 2,
      date: "2026-01-02",
      amountMinor: -100,
      description: "Coffee",
      counterparty: null,
    };
    const keys = bankRowKeys("acc", [
      r,
      { ...r, line: 3, description: "COFFEE " },
      { ...r, amountMinor: -200 },
    ]);
    expect(keys).toEqual([
      "acc|2026-01-02|-100|coffee|0",
      "acc|2026-01-02|-100|coffee|1",
      "acc|2026-01-02|-200|coffee|0",
    ]);
    expect(bankRowKeys("acc", [r])).toEqual([keys[0]]);
  });
});
