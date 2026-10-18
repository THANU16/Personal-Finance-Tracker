import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { utcToBusinessDate } from "@/domain/dates";
import { archiveAssetClass } from "@/modules/asset-classes/service";
import { ValuationModel } from "@/modules/holdings/model";
import {
  bulkUpdateValues,
  closeHolding,
  createHolding,
  deleteValuation,
  listValuations,
  recordValuation,
  renewFd,
  withdrawFd,
} from "@/modules/holdings/service";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { listTransactions } from "@/modules/transactions/queries";
import { transactionFiltersSchema } from "@/modules/transactions/schemas";
import { updateTransaction, voidTransaction } from "@/modules/transactions/service";
import { AppError } from "@/server/errors";
import { recomputeHolding } from "@/server/ledger/recompute";
import type { Ctx } from "@/server/ctx";
import {
  assetClassId,
  balanceOf,
  holdingDoc,
  makeAccount,
  makeHolding,
  makeUser,
  post,
} from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

async function txnDoc(ctx: Ctx, id: string) {
  return TransactionModel.findOne({
    _id: id,
    userId: new Types.ObjectId(ctx.userId),
  }).lean<TransactionDoc>();
}

/** Holding at invested 40,000 / value 50,000 (opening 30,000 → 40,000 + buy 10,000). */
async function exampleSetup() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, { openingBalanceMinor: 10_000_000 }); // 100,000
  const fund = await makeHolding(ctx, {
    name: "Ceylon Equity Fund",
    investedMinor: 3_000_000,
    currentValueMinor: 4_000_000,
  });
  const buy = await post(ctx, {
    type: "invest",
    date: "2026-02-01",
    amountMinor: 1_000_000,
    fromAccountId: bank.id,
    holdingId: fund.id,
  });
  return { ctx, bank, fund, buy };
}

describe("redemption worked example end to end (docs/04 §3)", () => {
  it("40,000 / 50,000 / redeem 20,000 / fee 100 → cost recovered 19,900, gain 0, cash 19,900", async () => {
    const { ctx, bank, fund } = await exampleSetup();
    let h = await holdingDoc(ctx, fund.id);
    expect([h.investedMinor, h.currentValueMinor]).toEqual([4_000_000, 5_000_000]);

    const redeem = await post(ctx, {
      type: "redeem",
      date: "2026-03-01",
      amountMinor: 2_000_000,
      feeMinor: 10_000,
      toAccountId: bank.id,
      holdingId: fund.id,
    });
    const t = await txnDoc(ctx, redeem);
    // Cost recovery (owner decision): a partial redemption returns capital first.
    expect(t?.redemption).toMatchObject({
      costRemovedMinor: 1_990_000,
      realizedGainMinor: 0,
    });
    expect(t?.currency).toBe("LKR");
    h = await holdingDoc(ctx, fund.id);
    expect(h).toMatchObject({
      investedMinor: 2_010_000,
      currentValueMinor: 3_000_000,
      realizedGainMinor: 0,
      feesPaidMinor: 10_000,
    });
    // bank: 100,000 − 10,000 (buy) + 19,900 (cash in)
    expect(await balanceOf(ctx, bank.id)).toBe(10_990_000);
  });

  it("void restores every cache, and recompute is idempotent", async () => {
    const { ctx, bank, fund, buy } = await exampleSetup();
    const redeem = await post(ctx, {
      type: "redeem",
      date: "2026-03-01",
      amountMinor: 2_000_000,
      feeMinor: 10_000,
      toAccountId: bank.id,
      holdingId: fund.id,
    });
    await voidTransaction(ctx, redeem, { reason: "test" });
    let h = await holdingDoc(ctx, fund.id);
    expect(h).toMatchObject({
      investedMinor: 4_000_000,
      currentValueMinor: 5_000_000,
      realizedGainMinor: 0,
    });
    expect(await balanceOf(ctx, bank.id)).toBe(9_000_000);

    await voidTransaction(ctx, buy, { reason: "test" });
    h = await holdingDoc(ctx, fund.id);
    expect(h).toMatchObject({ investedMinor: 3_000_000, currentValueMinor: 4_000_000 });
    expect(await balanceOf(ctx, bank.id)).toBe(10_000_000);

    const before = await holdingDoc(ctx, fund.id);
    await recomputeHolding(ctx, new Types.ObjectId(fund.id), null);
    await recomputeHolding(ctx, new Types.ObjectId(fund.id), null);
    const after = await holdingDoc(ctx, fund.id);
    expect({ ...after, updatedAt: null }).toEqual({ ...before, updatedAt: null });
  });

  it("a backdated buy recomputes a later redemption's cost; editing a buy does too", async () => {
    const { ctx, bank, fund, buy } = await exampleSetup();
    // Invested 40,000, value 50,000: redeem 45,000 → 40,000 capital back, 5,000 realised.
    const redeem = await post(ctx, {
      type: "redeem",
      date: "2026-03-01",
      amountMinor: 4_500_000,
      toAccountId: bank.id,
      holdingId: fund.id,
    });
    expect((await txnDoc(ctx, redeem))?.redemption).toMatchObject({
      costRemovedMinor: 4_000_000,
      realizedGainMinor: 500_000,
    });
    // Buy 10,000 more on 2026-02-15 with a 1,000 fee → invested 51,000: all 45,000 is capital back
    await post(ctx, {
      type: "invest",
      date: "2026-02-15",
      amountMinor: 1_000_000,
      feeMinor: 100_000,
      fromAccountId: bank.id,
      holdingId: fund.id,
    });
    expect((await txnDoc(ctx, redeem))?.redemption).toMatchObject({
      costRemovedMinor: 4_500_000,
      realizedGainMinor: 0,
    });
    // Edit the original buy down to 1,000 → invested 42,000 → 42,000 capital back, 3,000 realised
    await updateTransaction(ctx, buy, {
      type: "invest",
      date: "2026-02-01",
      amountMinor: 100_000,
      fromAccountId: bank.id,
      holdingId: fund.id,
    });
    expect((await txnDoc(ctx, redeem))?.redemption).toMatchObject({
      costRemovedMinor: 4_200_000,
      realizedGainMinor: 300_000,
    });
  });
});

