import { describe, expect, it } from "vitest";
import {
  addMonthsToKey,
  localDateKey,
  monthKey,
  monthRange,
  periodKey,
  weekKey,
  weekRange,
} from "@/domain/periods";

const TZ = "Asia/Colombo"; // UTC+05:30, no DST

describe("monthKey", () => {
  it.each([
    ["2026-10-31T18:29:59.999Z", "2026-10"], // 23:59:59 local, still October
    ["2026-10-31T19:00:00Z", "2026-11"], // 00:30 local on 1 Nov
    ["2026-10-31T18:30:00Z", "2026-11"], // exactly local midnight
    ["2026-12-31T18:30:00Z", "2027-01"], // year rollover
    ["2026-06-15T00:00:00Z", "2026-06"],
  ])("%s → %s in Asia/Colombo", (iso, expected) => {
    expect(monthKey(new Date(iso), TZ)).toBe(expected);
  });

  it("depends on the timezone", () => {
    const d = new Date("2026-10-31T19:00:00Z");
    expect(monthKey(d, "UTC")).toBe("2026-10");
    expect(monthKey(d, "America/New_York")).toBe("2026-10");
  });

  it("rejects an unknown timezone and invalid date", () => {
    expect(() => monthKey(new Date(), "Mars/Base")).toThrow(RangeError);
    expect(() => monthKey(new Date("nope"), TZ)).toThrow(RangeError);
  });
});

describe("weekKey (ISO week-year)", () => {
  it.each([
    ["2026-01-01T12:00:00Z", "2026-W01"], // Thursday → week 1 of 2026
    ["2027-01-01T12:00:00Z", "2026-W53"], // Friday → last week of 2026
    ["2024-12-30T12:00:00Z", "2025-W01"], // Monday → week 1 of 2025
    ["2026-10-18T12:00:00Z", "2026-W42"],
    ["2026-10-18T18:30:00Z", "2026-W43"], // Sunday 18:30Z = Monday 00:00 local
  ])("%s → %s", (iso, expected) => {
    expect(weekKey(new Date(iso), TZ)).toBe(expected);
  });
});

describe("periodKey / localDateKey", () => {
  it("delegates by frequency", () => {
    const d = new Date("2026-10-31T19:00:00Z");
    expect(periodKey(d, TZ, "monthly")).toBe("2026-11");
    expect(periodKey(d, TZ, "weekly")).toBe("2026-W44");
  });

  it("gives the local calendar date", () => {
    expect(localDateKey(new Date("2026-10-31T19:00:00Z"), TZ)).toBe("2026-11-01");
    expect(localDateKey(new Date("2026-10-31T19:00:00Z"), "UTC")).toBe("2026-10-31");
  });
});

describe("monthRange", () => {
  it("starts and ends at local midnight", () => {
    const r = monthRange("2026-11", TZ);
    expect(r.start.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-30T18:30:00.000Z");
  });

  it("handles December → January", () => {
    const r = monthRange("2026-12", TZ);
    expect(r.end.toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });

  it("is consistent with monthKey at both edges", () => {
    const r = monthRange("2026-02", TZ);
    expect(monthKey(r.start, TZ)).toBe("2026-02");
    expect(monthKey(new Date(r.end.getTime() - 1), TZ)).toBe("2026-02");
    expect(monthKey(r.end, TZ)).toBe("2026-03");
  });

  it("handles DST zones (America/New_York, March 2026 has 30 days 23 hours)", () => {
    const r = monthRange("2026-03", "America/New_York");
    expect(r.start.toISOString()).toBe("2026-03-01T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-04-01T04:00:00.000Z");
  });

  it.each(["2026-13", "2026-1", "26-01", "2026-00", ""])("rejects %j", (key) => {
    expect(() => monthRange(key, TZ)).toThrow(RangeError);
  });
});

describe("weekRange", () => {
  it("runs Monday 00:00 to next Monday 00:00 local", () => {
    const r = weekRange("2026-W43", TZ);
    expect(r.start.toISOString()).toBe("2026-10-18T18:30:00.000Z"); // Mon 19 Oct 00:00 local
    expect(r.end.toISOString()).toBe("2026-10-25T18:30:00.000Z");
  });

  it("handles weeks that start in the previous year", () => {
    const r = weekRange("2025-W01", TZ);
    expect(localDateKey(r.start, TZ)).toBe("2024-12-30");
  });

  it("round-trips with weekKey", () => {
    for (const key of ["2026-W01", "2026-W53", "2025-W01", "2026-W42"]) {
      const r = weekRange(key, TZ);
      expect(weekKey(r.start, TZ)).toBe(key);
      expect(weekKey(new Date(r.end.getTime() - 1), TZ)).toBe(key);
    }
  });

  it.each(["2025-W53", "2026-W54", "2026-W00", "2026-42", "2026-W4"])("rejects %j", (key) => {
    expect(() => weekRange(key, TZ)).toThrow(RangeError);
  });
});

describe("addMonthsToKey", () => {
  it.each([
    ["2026-10", 1, "2026-11"],
    ["2026-12", 1, "2027-01"],
    ["2026-01", -1, "2025-12"],
    ["2026-05", 0, "2026-05"],
    ["2026-05", -17, "2024-12"],
    ["2026-05", 24, "2028-05"],
  ])("%s %+d → %s", (key, n, expected) => {
    expect(addMonthsToKey(key, n)).toBe(expected);
  });

  it("rejects fractional months", () => {
    expect(() => addMonthsToKey("2026-05", 1.5)).toThrow(RangeError);
  });
});
