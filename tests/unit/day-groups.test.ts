import { describe, expect, it } from "vitest";
import { cashflowSigned, groupByDay } from "@/lib/day-groups";

type Row = {
  id: string;
  date: string;
  type: string;
  status: string;
  amountMinor: number;
  currency: string;
};

const row = (
  id: string,
  date: string,
  type: string,
  amountMinor: number,
  extra: Partial<Row> = {},
): Row => ({
  id,
  date,
  type,
  status: "posted",
  amountMinor,
  currency: "LKR",
  ...extra,
});

describe("groupByDay", () => {
  it("groups consecutive and scattered rows by day, keeping the ledger order", () => {
    const rows = [
      row("a", "2026-10-28", "expense", 1_000),
      row("b", "2026-10-28", "income", 5_000),
      row("c", "2026-10-27", "expense", 300),
    ];
    const groups = groupByDay(
      rows,
      (r) => r.date,
      (r) => cashflowSigned(r, "LKR"),
    );
    expect(groups.map((g) => [g.day, g.rows.map((r) => r.id), g.totalMinor, g.partial])).toEqual([
      ["2026-10-28", ["a", "b"], 4_000, false],
      ["2026-10-27", ["c"], -300, false],
    ]);
  });

  it("transfers, investments and voids count as zero; another currency marks the day partial", () => {
    const rows = [
      row("t", "2026-10-28", "transfer", 30_000),
      row("i", "2026-10-28", "invest", 10_000),
      row("v", "2026-10-28", "expense", 999, { status: "void" }),
      row("u", "2026-10-28", "expense", 4_500, { currency: "USD" }),
      row("e", "2026-10-28", "expense", 1_200),
    ];
    const [g] = groupByDay(
      rows,
      (r) => r.date,
      (r) => cashflowSigned(r, "LKR"),
    );
    expect(g.totalMinor).toBe(-1_200);
    expect(g.partial).toBe(true);
    expect(Number.isInteger(g.totalMinor)).toBe(true);
  });

  it("returns no groups for no rows", () => {
    expect(
      groupByDay(
        [],
        () => "",
        () => 0,
      ),
    ).toEqual([]);
  });
});
