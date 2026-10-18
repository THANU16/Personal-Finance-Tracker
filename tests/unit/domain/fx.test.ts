import { describe, expect, it } from "vitest";
import { buildFxTable, convertMinor, makeConverter, rateOn } from "@/domain/fx";

const table = buildFxTable([
  { date: "2026-01-01", base: "USD", quote: "LKR", rate: 300 },
  { date: "2026-02-01", base: "USD", quote: "LKR", rate: 310 },
  { date: "2026-01-15", base: "LKR", quote: "JPY", rate: 0.5 },
]);

describe("rateOn", () => {
  it("uses the latest direct rate on or before the date", () => {
    expect(rateOn(table, "USD", "LKR", "2026-01-31")).toBe(300);
    expect(rateOn(table, "USD", "LKR", "2026-02-01")).toBe(310);
    expect(rateOn(table, "USD", "LKR", "2027-06-30")).toBe(310);
  });

  it("falls back to the inverse of the opposite pair", () => {
    expect(rateOn(table, "LKR", "USD", "2026-02-10")).toBeCloseTo(1 / 310, 12);
    expect(rateOn(table, "JPY", "LKR", "2026-01-20")).toBe(2);
  });

  it("is null before the first rate and for unknown pairs — never 1:1", () => {
    expect(rateOn(table, "USD", "LKR", "2025-12-31")).toBeNull();
    expect(rateOn(table, "EUR", "LKR", "2026-03-01")).toBeNull();
  });

  it("is 1 for the same currency", () => {
    expect(rateOn(table, "LKR", "LKR", "2000-01-01")).toBe(1);
  });

  it("ignores non-positive rates", () => {
    expect(
      rateOn(
        buildFxTable([{ date: "2026-01-01", base: "A", quote: "B", rate: 0 }]),
        "A",
        "B",
        "2026-02-01",
      ),
    ).toBeNull();
  });
});

describe("convertMinor", () => {
  it("USD cents → LKR cents", () => {
    expect(convertMinor(1_050, "USD", "LKR", 300)).toBe(315_000); // $10.50 → LKR 3,150.00
  });

  it("respects currencies with different minor digits", () => {
    expect(convertMinor(1_000, "JPY", "USD", 0.0067)).toBe(670); // ¥1,000 → $6.70
    expect(convertMinor(100, "USD", "JPY", 150)).toBe(150); // $1.00 → ¥150
  });

  it("rounds half away from zero, also for negatives", () => {
    expect(convertMinor(1, "USD", "LKR", 0.5)).toBe(1);
    expect(convertMinor(-1, "USD", "LKR", 0.5)).toBe(-1);
    expect(convertMinor(3, "LKR", "USD", 1 / 310)).toBe(0);
  });
});

describe("makeConverter", () => {
  it("converts to base by date, null when missing", () => {
    const toLkr = makeConverter(table, "LKR");
    expect(toLkr(100, "USD", "2026-02-15")).toBe(31_000);
    expect(toLkr(100, "LKR", "1990-01-01")).toBe(100);
    expect(toLkr(100, "EUR", "2026-02-15")).toBeNull();
  });
});
