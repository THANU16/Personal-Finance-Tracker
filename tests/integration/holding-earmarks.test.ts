import { describe, expect, it } from "vitest";
import { saveTarget } from "@/modules/allocation/service";
import { getBucketsInBase } from "@/modules/earmarks/service";
import {
  getHoldingBuckets,
  moveHoldingBuckets,
  setHoldingEarmark,
} from "@/modules/earmarks/holding-service";
import { getEmergency } from "@/modules/essentials/service";
import { updateHolding } from "@/modules/holdings/service";
import {
  getOpportunityOverview,
  previewDeployment,
  recordDeployment,
  saveFundSettings,
  undoDeployment,
} from "@/modules/opportunity-fund/service";
import { getAllocationView } from "@/modules/rebalancing/service";
import { createTransaction, voidTransaction } from "@/modules/transactions/service";
import type { Ctx } from "@/server/ctx";
import type { AppError } from "@/server/errors";
import {
  assetClassId,
  balanceOf,
  holdingDoc,
  makeAccount,
  makeHolding,
  makeUser,
} from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

// Owner request: emergency / opportunity money kept inside an asset (holding earmarks), the same
// rules as account earmarks (docs/04 §20) on the holding's value.

setupTestDb();

async function setup() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, {
    name: "Bank",
    openingBalanceMinor: 1_000_000,
    openingDate: "2026-01-01",
  });
  const mmf = await makeHolding(ctx, {
    name: "Money Market",
    assetClassId: await assetClassId(ctx, "Fixed Income"),
    instrumentType: "money_market",
    liquidity: "high",
    openingDate: "2026-01-01",
    investedMinor: 500_000,
    currentValueMinor: 500_000,
  });
  return { ctx, bank, mmf };
}

const split = async (ctx: Ctx, id: string) => {
  const b = await getHoldingBuckets(ctx, id);
  return { emergency: b.emergencyMinor, opportunity: b.opportunityMinor, free: b.freeMinor };
};