describe("cost recovery (owner decision, docs/04 §3)", () => {
  it("owner example: 660,000 / 672,365 → redeem 400,000 → 260,000 / 272,365; full redeem realises 12,365", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 0 });
    const fund = await makeHolding(ctx, {
      name: "CAL Fixed Income",
      investedMinor: 66_000_000,
      currentValueMinor: 67_236_500,
    });
    await post(ctx, {
      type: "redeem",
      date: "2026-03-01",
      amountMinor: 40_000_000,
      toAccountId: bank.id,
      holdingId: fund.id,
    });
    let h = await holdingDoc(ctx, fund.id);
    expect(h).toMatchObject({
      investedMinor: 26_000_000,
      currentValueMinor: 27_236_500,
      realizedGainMinor: 0,
    });
    await post(ctx, {
      type: "redeem",
      date: "2026-04-01",
      amountMinor: 27_236_500,
      toAccountId: bank.id,
      holdingId: fund.id,
    });
    h = await holdingDoc(ctx, fund.id);
    expect(h).toMatchObject({
      investedMinor: 0,
      currentValueMinor: 0,
      realizedGainMinor: 1_236_500,
    });
    expect(await balanceOf(ctx, bank.id)).toBe(67_236_500);
  });

  it("existing redemptions are recalculated on the next request after the change (bootstrap v5)", async () => {
    const ctx = await makeUser();
    const { SettingsModel } = await import("@/modules/settings/model");
    const { ensureUserSetup } = await import("@/server/bootstrap");
    const bank = await makeAccount(ctx, { openingBalanceMinor: 0 });
    const fund = await makeHolding(ctx, {
      name: "Old fund",
      investedMinor: 66_000_000,
      currentValueMinor: 67_236_500,
    });
    const id = await post(ctx, {
      type: "redeem",
      date: "2026-03-01",
      amountMinor: 40_000_000,
      toAccountId: bank.id,
      holdingId: fund.id,
    });
    const userId = new Types.ObjectId(ctx.userId);
    // Simulate figures stored by the old proportional method, and a user not yet on v5.
    await TransactionModel.updateOne(
      { _id: new Types.ObjectId(id), userId },
      {
        $set: {
          redemption: {
            costRemovedMinor: 39_264_461,
            realizedGainMinor: 735_539,
            unitsRemoved: null,
          },
        },
      },
    );
    const { HoldingModel } = await import("@/modules/holdings/model");
    await HoldingModel.updateOne(
      { _id: new Types.ObjectId(fund.id), userId },
      { $set: { investedMinor: 26_735_539, realizedGainMinor: 735_539 } },
    );
    await SettingsModel.updateOne({ userId }, { $set: { bootstrapVersion: 4 } });

    await ensureUserSetup(ctx.userId);
    expect((await txnDoc(ctx, id))?.redemption).toMatchObject({
      costRemovedMinor: 40_000_000,
      realizedGainMinor: 0,
    });
    expect(await holdingDoc(ctx, fund.id)).toMatchObject({
      investedMinor: 26_000_000,
      realizedGainMinor: 0,
    });
    expect((await SettingsModel.findOne({ userId }).lean())?.bootstrapVersion).toBe(5);
  });
});

