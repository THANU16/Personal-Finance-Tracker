import { describe, expect, it } from "vitest";
import {
  amortisation,
  applyPrepayment,
  dtiBp,
  dueDate,
  emiMinor,
  loanCost,
  monthsToRepay,
  outstandingAfter,
  splitPayment,
} from "@/domain/loan";

// Known schedule: LKR 1,000,000 at 12% p.a. over 12 months → EMI 88,848.79, total interest 66,185.45.
const P = 100_000_000;
const RATE = 1200;

describe("emiMinor", () => {
  it("matches the known schedule and handles 0% and edge cases", () => {
    expect(emiMinor(P, RATE, 12)).toBe(8_884_879);
    expect(emiMinor(P, 0, 12)).toBe(8_333_334); // ceil so 12 payments cover the principal
    expect(emiMinor(0, RATE, 12)).toBe(0);
    expect(() => emiMinor(P, RATE, 0)).toThrow(RangeError);
  });
});

describe("dueDate", () => {
  it("is monthly from the month after the start, clamped to month end", () => {
    expect(dueDate("2026-01-15", 5, 1)).toBe("2026-02-05");
    expect(dueDate("2026-01-15", 31, 1)).toBe("2026-02-28");
    expect(dueDate("2027-12-01", 29, 2)).toBe("2028-02-29");
    expect(dueDate("2026-11-10", 10, 2)).toBe("2027-01-10");
  });
});

describe("amortisation", () => {
  const rows = amortisation({
    outstandingMinor: P,
    annualRateBp: RATE,
    emiMinor: 8_884_879,
    months: 12,
    startDate: "2026-01-10",
    paymentDay: 10,
  });

  it("sums exactly to the principal; the final row pays the remainder", () => {
    expect(rows).toHaveLength(12);
    expect(rows.reduce((s, r) => s + r.principalMinor, 0)).toBe(P);
    expect(rows.reduce((s, r) => s + r.interestMinor, 0)).toBe(6_618_545);
    expect(rows[0]).toMatchObject({
      no: 1,
      dueDate: "2026-02-10",
      openingMinor: P,
      interestMinor: 1_000_000,
      principalMinor: 7_884_879,
      closingMinor: 92_115_121,
    });
    expect(rows.at(-1)).toMatchObject({
      no: 12,
      dueDate: "2027-01-10",
      openingMinor: 8_796_907,
      interestMinor: 87_969,
      principalMinor: 8_796_907,
      emiMinor: 8_884_876,
      closingMinor: 0,
    });
  });

  it("0% loans split evenly and the last row takes the remainder", () => {
    const zero = amortisation({
      outstandingMinor: P,
      annualRateBp: 0,
      emiMinor: emiMinor(P, 0, 12),
      months: 12,
      startDate: "2026-01-01",
      paymentDay: 1,
    });
    expect(zero.reduce((s, r) => s + r.principalMinor, 0)).toBe(P);
    expect(zero.every((r) => r.interestMinor === 0)).toBe(true);
    expect(zero.at(-1)!.principalMinor).toBe(P - 11 * 8_333_334);
  });

  it("refuses an EMI that never pays off", () => {
    expect(() =>
      amortisation({
        outstandingMinor: P,
        annualRateBp: RATE,
        emiMinor: 1_000_000,
        months: 12,
        startDate: "2026-01-01",
        paymentDay: 1,
      }),
    ).toThrow(RangeError);
  });
});

describe("splitPayment", () => {
  it("interest on the outstanding first, the rest to principal", () => {
    expect(splitPayment(P, RATE, 8_884_879)).toEqual({
      interestMinor: 1_000_000,
      principalMinor: 7_884_879,
      short: false,
      overpaidMinor: 0,
    });
    // Excess over the EMI is a prepayment of principal.
    expect(splitPayment(P, RATE, 20_000_000).principalMinor).toBe(19_000_000);
  });

  it("a payment below the interest is all interest (warned)", () => {
    expect(splitPayment(P, RATE, 600_000)).toEqual({
      interestMinor: 600_000,
      principalMinor: 0,
      short: true,
      overpaidMinor: 0,
    });
  });

  it("never takes more principal than is owed", () => {
    expect(splitPayment(500_000, RATE, 1_000_000)).toEqual({
      interestMinor: 5_000,
      principalMinor: 500_000,
      short: false,
      overpaidMinor: 495_000,
    });
  });
});

