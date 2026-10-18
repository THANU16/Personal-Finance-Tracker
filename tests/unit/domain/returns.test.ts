import { describe, expect, it } from "vitest";
import { cagrBp, simpleReturnBp, xirr, xirrBp } from "@/domain/returns";

describe("xirr (docs/04 §5)", () => {
  it("matches the worked example: −10,000 → +11,000 one year later ≈ 10.00%", () => {
    const r = xirr([
      { date: "2025-01-01", amountMinor: -1_000_000 },
      { date: "2026-01-01", amountMinor: 1_100_000 },
    ]);
    expect(r).toBeCloseTo(0.1, 4);
    expect(
      xirrBp([
        { date: "2025-01-01", amountMinor: -1_000_000 },
        { date: "2026-01-01", amountMinor: 1_100_000 },
      ]),
    ).toBe(1_000);
  });

  it("solves irregular multi-flow cases (checked against the NPV = 0 definition)", () => {
    const flows = [
      { date: "2024-01-01", amountMinor: -1_000_000 },
      { date: "2024-07-01", amountMinor: -500_000 },
      { date: "2025-03-15", amountMinor: 200_000 },
      { date: "2026-01-01", amountMinor: 1_600_000 },
    ];
    const r = xirr(flows)!;
    expect(r).not.toBeNull();
    const t0 = Date.UTC(2024, 0, 1);
    const npv = flows.reduce((s, f) => {
      const days = (Date.parse(`${f.date}T00:00:00Z`) - t0) / 86_400_000;
      return s + f.amountMinor / (1 + r) ** (days / 365);
    }, 0);
    expect(Math.abs(npv)).toBeLessThan(1);
    expect(r).toBeCloseTo(0.10999388, 6); // independent bisection: 10.999%
  });

  it("handles losses", () => {
    const r = xirr([
      { date: "2025-01-01", amountMinor: -1_000_000 },
      { date: "2026-01-01", amountMinor: 800_000 },
    ]);
    expect(r).toBeCloseTo(-0.2, 4);
  });

  it("returns null without a sign change, with too few flows, or under 90 days", () => {
    expect(
      xirr([
        { date: "2025-01-01", amountMinor: -1 },
        { date: "2026-01-01", amountMinor: -1 },
      ]),
    ).toBeNull();
    expect(xirr([{ date: "2025-01-01", amountMinor: -1 }])).toBeNull();
    expect(xirr([])).toBeNull();
    expect(
      xirr([
        { date: "2025-01-01", amountMinor: -1_000 },
        { date: "2025-03-01", amountMinor: 1_100 },
      ]),
    ).toBeNull();
    expect(
      xirr(
        [
          { date: "2025-01-01", amountMinor: -1_000 },
          { date: "2025-03-01", amountMinor: 1_100 },
        ],
        { minSpanDays: 0 },
      ),
    ).not.toBeNull();
  });

  it("ignores zero flows and accepts unsorted input", () => {
    const r = xirr([
      { date: "2026-01-01", amountMinor: 1_100_000 },
      { date: "2025-06-01", amountMinor: 0 },
      { date: "2025-01-01", amountMinor: -1_000_000 },
    ]);
    expect(r).toBeCloseTo(0.1, 4);
  });
});

describe("simple return and CAGR", () => {
  it("gives gain ÷ invested in bp, null when nothing is invested", () => {
    expect(simpleReturnBp(1_000_000, 4_000_000)).toBe(2_500);
    expect(simpleReturnBp(-1, 3)).toBe(-3_333);
    expect(simpleReturnBp(5, 0)).toBeNull();
    expect(simpleReturnBp(900_000_000_000_000, 1_000_000_000_000)).toBe(9_000_000);
  });

  it("annualises growth", () => {
    expect(cagrBp(100, 121, 730)).toBe(1_000);
    expect(cagrBp(0, 121, 730)).toBeNull();
    expect(cagrBp(100, 121, 0)).toBeNull();
  });
});