describe("investment income", () => {
  it("paid out reaches the account net of tax and counts as income; reinvested raises invested and value", async () => {
    const { ctx, bank, fund } = await exampleSetup();
    await post(ctx, {
      type: "investment_income",
      date: "2026-03-10",
      amountMinor: 100_000,
      taxMinor: 14_000,
      incomeKind: "dividend",
      toAccountId: bank.id,
      holdingId: fund.id,
    });
    await post(ctx, {
      type: "investment_income",
      date: "2026-03-20",
      amountMinor: 50_000,
      taxMinor: 5_000,
      incomeKind: "distribution",
      reinvest: true,
      holdingId: fund.id,
    });
    expect(await balanceOf(ctx, bank.id)).toBe(9_000_000 + 86_000);
    const h = await holdingDoc(ctx, fund.id);
    expect(h).toMatchObject({
      incomeReceivedMinor: 150_000,
      taxWithheldMinor: 19_000,
      investedMinor: 4_045_000,
      currentValueMinor: 5_045_000,
    });
    const summary = (
      await listTransactions(ctx, transactionFiltersSchema.parse({ preset: "all" }), "2026-03-31")
    ).summary;
    expect(summary.incomeMinor).toBe(100_000); // gross paid-out income; reinvested excluded
  });
});

describe("unit-tracked holdings", () => {
  it("values units × price, derives units from price on buy, redeems by units", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 100_000_000 });
    // 1,000 units at NAV 12.3456 (1,234.56 minor → 12,345,600 ×10⁻⁴) = 12,345.60
    const ut = await makeHolding(ctx, {
      trackUnits: true,
      investedMinor: 1_200_000,
      currentValueMinor: 0,
      units: 1_000,
      priceMinorE4: 12_345_600,
    });
    expect(ut.currentValueMinor).toBe(1_234_560);
    expect(ut.units).toBe(1_000);

    await post(ctx, {
      type: "invest",
      date: "2026-02-01",
      amountMinor: 617_280,
      fromAccountId: bank.id,
      holdingId: ut.id,
      priceMinorE4: 12_345_600,
    });
    let h = await holdingDoc(ctx, ut.id);
    expect(h.units).toBe(1_500);
    expect(h.currentValueMinor).toBe(1_851_840);

    const sell = await post(ctx, {
      type: "redeem",
      date: "2026-03-01",
      units: 300,
      priceMinorE4: 13_000_000,
      toAccountId: bank.id,
      holdingId: ut.id,
    });
    const t = await txnDoc(ctx, sell);
    expect(t?.amountMinor).toBe(390_000); // 300 × 1,300.00 minor
    expect(t?.redemption?.costRemovedMinor).toBe(390_000); // cost recovery: the 390,000 proceeds are capital back
    h = await holdingDoc(ctx, ut.id);
    expect(h.units).toBe(1_200);
    expect(h.currentValueMinor).toBe(1_560_000); // 1,200 × 13.00

    const tooMany = await errorOf(
      post(ctx, {
        type: "redeem",
        date: "2026-03-02",
        units: 5_000,
        priceMinorE4: 13_000_000,
        toAccountId: bank.id,
        holdingId: ut.id,
      }),
    );
    expect(tooMany.fieldErrors).toHaveProperty("units");
  });
});

