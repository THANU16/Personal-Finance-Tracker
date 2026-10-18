import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assetNameFromFileName,
  bigChanges,
  buildImportPlan,
  dayEnds,
  detectJumps,
  matchHolding,
  orderRows,
  parseValuationCsv,
  simulateImport,
  validateRows,
} from "@/domain/valuation-import";

const fixture = readFileSync(
  join(process.cwd(), "tests/fixtures/valuations-cse-stock.csv"),
  "utf8",
);
const parsed = () => parseValuationCsv(fixture, "LKR");
const days = () => dayEnds(orderRows(parsed().rows));

describe("parseValuationCsv (fixture: CSE Stock export)", () => {
  it("parses 45 rows with a BOM and CRLF; decimals become exact minor units", () => {
    expect(fixture.charCodeAt(0)).toBe(0xfeff);
    expect(fixture.includes("\r\n")).toBe(true);
    const { rows, fileError } = parsed();
    expect(fileError).toBeNull();
    expect(rows).toHaveLength(45);
    expect(rows.every((r) => r.errors.length === 0)).toBe(true);
    const r = rows.find((x) => x.date === "2026-10-11")!;
    expect(r).toMatchObject({
      valueMinor: 33_873_845,
      recordedAt: "2026-10-11T19:17:53Z",
      currency: "LKR",
      units: null,
    });
  });

  it("handles quoted thousands separators, blank lines and reports error rows", () => {
    const text = [
      "Valuation Date,Recorded At (UTC),Value,Units,NAV,Price Per Unit,Currency,Note",
      '2026-01-05,2026-01-05 10:00:00,"1,234,567.89",,,,LKR,"a, b"',
      "",
      "2026-13-01,2026-01-06 10:00:00,10.00,,,,LKR,",
      "2026-01-07,,abc,,,,LKR,",
      "2026-01-08,2026-01-08 10:00:00,5.00,,,,USD,",
      "2999-01-01,2999-01-01 00:00:00,5.00,,,,LKR,",
      "",
    ].join("\n");
    const { rows } = parseValuationCsv(text, "LKR");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ valueMinor: 123_456_789, note: "a, b", errors: [] });
    expect(rows[1]!.errors[0]).toMatch(/Unreadable date/);
    expect(rows[2]!.errors[0]).toMatch(/Unreadable value/);
    const checked = validateRows(rows, { todayKey: "2026-10-18", currency: "LKR" });
    expect(checked[3]!.errors).toEqual(["In USD, the holding is in LKR"]);
    expect(checked[4]!.errors).toEqual(["Dated in the future"]);
    expect(parseValuationCsv("Date,Amount\n1,2", "LKR").fileError).toMatch(/Expected the columns/);
  });
});

describe("ordering and same-day rows", () => {
  it("keeps every row; the last recorded row is the day value", () => {
    const d = days();
    expect(d.find((x) => x.date === "2026-09-17")).toMatchObject({
      valueMinor: 28_002_300,
      values: [26_502_300, 28_002_300],
    });
    expect(d.filter((x) => x.lines.length > 1).map((x) => x.date)).toEqual([
      "2026-05-05",
      "2026-05-12",
      "2026-09-17",
    ]);
    expect(d[0]).toMatchObject({ date: "2025-11-13", valueMinor: 5_000_000 });
    expect(d.at(-1)).toMatchObject({ date: "2026-10-17", valueMinor: 33_608_300 });
  });
});

describe("jump detection", () => {
  const jumps = () => detectJumps(days(), { thresholdBp: 1000, currency: "LKR" });

  it("flags the known deposits and the withdrawal", () => {
    const byKey = new Map(jumps().map((j) => [j.key, j]));
    expect(byKey.get("2026-03-29>2026-03-31")).toMatchObject({
      changeMinor: 5_000_069,
      action: "deposit",
      amountMinor: 5_000_000,
      date: "2026-03-31",
    });
    expect(byKey.get("2026-04-28>2026-04-29")).toMatchObject({
      changeMinor: -5_039_439,
      action: "withdrawal",
      amountMinor: 5_000_000,
    });
    expect(byKey.get("2026-07-22>2026-07-24")).toMatchObject({
      changeMinor: 7_412_218,
      action: "deposit",
      amountMinor: 7_400_000,
    });
    expect(byKey.get("2026-09-16>2026-09-17")).toMatchObject({
      changeMinor: 3_000_000,
      stepsMinor: [1_500_000, 1_500_000],
      reasons: ["percent", "round"],
    });
  });

  it("an already-recorded invest within ±3 days defaults to a market move", () => {
    const j = detectJumps(days(), {
      thresholdBp: 1000,
      currency: "LKR",
      existingFlows: [{ type: "invest", date: "2026-03-30", amountMinor: 5_010_000 }],
    }).find((x) => x.key === "2026-03-29>2026-03-31")!;
    expect(j).toMatchObject({ alreadyRecorded: true, action: "market" });
  });

  it("only flags days that bring new rows when re-importing", () => {
    expect(
      detectJumps(days(), { thresholdBp: 1000, currency: "LKR", newDates: new Set() }),
    ).toEqual([]);
  });

  it("lists big changes (20%) without blocking", () => {
    expect(bigChanges(days(), 2000).has("2026-03-31")).toBe(true);
  });
});