describe("holding earmarks", () => {
  it("fixed and % earmarks on the value; over the value is refused; the % follows the value", async () => {
    const { ctx, mmf } = await setup();
    await setHoldingEarmark(ctx, {
      holdingId: mmf.id,
      bucket: "emergency",
      mode: "percent",
      percentBp: 6_000,
    });
    await setHoldingEarmark(ctx, {
      holdingId: mmf.id,
      bucket: "opportunity",
      mode: "fixed",
      amountMinor: 150_000,
    });
    expect(await split(ctx, mmf.id)).toEqual({
      emergency: 300_000,
      opportunity: 150_000,
      free: 50_000,
    });
    await expect(
      setHoldingEarmark(ctx, {
        holdingId: mmf.id,
        bucket: "opportunity",
        mode: "fixed",
        amountMinor: 250_000,
      }),
    ).rejects.toThrow(/more than the holding's value/);
    await moveHoldingBuckets(ctx, {
      holdingId: mmf.id,
      from: "free",
      to: "opportunity",
      amountMinor: 50_000,
    });
    expect(await split(ctx, mmf.id)).toEqual({ emergency: 300_000, opportunity: 200_000, free: 0 });
    // The flag and earmarks exclude each other
    await expect(updateHolding(ctx, mmf.id, { countsTowardEmergencyFund: true })).rejects.toThrow(
      /Remove this holding's earmarks first/,
    );
  });

  it("count in the emergency fund (available: high liquidity) and the opportunity fund", async () => {
    const { ctx, mmf } = await setup();
    await setHoldingEarmark(ctx, {
      holdingId: mmf.id,
      bucket: "emergency",
      mode: "fixed",
      amountMinor: 300_000,
    });
    await setHoldingEarmark(ctx, {
      holdingId: mmf.id,
      bucket: "opportunity",
      mode: "fixed",
      amountMinor: 100_000,
    });
    const b = await getBucketsInBase(ctx);
    expect(b).toMatchObject({ emergencyMinor: 300_000, opportunityMinor: 100_000 });
    const e = await getEmergency(ctx);
    expect(e.sources.find((s) => s.id === mmf.id)).toMatchObject({
      name: "Money Market (emergency part)",
      valueMinor: 300_000,
      available: true,
    });
    expect((await getOpportunityOverview(ctx)).fundBalanceMinor).toBe(100_000);
  });

  it("buy into a bucket, sell from a bucket into the bank's bucket; void reverses both", async () => {
    const { ctx, bank, mmf } = await setup();
    const { id: buy } = await createTransaction(ctx, {
      type: "invest",
      date: "2026-02-01",
      amountMinor: 200_000,
      fromAccountId: bank.id,
      holdingId: mmf.id,
      toBucket: "emergency",
    });
    expect(await split(ctx, mmf.id)).toEqual({ emergency: 200_000, opportunity: 0, free: 500_000 });

    const { id: sell } = await createTransaction(ctx, {
      type: "redeem",
      date: "2026-02-02",
      amountMinor: 50_000,
      toAccountId: bank.id,
      holdingId: mmf.id,
      fromBucket: "emergency",
      toBucket: "emergency",
    });
    expect(await split(ctx, mmf.id)).toEqual({ emergency: 150_000, opportunity: 0, free: 500_000 });
    const { getAccountBuckets } = await import("@/modules/earmarks/service");
    expect((await getAccountBuckets(ctx, bank.id)).emergencyMinor).toBe(50_000);

    await voidTransaction(ctx, sell, { reason: "test" });
    expect(await split(ctx, mmf.id)).toEqual({ emergency: 200_000, opportunity: 0, free: 500_000 });
    expect((await getAccountBuckets(ctx, bank.id)).emergencyMinor).toBe(0);
    await voidTransaction(ctx, buy, { reason: "test" });
    expect(await split(ctx, mmf.id)).toEqual({ emergency: 0, opportunity: 0, free: 500_000 });
    expect(await balanceOf(ctx, bank.id)).toBe(1_000_000);
  });

  it("sell guard: selling into reserved money asks first; confirmed, opportunity is used first", async () => {
    const { ctx, bank, mmf } = await setup();
    await setHoldingEarmark(ctx, {
      holdingId: mmf.id,
      bucket: "emergency",
      mode: "fixed",
      amountMinor: 300_000,
    });
    await setHoldingEarmark(ctx, {
      holdingId: mmf.id,
      bucket: "opportunity",
      mode: "fixed",
      amountMinor: 100_000,
    });
    const sell = (flags: object = {}) =>
      createTransaction(ctx, {
        type: "redeem",
        date: "2026-02-01",
        amountMinor: 150_000, // free is 100,000
        toAccountId: bank.id,
        holdingId: mmf.id,
        ...flags,
      });
    const err = (await sell().catch((e: unknown) => e)) as AppError;
    expect(err.code).toBe("NEEDS_CONFIRMATION");
    expect(err.warnings).toEqual([
      expect.objectContaining({
        code: "DIPS_INTO_OPPORTUNITY",
        amountMinor: 50_000,
        accountName: "Money Market",
      }),
    ]);
    await sell({ confirmOpportunity: true });
    expect(await split(ctx, mmf.id)).toEqual({ emergency: 300_000, opportunity: 50_000, free: 0 });
  });

  it("allocation: the reserved part is left out by default and locked when included", async () => {
    const { ctx, mmf } = await setup();
    const fixed = await assetClassId(ctx, "Fixed Income");
    await saveTarget(ctx, {
      allocation: [
        {
          assetClassId: fixed,
          percentBp: 10_000,
          assets: [{ holdingId: mmf.id, percentBp: 10_000 }],
        },
      ],
      thresholdBp: 500,
    });
    await setHoldingEarmark(ctx, {
      holdingId: mmf.id,
      bucket: "emergency",
      mode: "fixed",
      amountMinor: 300_000,
    });
    const hidden = await getAllocationView(ctx);
    expect(hidden.drift.universeValueMinor).toBe(200_000);
    expect(hidden.drift.excludedEmergencyMinor).toBe(300_000);
    const shown = await getAllocationView(ctx, { includeEmergency: true });
    expect(shown.drift.universeValueMinor).toBe(500_000);
    expect(shown.trades.find((t) => t.holdingId === `${mmf.id}~reserved`)).toMatchObject({
      locked: true,
      tradeMinor: 0,
    });
    expect(shown.holdings.find((h) => h.id === `${mmf.id}~reserved`)?.name).toBe(
      "Money Market (reserved)",
    );
  });

  it("Opportunity Fund: deploy from a holding's opportunity part (a switch); undo restores it", async () => {
    const { ctx, mmf } = await setup();
    const equity = await assetClassId(ctx, "Equity");
    const fund = await makeHolding(ctx, {
      name: "Equity Fund",
      assetClassId: equity,
      openingDate: "2026-01-01",
    });
    await saveTarget(ctx, {
      allocation: [
        {
          assetClassId: equity,
          percentBp: 10_000,
          assets: [{ holdingId: fund.id, percentBp: 10_000 }],
        },
      ],
      thresholdBp: 500,
    });
    await saveFundSettings(ctx, {
      benchmarkName: "ASPI",
      targetSizeMinor: null,
      rules: [{ drawdownBp: 1000, deployPercentBp: 2500 }],
      allocationSource: "target",
      allocation: null,
      defaultSourceAccountId: null,
    });
    await setHoldingEarmark(ctx, {
      holdingId: mmf.id,
      bucket: "opportunity",
      mode: "fixed",
      amountMinor: 200_000,
    });
    const o = await getOpportunityOverview(ctx);
    const source = o.sources.find((s) => s.kind === "holding")!;
    expect(source).toMatchObject({
      id: `h:${mmf.id}`,
      opportunityMinor: 200_000,
      name: "Money Market (opportunity part)",
    });

    const lines = (await previewDeployment(ctx, { amountMinor: 80_000 })).map((l) => ({
      ...l,
      feeMinor: 0,
    }));
    const d = await recordDeployment(ctx, {
      date: "2026-03-01",
      sourceAccountId: source.id,
      lines,
    });
    expect(d.sourceAccount).toBe("Money Market (opportunity part)");
    expect((await holdingDoc(ctx, mmf.id)).currentValueMinor).toBe(420_000);
    expect((await holdingDoc(ctx, fund.id)).currentValueMinor).toBe(80_000);
    expect(await split(ctx, mmf.id)).toEqual({ emergency: 0, opportunity: 120_000, free: 300_000 });

    await undoDeployment(ctx, d.id);
    expect((await holdingDoc(ctx, mmf.id)).currentValueMinor).toBe(500_000);
    expect(await split(ctx, mmf.id)).toEqual({ emergency: 0, opportunity: 200_000, free: 300_000 });
  });
});

describe("dashboard allocation (owner request)", () => {
  it("shows investments only: emergency-fund holdings and earmarked parts are left out", async () => {
    const { allocationAsOf } = await import("@/modules/dashboard/queries");
    const { ctx, mmf } = await setup();
    const ef = await makeHolding(ctx, {
      name: "EF deposit",
      assetClassId: await assetClassId(ctx, "Fixed Income"),
      openingDate: "2026-01-01",
      investedMinor: 300_000,
      currentValueMinor: 300_000,
      countsTowardEmergencyFund: true,
    });
    await setHoldingEarmark(ctx, {
      holdingId: mmf.id,
      bucket: "emergency",
      mode: "fixed",
      amountMinor: 200_000,
    });
    const { utcToBusinessDate } = await import("@/domain/dates");
    const a = await allocationAsOf(ctx, utcToBusinessDate(new Date(), ctx.tz));
    expect(a.totalMinor).toBe(300_000); // 500,000 − 200,000 earmarked; the EF deposit not at all
    expect(a.reservedMinor).toBe(500_000);
    expect(a.classes.flatMap((c) => c.holdings.map((h) => h.id))).toEqual([mmf.id]);
    expect(ef.id).toBeTruthy();
  });
});