describe("valuations: big change, stale, bulk", () => {
  it("needs confirmation above the big-change threshold (20%)", async () => {
    const { ctx, fund } = await exampleSetup(); // value 50,000
    const err = await errorOf(
      recordValuation(ctx, fund.id, { date: "2026-04-01", valueMinor: 6_100_000 }),
    );
    expect(err.fieldErrors).toHaveProperty("confirmBigChange");
    expect(err.message).toContain("+22.0%");
    expect(await ValuationModel.countDocuments({ userId: new Types.ObjectId(ctx.userId) })).toBe(1);
    const ok = await recordValuation(ctx, fund.id, {
      date: "2026-04-01",
      valueMinor: 6_100_000,
      confirmBigChange: true,
    });
    expect(ok.currentValueMinor).toBe(6_100_000);
    expect(ok.lastValuedAt).toBe("2026-04-01");
    const small = await recordValuation(ctx, fund.id, {
      date: "2026-04-02",
      valueMinor: 6_000_000,
    });
    expect(small.currentValueMinor).toBe(6_000_000);
  });

  it("flags stale values after staleDays and clears on a new valuation", async () => {
    const ctx = await makeUser();
    const today = utcToBusinessDate(new Date(), ctx.tz);
    const h = await makeHolding(ctx, { investedMinor: 100_000, currentValueMinor: 110_000 }); // valued 2026-01-01
    expect(h.stale).toBe(true);
    expect(h.daysSinceValued).toBeGreaterThan(30);
    const fresh = await recordValuation(ctx, h.id, { date: today, valueMinor: 112_000 });
    expect(fresh.stale).toBe(false);
  });

  it("bulk update saves nothing if a big change is unconfirmed, everything once confirmed", async () => {
    const ctx = await makeUser();
    const a = await makeHolding(ctx, { investedMinor: 100_000, currentValueMinor: 100_000 });
    const b = await makeHolding(ctx, { investedMinor: 100_000, currentValueMinor: 100_000 });
    const rows = [
      { holdingId: a.id, valueMinor: 105_000 },
      { holdingId: b.id, valueMinor: 150_000 },
    ];
    const err = await errorOf(bulkUpdateValues(ctx, { date: "2026-05-01", rows }));
    expect(Object.keys(err.fieldErrors ?? {})).toEqual(["rows.1.confirmBigChange"]);
    expect((await holdingDoc(ctx, a.id)).currentValueMinor).toBe(100_000);

    const res = await bulkUpdateValues(ctx, {
      date: "2026-05-01",
      rows: [rows[0]!, { ...rows[1]!, confirmBigChange: true }],
    });
    expect(res.updated).toBe(2);
    expect((await holdingDoc(ctx, a.id)).currentValueMinor).toBe(105_000);
    expect((await holdingDoc(ctx, b.id)).currentValueMinor).toBe(150_000);
    expect((await listValuations(ctx, b.id))[0]?.source).toBe("bulk");
  });

  it("deleting a mistaken valuation restores the previous value", async () => {
    const ctx = await makeUser();
    const h = await makeHolding(ctx, { investedMinor: 100_000, currentValueMinor: 100_000 });
    await recordValuation(ctx, h.id, { date: "2026-05-01", valueMinor: 110_000 });
    const latest = (await listValuations(ctx, h.id))[0]!;
    expect((await deleteValuation(ctx, h.id, latest.id)).currentValueMinor).toBe(100_000);
  });
});

