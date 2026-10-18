import { describe, expect, it } from "vitest";
import { utcToBusinessDate } from "@/domain/dates";
import {
  bucketCount,
  bucketKeyOf,
  buildBuckets,
  defaultGranularity,
  parseRangeView,
  previousPeriod,
  rangeDays,
  resolveRange,
} from "@/domain/date-range";

const TODAY = "2026-10-18"; // a Sunday

describe("resolveRange", () => {
  it.each([
    ["today", "2026-10-18"],
    ["7d", "2026-10-12"],
    ["30d", "2026-09-19"],
    ["3m", "2026-07-19"],
    ["6m", "2026-04-19"],
    ["ytd", "2026-01-01"],
    ["1y", "2025-10-19"],
  ] as const)("%s ends today and starts %s", (preset, from) => {
    expect(resolveRange(preset, TODAY)).toEqual({ from, to: TODAY });
  });

  it("7D is exactly seven days", () => {
    expect(rangeDays(resolveRange("7d", TODAY))).toBe(7);
  });

  it("All starts at the earliest data date (today when there is none)", () => {
    expect(resolveRange("all", TODAY, { earliestKey: "2024-03-05" })).toEqual({
      from: "2024-03-05",
      to: TODAY,
    });
    expect(resolveRange("all", TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it("custom swaps a reversed range and rejects bad keys", () => {
    expect(resolveRange("custom", TODAY, { from: "2026-05-10", to: "2026-05-01" })).toEqual({
      from: "2026-05-01",
      to: "2026-05-10",
    });
    expect(resolveRange("custom", TODAY, { from: "2026-02-30", to: "2026-03-01" })).toEqual(
      resolveRange("30d", TODAY),
    );
  });
});

describe("defaultGranularity", () => {
  it("≤ 31 days day, ≤ 183 week, else month", () => {
    expect(defaultGranularity({ from: "2026-01-01", to: "2026-01-31" })).toBe("day");
    expect(defaultGranularity({ from: "2026-01-01", to: "2026-02-01" })).toBe("week");
    expect(defaultGranularity({ from: "2026-01-01", to: "2026-07-02" })).toBe("week"); // 183 days
    expect(defaultGranularity({ from: "2026-01-01", to: "2026-07-03" })).toBe("month");
  });
});

describe("timezone edge", () => {
  it("23:30 in Asia/Colombo is still that day (UTC is 18:00 the same day)", () => {
    const instant = new Date("2026-01-31T18:00:00Z"); // 23:30 +05:30 on 31 Jan
    expect(utcToBusinessDate(instant, "Asia/Colombo")).toBe("2026-01-31");
    expect(bucketKeyOf("2026-01-31", "month")).toBe("2026-01");
  });

  it("00:15 local on the 1st belongs to the new month although UTC is the previous day", () => {
    const instant = new Date("2026-01-31T18:45:00Z"); // 00:15 +05:30 on 1 Feb
    const day = utcToBusinessDate(instant, "Asia/Colombo");
    expect(day).toBe("2026-02-01");
    expect(bucketKeyOf(day, "month")).toBe("2026-02");
  });
});

describe("buildBuckets", () => {
  it("weeks start on Monday and are clipped to the range", () => {
    const b = buildBuckets({ from: "2026-10-01", to: "2026-10-18" }, "week"); // Thu → Sun
    expect(b).toEqual([
      { key: "2026-09-28", start: "2026-10-01", end: "2026-10-04" },
      { key: "2026-10-05", start: "2026-10-05", end: "2026-10-11" },
      { key: "2026-10-12", start: "2026-10-12", end: "2026-10-18" },
    ]);
    expect(bucketKeyOf("2026-10-18", "week")).toBe("2026-10-12"); // Sunday → previous Monday
  });

  it("months cross the year boundary", () => {
    expect(buildBuckets({ from: "2025-11-15", to: "2026-02-03" }, "month")).toEqual([
      { key: "2025-11", start: "2025-11-15", end: "2025-11-30" },
      { key: "2025-12", start: "2025-12-01", end: "2025-12-31" },
      { key: "2026-01", start: "2026-01-01", end: "2026-01-31" },
      { key: "2026-02", start: "2026-02-01", end: "2026-02-03" },
    ]);
  });

  it("days cover every day, including a leap day, with no gaps", () => {
    const b = buildBuckets({ from: "2028-02-27", to: "2028-03-01" }, "day");
    expect(b.map((x) => x.key)).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("bucketCount matches buildBuckets", () => {
    for (const [range, g] of [
      [{ from: "2026-10-01", to: "2026-10-18" }, "week"],
      [{ from: "2025-11-15", to: "2026-02-03" }, "month"],
      [{ from: "2024-01-01", to: "2026-10-18" }, "day"],
    ] as const) {
      expect(bucketCount(range, g)).toBe(buildBuckets(range, g).length);
    }
  });
});

describe("previousPeriod", () => {
  it("is the same length immediately before", () => {
    expect(previousPeriod({ from: "2026-10-12", to: "2026-10-18" })).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" })).toEqual({
      from: "2026-01-29",
      to: "2026-02-28",
    });
  });
});

describe("parseRangeView", () => {
  it("defaults to 6M (183 days → week)", () => {
    const v = parseRangeView({}, TODAY);
    expect(v).toMatchObject({
      preset: "6m",
      granularity: "week",
      compare: false,
      granularityPinned: false,
    });
  });

  it("restores a custom range, pinned granularity and compare from the URL", () => {
    const v = parseRangeView({ from: "2026-01-01", to: "2026-01-10", g: "week", cmp: "1" }, TODAY);
    expect(v).toMatchObject({
      preset: "custom",
      range: { from: "2026-01-01", to: "2026-01-10" },
      granularity: "week",
      granularityPinned: true,
      compare: true,
    });
  });

  it("warns above 400 buckets", () => {
    const v = parseRangeView({ r: "all", g: "day" }, TODAY, "2024-01-01");
    expect(v.tooManyBuckets).toBe(true);
    expect(parseRangeView({ r: "1y", g: "day" }, TODAY).tooManyBuckets).toBe(false);
  });

  it("ignores unknown values", () => {
    expect(parseRangeView({ r: "forever", g: "hour" }, TODAY).preset).toBe("6m");
  });
});
