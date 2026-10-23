import { describe, expect, it } from "vitest";
import {
  earmarksAfterBucketReceive,
  earmarksAfterBucketSpend,
  earmarksAfterBucketUndo,
  canCarryEarmarks,
  dedicatedBucket,
  dipCheck,
  earmarksAfterDip,
  effectiveEarmarks,
  isEarmarkable,
  moveBetweenBuckets,
  rawEarmark,
  type EarmarkLike,
} from "@/domain/earmarks";

const fixed = (bucket: EarmarkLike["bucket"], amountMinor: number): EarmarkLike => ({
  bucket,
  mode: "fixed",
  amountMinor,
});
const percent = (bucket: EarmarkLike["bucket"], percentBp: number): EarmarkLike => ({
  bucket,
  mode: "percent",
  percentBp,
});

// docs/04 §20 worked example: Commercial Bank 350,000 / emergency 100,000 / opportunity 200,000
const EXAMPLE = [fixed("emergency", 100_000), fixed("opportunity", 200_000)];

describe("docs/04 §20 worked example", () => {
  it("350,000 with 100,000 emergency and 200,000 opportunity → free 50,000", () => {
    expect(effectiveEarmarks(350_000, EXAMPLE)).toEqual({
      emergencyMinor: 100_000,
      opportunityMinor: 200_000,
      freeMinor: 50_000,
      overEarmarked: false,
    });
  });

  it("spend 20,000 needs no confirmation → free 30,000", () => {
    expect(dipCheck(20_000, effectiveEarmarks(350_000, EXAMPLE)).needsConfirm).toBe(false);
    expect(effectiveEarmarks(330_000, EXAMPLE).freeMinor).toBe(30_000);
  });

  // Each spend in the example starts from 350,000: 350,000 − 80,000 = 270,000.
  it("spend 80,000 → dips 30,000 into opportunity; confirmed → 270,000 / opp 170,000 / free 0", () => {
    const eff = effectiveEarmarks(350_000, EXAMPLE);
    const dip = dipCheck(80_000, eff);
    expect(dip).toEqual({
      needsConfirm: true,
      dipsOpportunityMinor: 30_000,
      dipsEmergencyMinor: 0,
    });
    const next = earmarksAfterDip(eff, dip);
    expect(next).toEqual({ opportunityMinor: 170_000, emergencyMinor: null });
    const after = effectiveEarmarks(270_000, [
      fixed("emergency", 100_000),
      fixed("opportunity", next.opportunityMinor!),
    ]);
    expect(after).toEqual({
      emergencyMinor: 100_000,
      opportunityMinor: 170_000,
      freeMinor: 0,
      overEarmarked: false,
    });
  });
});

describe("rawEarmark", () => {
  it("fixed is the amount, percent rounds half away from zero", () => {
    expect(rawEarmark(1_000, fixed("emergency", 400))).toBe(400);
    expect(rawEarmark(333, percent("emergency", 5_000))).toBe(167);
    expect(rawEarmark(350_000, percent("opportunity", 2_500))).toBe(87_500);
  });

  it("percent of a non-positive balance is 0", () => {
    expect(rawEarmark(0, percent("emergency", 5_000))).toBe(0);
    expect(rawEarmark(-500, percent("emergency", 5_000))).toBe(0);
  });
});

describe("effectiveEarmarks", () => {
  it("percent mode follows the balance", () => {
    const marks = [percent("emergency", 2_000), percent("opportunity", 3_000)];
    expect(effectiveEarmarks(200_000, marks)).toMatchObject({
      emergencyMinor: 40_000,
      opportunityMinor: 60_000,
      freeMinor: 100_000,
    });
  });

  it("over-earmarked reduces opportunity first", () => {
    expect(effectiveEarmarks(250_000, EXAMPLE)).toEqual({
      emergencyMinor: 100_000,
      opportunityMinor: 150_000,
      freeMinor: 0,
      overEarmarked: true,
    });
  });

  it("then emergency once opportunity is used up", () => {
    expect(effectiveEarmarks(60_000, EXAMPLE)).toEqual({
      emergencyMinor: 60_000,
      opportunityMinor: 0,
      freeMinor: 0,
      overEarmarked: true,
    });
  });

  it("a non-positive balance has nothing earmarked", () => {
    expect(effectiveEarmarks(0, EXAMPLE)).toMatchObject({
      emergencyMinor: 0,
      opportunityMinor: 0,
      freeMinor: 0,
      overEarmarked: true,
    });
    expect(effectiveEarmarks(-5_000, []).freeMinor).toBe(-5_000);
  });

  it("no earmarks: everything is free", () => {
    expect(effectiveEarmarks(12_345, [])).toEqual({
      emergencyMinor: 0,
      opportunityMinor: 0,
      freeMinor: 12_345,
      overEarmarked: false,
    });
  });
});

describe("dipCheck", () => {
  const eff = effectiveEarmarks(350_000, EXAMPLE); // free 50,000

  it("exactly free cash needs no confirmation", () => {
    expect(dipCheck(50_000, eff).needsConfirm).toBe(false);
  });

  it("beyond opportunity it dips into emergency", () => {
    expect(dipCheck(300_000, eff)).toEqual({
      needsConfirm: true,
      dipsOpportunityMinor: 200_000,
      dipsEmergencyMinor: 50_000,
    });
  });

  it("an overdraft beyond every bucket reports only what is earmarked", () => {
    expect(dipCheck(500_000, eff)).toEqual({
      needsConfirm: true,
      dipsOpportunityMinor: 200_000,
      dipsEmergencyMinor: 100_000,
    });
  });

  it("an overdraft with no earmarks needs no confirmation", () => {
    expect(dipCheck(10_000, effectiveEarmarks(5_000, [])).needsConfirm).toBe(false);
  });

  it("only emergency earmarked: dips straight into emergency", () => {
    const e = effectiveEarmarks(100_000, [fixed("emergency", 90_000)]);
    expect(dipCheck(30_000, e)).toEqual({
      needsConfirm: true,
      dipsOpportunityMinor: 0,
      dipsEmergencyMinor: 20_000,
    });
    expect(earmarksAfterDip(e, dipCheck(30_000, e))).toEqual({
      emergencyMinor: 70_000,
      opportunityMinor: null,
    });
  });
});