describe("fixed deposits (docs/04 §9)", () => {
  it("an FD without terms takes opening values and later valuations like any holding", async () => {
    const ctx = await makeUser();
    const fd = await createHolding(ctx, {
      name: "Sampath FD",
      assetClassId: await assetClassId(ctx, "Fixed Income"),
      instrumentType: "fd",
      currency: "LKR",
      openingDate: "2026-01-01",
      investedMinor: 10_000_000,
      currentValueMinor: 10_250_000,
    });
    expect(fd.fd).toBeNull();
    expect(fd.investedMinor).toBe(10_000_000);
    expect(fd.currentValueMinor).toBe(10_250_000);
    const valued = await recordValuation(ctx, fd.id, {
      date: "2026-03-01",
      valueMinor: 10_400_000,
    });
    expect(valued.currentValueMinor).toBe(10_400_000);

    const err = await errorOf(
      createHolding(ctx, {
        name: "No values",
        assetClassId: await assetClassId(ctx, "Fixed Income"),
        instrumentType: "fd",
        currency: "LKR",
      }),
    );
    expect(err.fieldErrors).toHaveProperty("currentValueMinor");
  });

  async function fdSetup() {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 0, openingDate: "2025-01-01" });
    const fd = await createHolding(ctx, {
      name: "HNB FD 12m",
      assetClassId: await assetClassId(ctx, "Fixed Income"),
      instrumentType: "fd",
      currency: "LKR",
      fd: {
        principalMinor: 100_000_000,
        rateBp: 1_000,
        startDate: "2025-01-01",
        maturityDate: "2026-01-01",
        compounding: "simple",
        payout: "at_maturity",
      },
    });
    return { ctx, bank, fd };
  }

  it("values the matured FD from its terms", async () => {
    const { fd } = await fdSetup();
    expect(fd.investedMinor).toBe(100_000_000);
    expect(fd.currentValueMinor).toBe(110_000_000);
    expect(fd.fd).toMatchObject({
      maturityValueMinor: 110_000_000,
      accruedInterestMinor: 10_000_000,
    });
    expect(fd.stale).toBe(false);
    expect(fd.trackUnits).toBe(false);
  });

  it("withdraw redeems the whole deposit into the account and closes it", async () => {
    const { ctx, bank, fd } = await fdSetup();
    const res = await withdrawFd(ctx, fd.id, {
      date: "2026-01-01",
      toAccountId: bank.id,
      amountMinor: 110_000_000,
      taxMinor: 500_000,
    });
    expect(res.status).toBe("closed");
    expect(res.currentValueMinor).toBe(0);
    expect(res.realizedGainMinor).toBe(10_000_000);
    expect(await balanceOf(ctx, bank.id)).toBe(109_500_000);
  });

  it("renew moves the proceeds into a new FD through the account, linked by groupId", async () => {
    const { ctx, bank, fd } = await fdSetup();
    const next = await renewFd(ctx, fd.id, {
      date: "2026-01-01",
      viaAccountId: bank.id,
      amountMinor: 110_000_000,
      taxMinor: 500_000,
      rateBp: 900,
      maturityDate: "2027-01-01",
      compounding: "monthly",
      payout: "at_maturity",
    });
    expect(next.fd?.principalMinor).toBe(109_500_000);
    expect(next.investedMinor).toBe(109_500_000);
    expect(next.status).toBe("active");
    expect((await holdingDoc(ctx, fd.id)).status).toBe("closed");
    expect(await balanceOf(ctx, bank.id)).toBe(0);
    const group = await TransactionModel.find({
      userId: new Types.ObjectId(ctx.userId),
      groupId: { $ne: null },
    }).lean();
    expect(group.map((g) => g.type).sort()).toEqual(["invest", "redeem"]);
    expect(String(group[0]!.groupId)).toBe(String(group[1]!.groupId));
  });

  it("rejects manual valuations on an FD", async () => {
    const { ctx, fd } = await fdSetup();
    expect(
      (await errorOf(recordValuation(ctx, fd.id, { date: "2026-02-01", valueMinor: 1 }))).code,
    ).toBe("VALIDATION");
  });
});

describe("rules and isolation", () => {
  it("rejects a currency mismatch, a holding without value, and closed holdings", async () => {
    const ctx = await makeUser();
    const usd = await makeAccount(ctx, { currency: "USD", openingBalanceMinor: 10_000 });
    const bank = await makeAccount(ctx, { openingBalanceMinor: 1_000_000 });
    const h = await makeHolding(ctx);
    expect(
      (
        await errorOf(
          post(ctx, {
            type: "invest",
            date: "2026-02-01",
            amountMinor: 100,
            fromAccountId: usd.id,
            holdingId: h.id,
          }),
        )
      ).fieldErrors,
    ).toHaveProperty("fromAccountId");
    expect(
      (
        await errorOf(
          post(ctx, {
            type: "redeem",
            date: "2026-02-01",
            amountMinor: 100,
            toAccountId: bank.id,
            holdingId: h.id,
          }),
        )
      ).fieldErrors,
    ).toHaveProperty("amountMinor");
    await closeHolding(ctx, h.id, {});
    expect(
      (
        await errorOf(
          post(ctx, {
            type: "invest",
            date: "2026-02-01",
            amountMinor: 100,
            fromAccountId: bank.id,
            holdingId: h.id,
          }),
        )
      ).fieldErrors,
    ).toHaveProperty("holdingId");
  });

  it("closing a holding with value needs confirmation; an asset class in use can't be archived", async () => {
    const ctx = await makeUser();
    const cls = await assetClassId(ctx, "Equity");
    const h = await makeHolding(ctx, { investedMinor: 1_000, currentValueMinor: 1_200 });
    expect((await errorOf(closeHolding(ctx, h.id, {}))).code).toBe("CONFLICT");
    const { createAssetClass } = await import("@/modules/asset-classes/service");
    const custom = await createAssetClass(ctx, { name: "Private", color: "#111111" });
    await makeHolding(ctx, { assetClassId: custom.id });
    expect((await errorOf(archiveAssetClass(ctx, custom.id))).code).toBe("CONFLICT");
    expect((await closeHolding(ctx, h.id, { force: true })).status).toBe("closed");
    void cls;
  });

  it("hides other users' holdings", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const h = await makeHolding(alice, { investedMinor: 1_000, currentValueMinor: 1_000 });
    const bobBank = await makeAccount(bob, { openingBalanceMinor: 10_000 });
    expect(
      (await errorOf(recordValuation(bob, h.id, { date: "2026-02-01", valueMinor: 1 }))).code,
    ).toBe("NOT_FOUND");
    expect(
      (
        await errorOf(
          post(bob, {
            type: "invest",
            date: "2026-02-01",
            amountMinor: 100,
            fromAccountId: bobBank.id,
            holdingId: h.id,
          }),
        )
      ).fieldErrors,
    ).toHaveProperty("holdingId");
  });
});

