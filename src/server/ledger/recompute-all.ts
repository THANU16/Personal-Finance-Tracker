import "server-only";
import { Types } from "mongoose";
import { AccountModel } from "@/modules/accounts/model";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { recomputeAccount, recomputeHolding } from "@/server/ledger/recompute";

/**
 * Rebuilds every account and holding cache of one user from the ledger (docs/04 §1, §3). Safe to
 * run any time: with correct caches nothing changes. Returns how many caches moved.
 */
export async function recomputeAllForUser(ctx: {
  userId: string;
  tz: string;
}): Promise<{ accounts: number; holdings: number; changed: number }> {
  const userId = new Types.ObjectId(ctx.userId);
  const accounts = await AccountModel.find({ userId })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }[]>();
  const holdings = await HoldingModel.find({ userId })
    .select({ _id: 1, currentValueMinor: 1, investedMinor: 1 })
    .lean<Pick<HoldingDoc, "_id" | "currentValueMinor" | "investedMinor">[]>();
  let changed = 0;
  for (const a of accounts) {
    const r = await recomputeAccount(userId, a._id, null, { audit: true });
    if (r.afterMinor !== r.beforeMinor) changed += 1;
  }
  for (const h of holdings) {
    const s = await recomputeHolding(ctx, h._id, null);
    if (s.currentValueMinor !== h.currentValueMinor || s.investedMinor !== h.investedMinor)
      changed += 1;
  }
  return { accounts: accounts.length, holdings: holdings.length, changed };
}