describe("moveBetweenBuckets", () => {
  const eff = effectiveEarmarks(350_000, EXAMPLE);

  it("free → emergency raises emergency only", () => {
    expect(moveBetweenBuckets(eff, "free", "emergency", 50_000)).toEqual({
      emergencyMinor: 150_000,
      opportunityMinor: null,
    });
  });

  it("opportunity → emergency moves between the two", () => {
    expect(moveBetweenBuckets(eff, "opportunity", "emergency", 20_000)).toEqual({
      emergencyMinor: 120_000,
      opportunityMinor: 180_000,
    });
  });

  it("emergency → free lowers emergency only", () => {
    expect(moveBetweenBuckets(eff, "emergency", "free", 100_000)).toEqual({
      emergencyMinor: 0,
      opportunityMinor: null,
    });
  });

  it("percent earmarks become fixed from their effective value", () => {
    const p = effectiveEarmarks(200_000, [percent("opportunity", 5_000)]); // 100,000
    expect(moveBetweenBuckets(p, "opportunity", "free", 1)).toEqual({
      emergencyMinor: null,
      opportunityMinor: 99_999,
    });
  });

  it("rejects more than the source holds, zero and same bucket", () => {
    expect(() => moveBetweenBuckets(eff, "free", "opportunity", 50_001)).toThrow(RangeError);
    expect(() => moveBetweenBuckets(eff, "emergency", "free", 0)).toThrow(RangeError);
    expect(() => moveBetweenBuckets(eff, "free", "free", 1)).toThrow(RangeError);
  });
});

describe("account rules", () => {
  const bank = { type: "bank" as const, countsTowardEmergencyFund: false, balanceMinor: 1 };

  it("earmarkable: bank/cash/wallet/broker_cash with balance > 0, not dedicated, not archived", () => {
    expect(isEarmarkable(bank)).toBe(true);
    expect(isEarmarkable({ ...bank, type: "broker_cash" })).toBe(true);
    expect(isEarmarkable({ ...bank, balanceMinor: 0 })).toBe(false);
    expect(isEarmarkable({ ...bank, type: "credit_card" })).toBe(false);
    expect(isEarmarkable({ ...bank, countsTowardEmergencyFund: true })).toBe(false);
    expect(isEarmarkable({ ...bank, archivedAt: new Date() })).toBe(false);
  });

  it("dedicated accounts are a whole bucket and cannot carry earmarks", () => {
    expect(dedicatedBucket({ type: "opportunity_fund", countsTowardEmergencyFund: false })).toBe(
      "opportunity",
    );
    expect(dedicatedBucket({ type: "bank", countsTowardEmergencyFund: true })).toBe("emergency");
    expect(dedicatedBucket(bank)).toBeNull();
    expect(canCarryEarmarks({ type: "opportunity_fund", countsTowardEmergencyFund: false })).toBe(
      false,
    );
  });
});

describe("tagged transactions (owner request)", () => {
  // Commercial Bank 350,000: emergency 100,000, opportunity 200,000, free 50,000
  const eff = {
    emergencyMinor: 100_000,
    opportunityMinor: 200_000,
    freeMinor: 50_000,
    overEarmarked: false,
  };

  it("a payment from a bucket lowers only that bucket; more than it holds is refused", () => {
    expect(earmarksAfterBucketSpend(eff, "emergency", 30_000)).toEqual({
      emergencyMinor: 70_000,
      opportunityMinor: null,
    });
    expect(earmarksAfterBucketSpend(eff, "opportunity", 200_000)).toEqual({
      emergencyMinor: null,
      opportunityMinor: 0,
    });
    expect(() => earmarksAfterBucketSpend(eff, "emergency", 100_001)).toThrow(/Only 100000/);
  });

  it("money arriving in a bucket grows it, capped at free cash", () => {
    // after a 20,000 income: balance 370,000, free 70,000
    expect(earmarksAfterBucketReceive({ ...eff, freeMinor: 70_000 }, "emergency", 20_000)).toEqual({
      emergencyMinor: 120_000,
      opportunityMinor: null,
    });
    // overdrawn-ish: only 5,000 free after the inflow
    expect(earmarksAfterBucketReceive({ ...eff, freeMinor: 5_000 }, "opportunity", 20_000)).toEqual(
      {
        emergencyMinor: null,
        opportunityMinor: 205_000,
      },
    );
  });

  it("undo on void: an arrival leaves its bucket (not below 0); a payment goes back", () => {
    expect(earmarksAfterBucketUndo(eff, "emergency", "receive", 20_000).emergencyMinor).toBe(
      80_000,
    );
    expect(earmarksAfterBucketUndo(eff, "emergency", "receive", 500_000).emergencyMinor).toBe(0);
    expect(earmarksAfterBucketUndo(eff, "opportunity", "spend", 30_000).opportunityMinor).toBe(
      230_000,
    );
  });
});