describe("plan and live summary", () => {
  it("first value as initial investment + chosen jumps → invested, value, gain", () => {
    const rows = parsed().rows;
    const jumps = detectJumps(days(), { thresholdBp: 1000, currency: "LKR" });
    // Only the four known flows are real; everything else is a market move.
    const real: Record<string, { action: "deposit" | "withdrawal"; amountMinor: number }> = {
      "2026-03-29>2026-03-31": { action: "deposit", amountMinor: 5_000_000 },
      "2026-04-28>2026-04-29": { action: "withdrawal", amountMinor: 5_000_000 },
      "2026-07-22>2026-07-24": { action: "deposit", amountMinor: 7_400_000 },
      "2026-09-16>2026-09-17": { action: "deposit", amountMinor: 3_000_000 },
    };
    const choices = Object.fromEntries(
      jumps.map((j) => [
        j.key,
        real[j.key]
          ? { ...real[j.key]!, date: j.toDate }
          : { action: "market" as const, amountMinor: 0, date: j.toDate },
      ]),
    );
    const plan = buildImportPlan({
      rows,
      jumps,
      choices,
      firstAsInvestment: true,
      trackUnits: false,
    });
    expect(plan.valuations).toHaveLength(45);
    expect(plan.valuations.filter((v) => v.superseded)).toHaveLength(3);
    expect(plan.flows[0]).toMatchObject({
      type: "invest",
      date: "2025-11-13",
      amountMinor: 5_000_000,
      reason: "initial",
    });
    expect(plan.depositMinor).toBe(5_000_000 + 5_000_000 + 7_400_000 + 3_000_000);
    expect(plan.withdrawalMinor).toBe(5_000_000);

    const s = simulateImport({ existing: [], plan, trackUnits: false, todayKey: "2026-10-18" });
    expect(s.currentValueMinor).toBe(33_608_300);
    // Hand check: invested 50,000.00 (first value) + 50,000.00 (31 Mar) = 100,000.00 before the
    // withdrawal; it redeems 50,000.00 against the value just before it (28 Apr day-end 224,410.00):
    // cost removed = round(100,000.00 × 50,000.00 / 224,410.00) = 22,280.65 → 77,719.35 left;
    // then + 74,000.00 + 30,000.00 = 181,719.35 invested.
    const cost = Math.round((10_000_000 * 5_000_000) / 22_441_000);
    expect(cost).toBe(2_228_065);
    expect(s.investedMinor).toBe(10_000_000 - cost + 7_400_000 + 3_000_000);
    expect(s.investedMinor).toBe(18_171_935);
    expect(s.unrealisedMinor).toBe(33_608_300 - 18_171_935);
    expect(s.xirrBp).not.toBeNull();
  });
});

describe("file names", () => {
  it("extracts the asset name from both export patterns and matches a holding", () => {
    expect(assetNameFromFileName("CSE Stock - valuations 2026-10-18.csv")).toBe("CSE Stock");
    expect(assetNameFromFileName("17_CAL Equity Fund - valuations_2026-10-18.csv")).toBe(
      "CAL Equity Fund",
    );
    expect(assetNameFromFileName("Binance - Gold - valuations 2026-10-18.csv")).toBe(
      "Binance - Gold",
    );
    const holdings = [
      { id: "1", name: "CAL Equity Fund" },
      { id: "2", name: "cse stock portfolio" },
      { id: "3", name: "Physical Gold" },
    ];
    expect(matchHolding("CSE Stock", holdings)?.id).toBe("2");
    expect(matchHolding("cal equity fund", holdings)?.id).toBe("1");
    expect(matchHolding("Crypto wallet", holdings)).toBeNull();
  });
});
