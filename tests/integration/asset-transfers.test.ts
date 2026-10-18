import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { updateTransaction, voidTransaction } from "@/modules/transactions/service";
import { AppError } from "@/server/errors";
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

// Transfer tab with assets (owner request): account → asset = invest, asset → account = redeem,
// asset → asset = switch. The amount arrives at the destination; the fee leaves the source on top.

async function setup() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, { openingBalanceMinor: 10_000_000 });
  const fixed = await assetClassId(ctx, "Fixed Income");
  const mm = await makeHolding(ctx, {
    name: "CAL Money Market",
    assetClassId: fixed,
    instrumentType: "money_market",
    investedMinor: 4_000_000,
    currentValueMinor: 5_000_000,
  });
  const fd = await makeHolding(ctx, {
    name: "Sampath FD",
    assetClassId: fixed,
    instrumentType: "fd",
    investedMinor: 0,
    currentValueMinor: 0,
  });
  return { ctx, bank, mm, fd };
}

const transfer = (
  from: Record<string, string>,
  to: Record<string, string>,
  amountMinor: number,
  feeMinor = 0,
) => ({
  type: "transfer" as const,
  date: "2026-02-01",
  amountMinor,
  feeMinor,
  ...from,
  ...to,
});

async function txns(ctx: Ctx) {
  return TransactionModel.find({ userId: new Types.ObjectId(ctx.userId), status: "posted" })
    .sort({ createdAt: 1 })
    .lean<TransactionDoc[]>();
}

describe("transfers with assets", () => {
  it("account → asset posts an invest (fee on top, from the account)", async () => {
    const { ctx, bank, mm } = await setup();
    await post(ctx, transfer({ fromAccountId: bank.id }, { toHoldingId: mm.id }, 1_000_000, 5_000));
    const last = (await txns(ctx)).at(-1)!;
    expect(last.type).toBe("invest");
    expect(await balanceOf(ctx, bank.id)).toBe(10_000_000 - 1_005_000);
    const h = await holdingDoc(ctx, mm.id);
    expect(h.currentValueMinor).toBe(6_000_000);
    expect(h.investedMinor).toBe(5_005_000);
  });

  it("asset → account posts a redeem; the account receives the amount", async () => {
    const { ctx, bank, mm } = await setup();
    await post(
      ctx,
      transfer({ fromHoldingId: mm.id }, { toAccountId: bank.id }, 2_000_000, 10_000),
    );
    const last = (await txns(ctx)).at(-1)!;
    expect(last.type).toBe("redeem");
    expect(last.amountMinor).toBe(2_010_000);
    expect(await balanceOf(ctx, bank.id)).toBe(12_000_000);
    // docs/04 §3 cost recovery: 2,010,000 − 10,000 fee = 2,000,000 capital back, nothing realised
    expect(last.redemption).toMatchObject({ costRemovedMinor: 2_000_000, realizedGainMinor: 0 });
    expect((await holdingDoc(ctx, mm.id)).currentValueMinor).toBe(2_990_000);
  });

  it("asset → asset is a switch: redeem + invest sharing a group, no account touched", async () => {
    const { ctx, bank, mm, fd } = await setup();
    const id = await post(
      ctx,
      transfer({ fromHoldingId: mm.id }, { toHoldingId: fd.id }, 3_000_000, 15_000),
    );
    const legs = (await txns(ctx)).filter((t) => t.source.kind === "switch");
    expect(legs.map((t) => t.type)).toEqual(["redeem", "invest"]);
    expect(String(legs[0]!.groupId)).toBe(String(legs[1]!.groupId));
    expect(legs.every((t) => !t.fromAccountId && !t.toAccountId)).toBe(true);
    expect(legs[0]!.amountMinor).toBe(3_015_000);
    expect(legs[0]!.feeMinor).toBe(15_000);
    expect(legs[1]!.amountMinor).toBe(3_000_000);
    expect(await balanceOf(ctx, bank.id)).toBe(10_000_000);

    const a = await holdingDoc(ctx, mm.id);
    const b = await holdingDoc(ctx, fd.id);
    expect(a.currentValueMinor).toBe(1_985_000);
    expect(a.realizedGainMinor).toBe(legs[0]!.redemption!.realizedGainMinor);
    expect(b.currentValueMinor).toBe(3_000_000);
    expect(b.investedMinor).toBe(3_000_000);

    // Editing is refused; voiding either leg voids both and restores both holdings.
    const err = await updateTransaction(
      ctx,
      id,
      transfer({ fromHoldingId: mm.id }, { toHoldingId: fd.id }, 1),
    ).catch((e: unknown) => e);
    expect((err as AppError).code).toBe("FORBIDDEN");
    await voidTransaction(ctx, id, { reason: "test" });
    expect((await txns(ctx)).filter((t) => t.source.kind === "switch")).toHaveLength(0);
    expect((await holdingDoc(ctx, mm.id)).currentValueMinor).toBe(5_000_000);
    expect((await holdingDoc(ctx, fd.id)).currentValueMinor).toBe(0);
    expect((await holdingDoc(ctx, fd.id)).investedMinor).toBe(0);
  });

  it("refuses a switch between currencies and a move to itself", async () => {
    const { ctx, mm } = await setup();
    const usd = await makeHolding(ctx, { name: "US fund", currency: "USD" });
    const err = await post(
      ctx,
      transfer({ fromHoldingId: mm.id }, { toHoldingId: usd.id }, 1_000),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toMatch(/one currency/);
    const same = await post(
      ctx,
      transfer({ fromHoldingId: mm.id }, { toHoldingId: mm.id }, 1_000),
    ).catch((e: unknown) => e);
    expect((same as AppError).code).toBe("VALIDATION");
  });
});