describe("portfolio query (docs/05 §5)", () => {
  it("XIRR ≈ 10% for −10,000 (2025-01-01) → +11,000 (2026-01-01); weights and totals", async () => {
    const { getPortfolio } = await import("@/modules/holdings/queries");
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 0, openingDate: "2025-01-01" });
    const sold = await makeHolding(ctx, {
      name: "Sold fund",
      openingDate: "2025-01-01",
      investedMinor: 1_000_000,
      currentValueMinor: 1_000_000,
    });
    // Same day: entry order — the valuation is entered before the redemption
    await recordValuation(ctx, sold.id, { date: "2026-01-01", valueMinor: 1_100_000 });
    await post(ctx, {
      type: "redeem",
      date: "2026-01-01",
      amountMinor: 1_100_000,
      toAccountId: bank.id,
      holdingId: sold.id,
    });
    await closeHolding(ctx, sold.id, {});

    const a = await makeHolding(ctx, {
      name: "A",
      investedMinor: 300_000,
      currentValueMinor: 300_000,
    });
    const gold = await makeHolding(ctx, {
      name: "Gold",
      assetClassId: await assetClassId(ctx, "Gold"),
      investedMinor: 100_000,
      currentValueMinor: 100_000,
    });
    await makeHolding(ctx, {
      name: "USD ETF",
      currency: "USD",
      investedMinor: 1_000,
      currentValueMinor: 1_000,
    });

    const p = await getPortfolio(ctx, { includeClosed: true });
    const soldRow = p.holdings.find((h) => h.id === sold.id)!;
    expect(soldRow.xirrBp).toBe(1_000);
    expect(soldRow.realizedGainMinor).toBe(100_000);
    expect(soldRow.weightBp).toBeNull(); // closed

    expect(p.totals).toMatchObject({
      currency: "LKR",
      valueMinor: 400_000,
      investedMinor: 400_000,
      realizedGainMinor: 100_000,
      fxMissingCount: 1,
    });
    expect(p.holdings.find((h) => h.id === a.id)?.weightBp).toBe(7_500);
    expect(p.holdings.find((h) => h.id === gold.id)?.weightBp).toBe(2_500);
    expect(p.classes.map((c) => [c.name, c.weightBp])).toEqual([
      ["Equity", 7_500],
      ["Gold", 2_500],
    ]);
    expect(p.closedCount).toBe(1);

    // With a USD rate the ETF ($10.00 × 300 = LKR 3,000.00 = 300,000 minor) joins totals and weights.
    const { saveFxRate } = await import("@/modules/fx/service");
    await saveFxRate(ctx, { date: "2025-01-01", base: "USD", quote: "LKR", rate: 300 });
    const q = await getPortfolio(ctx);
    expect(q.totals).toMatchObject({ valueMinor: 700_000, fxMissingCount: 0 });
    const etf = q.holdings.find((h) => h.name === "USD ETF")!;
    expect(etf.valueBaseMinor).toBe(300_000);
    expect(etf.weightBp).toBe(4_286); // 300,000 / 700,000
  });
});