describe("prepayment", () => {
  it("reduce_tenure keeps the EMI and needs fewer months", () => {
    // After 1 EMI the balance is 92,115,121; prepay 30,000,000 → 62,115,121.
    const r = applyPrepayment({
      outstandingAfterMinor: 62_115_121,
      annualRateBp: RATE,
      emiMinor: 8_884_879,
      monthsLeft: 11,
      mode: "reduce_tenure",
    });
    expect(r.emiMinor).toBe(8_884_879);
    expect(r.monthsLeft).toBe(8);
    expect(monthsToRepay(92_115_121, RATE, 8_884_879)).toBe(11);
  });

  it("reduce_emi keeps the months and lowers the EMI", () => {
    const r = applyPrepayment({
      outstandingAfterMinor: 62_115_121,
      annualRateBp: RATE,
      emiMinor: 8_884_879,
      monthsLeft: 11,
      mode: "reduce_emi",
    });
    expect(r.monthsLeft).toBe(11);
    expect(r.emiMinor).toBe(emiMinor(62_115_121, RATE, 11));
    expect(r.emiMinor).toBeLessThan(8_884_879);
  });

  it("a fully prepaid loan has nothing left", () => {
    expect(
      applyPrepayment({
        outstandingAfterMinor: 0,
        annualRateBp: RATE,
        emiMinor: 1,
        monthsLeft: 5,
        mode: "reduce_emi",
      }).monthsLeft,
    ).toBe(0);
  });
});

describe("existing loans and DTI", () => {
  it("outstanding after k instalments follows the schedule", () => {
    expect(outstandingAfter(P, RATE, 12, 0)).toBe(P);
    expect(outstandingAfter(P, RATE, 12, 1)).toBe(92_115_121);
    expect(outstandingAfter(P, RATE, 12, 12)).toBe(0);
  });

  it("DTI is EMIs over average monthly income", () => {
    expect(dtiBp(3_000_000, 10_000_000)).toBe(3000);
    expect(dtiBp(1, 0)).toBeNull();
  });
});

describe("loanCost", () => {
  const rows = amortisation({
    outstandingMinor: P,
    annualRateBp: RATE,
    emiMinor: 8_884_879,
    months: 12,
    startDate: "2026-01-01",
    paymentDay: 1,
  });
  const sum = (r: typeof rows) => r.reduce((s, x) => s + x.emiMinor, 0);

  it("total interest = everything paid over the life − principal (known schedule: 66,185.45)", () => {
    // 3 instalments before tracking, 4 recorded, 5 still to come
    const c = loanCost({
      principalMinor: P,
      paidBeforeTrackingMinor: sum(rows.slice(0, 3)),
      recordedPaidMinor: sum(rows.slice(3, 7)),
      remainingMinor: sum(rows.slice(7)),
    });
    expect(c.totalInterestMinor).toBe(6_618_545);
    expect(c.paidMinor).toBe(7 * 8_884_879);
  });

  it("does not depend on how the lender splits interest; repaid loan; no projection", () => {
    // Flat scheme: 12 equal payments of 92,000 on 1,000,000 → 104,000 interest
    expect(
      loanCost({
        principalMinor: P,
        paidBeforeTrackingMinor: 0,
        recordedPaidMinor: 110_400_000,
        remainingMinor: 0,
      }),
    ).toEqual({ paidMinor: 110_400_000, totalInterestMinor: 10_400_000 });
    expect(
      loanCost({
        principalMinor: P,
        paidBeforeTrackingMinor: 0,
        recordedPaidMinor: 5_000,
        remainingMinor: null,
      }),
    ).toEqual({ paidMinor: 5_000, totalInterestMinor: null });
  });
});
