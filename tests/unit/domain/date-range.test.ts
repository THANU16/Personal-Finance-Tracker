import { describe, expect, it } from "vitest";
import { nextDayKey, resolveDateRange } from "@/domain/date-range";

describe("resolveDateRange", () => {
  it.each([
    ["this_month", "2026-10-18", { from: "2026-10-01", to: "2026-10-31" }],
    ["this_month", "2026-02-10", { from: "2026-02-01", to: "2026-02-28" }],
    ["last_month", "2026-10-18", { from: "2026-09-01", to: "2026-09-30" }],
    ["last_month", "2026-01-05", { from: "2025-12-01", to: "2025-12-31" }],
    ["last_30", "2026-10-18", { from: "2026-09-19", to: "2026-10-18" }],
    ["last_90", "2026-10-18", { from: "2026-07-21", to: "2026-10-18" }],
    ["this_year", "2026-10-18", { from: "2026-01-01", to: "2026-12-31" }],
    ["all", "2026-10-18", { from: null, to: null }],
  ] as const)("%s on %s", (preset, today, expected) => {
    expect(resolveDateRange(preset, today)).toEqual(expected);
  });

  it("uses custom bounds, open-ended or swapped", () => {
    expect(resolveDateRange("custom", "2026-10-18", { from: "2026-03-01" })).toEqual({
      from: "2026-03-01",
      to: null,
    });
    expect(
      resolveDateRange("custom", "2026-10-18", { from: "2026-05-01", to: "2026-03-01" }),
    ).toEqual({
      from: "2026-03-01",
      to: "2026-05-01",
    });
  });

  it("gives the next day across month and year ends", () => {
    expect(nextDayKey("2026-12-31")).toBe("2027-01-01");
    expect(nextDayKey("2028-02-28")).toBe("2028-02-29");
  });
});
