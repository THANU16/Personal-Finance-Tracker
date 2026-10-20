import { describe, expect, it } from "vitest";
import { forecastBalances, monthlyEquivalent, projectNetWorth } from "@/domain/forecast";

const accounts = [
  { id: "A", name: "Bank", balanceMinor: 100_000 },
  { id: "B", name: "Wallet", balanceMinor: 5_000 },
];

describe("forecastBalances (docs/04 §17)", () => {
  it("applies events per day and flags the first date below zero", () => {
    const f = forecastBalances({
      today: "2026-10-20",
      horizonDays: 30,
      accounts,
      minimumMinor: 0,
      events: [
        {
          date: "2026-10-25",
          accountId: "A",
          deltaMinor: -80_000,
          title: "Rent",
          kind: "recurring",
        },
        { date: "2026-10-28", accountId: "A", deltaMinor: -30_000, title: "SIP", kind: "sip" },
        {
          date: "2026-11-01",
          accountId: "A",
          deltaMinor: 50_000,
          title: "Salary",
          kind: "recurring",
        },
        { date: "2026-12-30", accountId: "A", deltaMinor: -1, title: "Beyond", kind: "recurring" },
      ],
    });
    expect(f.days).toHaveLength(30);
    expect(f.to).toBe("2026-11-18");
    const a = f.accounts.find((x) => x.id === "A")!;
    expect(a.breach).toEqual({ date: "2026-10-28", balanceMinor: -10_000, below: "zero" });
    expect(a.lowestMinor).toBe(-10_000);
    expect(a.lowestDate).toBe("2026-10-28");
    expect(a.endMinor).toBe(40_000);
    expect(f.accounts.find((x) => x.id === "B")!.breach).toBeNull();
    expect(f.total.breach).toEqual({ date: "2026-10-28", balanceMinor: -5_000, below: "zero" });
    expect(f.events).toHaveLength(3);
  });

  it("overdue events land on today; unknown accounts move the total only; minimum warning", () => {
    const f = forecastBalances({
      today: "2026-10-20",
      horizonDays: 30,
      accounts,
      minimumMinor: 20_000,
      events: [
        { date: "2026-10-10", accountId: "A", deltaMinor: -10_000, title: "Late", kind: "emi" },
        {
          date: "2026-10-22",
          accountId: null,
          deltaMinor: -90_000,
          title: "Card",
          kind: "card_due",
        },
      ],
    });
    expect(f.days[0]!.byAccount.A).toBe(90_000);
    expect(f.days[2]!.totalMinor).toBe(5_000);
    expect(f.total.breach).toEqual({ date: "2026-10-22", balanceMinor: 5_000, below: "minimum" });
    expect(f.accounts.find((x) => x.id === "B")!.breach).toEqual({
      date: "2026-10-20",
      balanceMinor: 5_000,
      below: "minimum",
    });
  });
});

describe("projectNetWorth (docs/04 §22)", () => {
  it("monthly compounding with three scenarios ± 2 points", () => {
    const p = projectNetWorth({
      startMinor: 1_000_000,
      monthlyContributionMinor: 0,
      annualReturnBp: 1_200,
      years: 1,
    });
    expect(p[0]).toEqual({
      year: 0,
      lowMinor: 1_000_000,
      baseMinor: 1_000_000,
      highMinor: 1_000_000,
    });
    // 1% a month for 12 months ≈ 1,126,825
    expect(p[1]!.baseMinor).toBe(1_126_825);
    expect(p[1]!.lowMinor).toBeLessThan(p[1]!.baseMinor);
    expect(p[1]!.highMinor).toBeGreaterThan(p[1]!.baseMinor);
  });

  it("zero return is start + contributions; low scenario never below 0%", () => {
    const p = projectNetWorth({
      startMinor: 100,
      monthlyContributionMinor: 10,
      annualReturnBp: 0,
      years: 5,
    });
    expect(p).toHaveLength(6);
    expect(p[5]!.baseMinor).toBe(700);
    expect(p[5]!.lowMinor).toBe(700);
  });

  it("weekly contributions become monthly × 52/12", () => {
    expect(monthlyEquivalent(1_200, "weekly")).toBe(5_200);
    expect(monthlyEquivalent(1_200, "monthly")).toBe(1_200);
  });
});
