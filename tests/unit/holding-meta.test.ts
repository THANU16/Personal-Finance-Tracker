import { describe, expect, it } from "vitest";
import { instrumentsForClass } from "@/modules/holdings/components/holding-meta";
import { INSTRUMENT_TYPES } from "@/modules/holdings/constants";

describe("instrumentsForClass", () => {
  it("offers money market and FD under Fixed Income (case-insensitive)", () => {
    const fixed = instrumentsForClass("Fixed Income");
    expect(fixed).toEqual(expect.arrayContaining(["money_market", "fd", "bond", "treasury"]));
    expect(fixed).not.toContain("stock");
    expect(instrumentsForClass(" fixed income ")).toEqual(fixed);
  });

  it("keeps each seeded class to its own types and always offers Other", () => {
    expect(instrumentsForClass("Equity")).not.toContain("fd");
    expect(instrumentsForClass("Crypto")).toEqual(["crypto", "other"]);
    for (const name of [
      "Equity",
      "Fixed Income",
      "Gold",
      "Crypto",
      "Real Estate",
      "Cash & Equivalents",
    ]) {
      expect(instrumentsForClass(name)).toContain("other");
    }
  });

  it("shows every type for custom or unknown classes", () => {
    expect(instrumentsForClass("My pension")).toEqual([...INSTRUMENT_TYPES]);
    expect(instrumentsForClass(undefined)).toEqual([...INSTRUMENT_TYPES]);
  });
});
