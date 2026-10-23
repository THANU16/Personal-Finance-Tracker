import "server-only";
import type { ClientSession, Types } from "mongoose";
import { utcToBusinessDate } from "@/domain/dates";
import {
  BUCKETS,
  canCarryEarmarks,
  dedicatedBucket,
  effectiveEarmarks,
  isEarmarkable,
  moveBetweenBuckets as planMove,
  rawEarmark,
  type BucketAmounts,
  type EffectiveEarmarks,
} from "@/domain/earmarks";
import { fdValue } from "@/domain/fd";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { EarmarkModel, type EarmarkDoc } from "@/modules/earmarks/model";
import {
  moveBetweenBucketsSchema,
  removeEarmarkSchema,
  setEarmarkSchema,
  type AccountBucketsDTO,
  type BucketTotalsDTO,
  type EarmarkDTO,
} from "@/modules/earmarks/schemas";
import { loadToBase } from "@/modules/fx/service";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { fdTerms } from "@/server/ledger/holding-events";

// docs/04 §20 — earmarks edit buckets only; they never post transactions or change balances.

function toEarmarkDTO(e: EarmarkDoc, balanceMinor: number): EarmarkDTO {
  return {
    id: String(e._id),
    accountId: String(e.accountId),
    bucket: e.bucket,
    mode: e.mode,
    amountMinor: e.amountMinor ?? null,
    percentBp: e.percentBp ?? null,
    note: e.note ?? null,
    rawMinor: rawEarmark(balanceMinor, e),
  };
}

function toBucketsDTO(account: AccountDoc, earmarks: EarmarkDoc[]): AccountBucketsDTO {
  const dedicated = dedicatedBucket(account);
  const earmarkable = isEarmarkable(account);
  const B = account.balanceMinor;
  let eff: EffectiveEarmarks;
  if (dedicated) {
    const whole = Math.max(0, B);
    eff = {
      emergencyMinor: dedicated === "emergency" ? whole : 0,
      opportunityMinor: dedicated === "opportunity" ? whole : 0,
      freeMinor: 0,
      overEarmarked: false,
    };
  } else if (earmarkable) {
    eff = effectiveEarmarks(B, earmarks);
  } else {
    // Not earmarkable right now (liability, zero balance, archived): stored earmarks are ignored.
    eff = { emergencyMinor: 0, opportunityMinor: 0, freeMinor: 0, overEarmarked: false };
  }
  return {
    ...eff,
    // An earmarkable type with a zero balance still has stored earmarks that cannot be met.
    overEarmarked:
      eff.overEarmarked ||
      (!dedicated &&
        !earmarkable &&
        !account.archivedAt &&
        canCarryEarmarks(account) &&
        earmarks.some((e) => rawEarmark(B, e) > 0)),
    accountId: String(account._id),
    currency: account.currency,
    balanceMinor: B,
    earmarkable,
    archived: Boolean(account.archivedAt),
    canCarryEarmarks: canCarryEarmarks(account),
    dedicated,
    earmarks: earmarks
      .slice()
      .sort((a, b) => BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket))
      .map((e) => toEarmarkDTO(e, B)),
  };
}

async function loadAccount(
  ctx: Ctx,
  accountId: string,
  session?: ClientSession,
): Promise<AccountDoc> {
  const q = AccountModel.findOne({
    _id: toObjectId(accountId, "Account"),
    userId: toObjectId(ctx.userId, "User"),
  });
  if (session) q.session(session);
  const account = await q.lean<AccountDoc>();
  if (!account) throw new AppError("NOT_FOUND", "Account not found");
  return account;
}

/** Stored earmarks of one account (inside the caller's transaction when `session` is given). */
export async function earmarksOf(
  userId: Types.ObjectId,
  accountId: Types.ObjectId,
  session?: ClientSession,
): Promise<EarmarkDoc[]> {
  const q = EarmarkModel.find({ userId, accountId });
  if (session) q.session(session);
  return q.lean<EarmarkDoc[]>();
}

/** Effective earmarks of an earmarkable account (all zero otherwise). Used by the dip guard. */
export async function effectiveEarmarksOf(
  account: AccountDoc,
  session: ClientSession,
): Promise<EffectiveEarmarks> {
  if (!isEarmarkable(account)) {
    return {
      emergencyMinor: 0,
      opportunityMinor: 0,
      freeMinor: account.balanceMinor,
      overEarmarked: false,
    };
  }
  return effectiveEarmarks(
    account.balanceMinor,
    await earmarksOf(account.userId, account._id, session),
  );
}

/**
 * Writes new fixed amounts for the buckets given (null = untouched); 0 removes the earmark.
 * Percent earmarks become fixed. Audited.
 */
export async function storeBucketAmounts(
  ctx: Ctx,
  account: AccountDoc,
  amounts: BucketAmounts,
  reason: string,
  session: ClientSession,
): Promise<void> {
  const before = await earmarksOf(account.userId, account._id, session);
  for (const bucket of BUCKETS) {
    const next = bucket === "emergency" ? amounts.emergencyMinor : amounts.opportunityMinor;
    if (next === null) continue;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new AppError("INTERNAL", "Invalid earmark amount");
    }
    const filter = { userId: account.userId, accountId: account._id, bucket };
    if (next === 0) {
      await EarmarkModel.deleteOne(filter, { session });
    } else {
      await EarmarkModel.updateOne(
        filter,
        { $set: { mode: "fixed", amountMinor: next, percentBp: null } },
        { upsert: true, session, runValidators: true },
      );
    }
  }
  await writeAudit(
    {
      userId: ctx.userId,
      action: reason,
      entity: "earmarks",
      entityId: account._id,
      before: before.map((e) => ({
        bucket: e.bucket,
        mode: e.mode,
        amountMinor: e.amountMinor,
        percentBp: e.percentBp,
      })),
      after: amounts,
    },
    session,
  );
}

function assertCanCarry(account: AccountDoc) {
  const dedicated = dedicatedBucket(account);
  if (dedicated) {
    throw new AppError(
      "VALIDATION",
      dedicated === "opportunity"
        ? `"${account.name}" is an Opportunity Fund account: all of it is opportunity money already`
        : `"${account.name}" counts toward your emergency fund: all of it is emergency money already`,
    );
  }
  if (!canCarryEarmarks(account)) {
    throw new AppError(
      "VALIDATION",
      "Only bank, cash, wallet and broker cash accounts can be earmarked",
    );
  }
  if (account.archivedAt) throw new AppError("CONFLICT", `"${account.name}" is archived`);
  if (account.balanceMinor <= 0) {
    throw new AppError("VALIDATION", `"${account.name}" has no money to earmark`);
  }
}

/** Creates or replaces the earmark of one bucket on an account. Σ raw must fit in the balance. */
export async function setEarmark(ctx: Ctx, input: unknown): Promise<AccountBucketsDTO> {
  const data = parseInput(setEarmarkSchema, input);
  return withTransaction(async (session) => {
    const account = await loadAccount(ctx, data.accountId, session);
    assertCanCarry(account);
    const existing = await earmarksOf(account.userId, account._id, session);
    const next = {
      bucket: data.bucket,
      mode: data.mode,
      amountMinor: data.mode === "fixed" ? data.amountMinor : null,
      percentBp: data.mode === "percent" ? data.percentBp : null,
    };
    const others = existing.filter((e) => e.bucket !== data.bucket);
    const total = [...others, next].reduce((s, e) => s + rawEarmark(account.balanceMinor, e), 0);
    if (total > account.balanceMinor) {
      const field = data.mode === "fixed" ? "amountMinor" : "percentBp";
      const message = "Earmarks would be more than the account balance";
      throw new AppError("VALIDATION", message, { [field]: [message] });
    }
    await EarmarkModel.updateOne(
      { userId: account.userId, accountId: account._id, bucket: data.bucket },
      { $set: { ...next, note: data.note ?? null } },
      { upsert: true, session, runValidators: true },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "earmark_set",
        entity: "earmarks",
        entityId: account._id,
        after: next,
      },
      session,
    );
    return toBucketsDTO(account, await earmarksOf(account.userId, account._id, session));
  });
}

export async function removeEarmark(ctx: Ctx, input: unknown): Promise<AccountBucketsDTO> {
  const data = parseInput(removeEarmarkSchema, input);
  return withTransaction(async (session) => {
    const account = await loadAccount(ctx, data.accountId, session);
    const res = await EarmarkModel.deleteOne(
      { userId: account.userId, accountId: account._id, bucket: data.bucket },
      { session },
    );
    if (res.deletedCount === 0) throw new AppError("NOT_FOUND", "That earmark does not exist");
    await writeAudit(
      {
        userId: ctx.userId,
        action: "earmark_remove",
        entity: "earmarks",
        entityId: account._id,
        before: { bucket: data.bucket },
      },
      session,
    );
    return toBucketsDTO(account, await earmarksOf(account.userId, account._id, session));
  });
}

/** Moves money between free / emergency / opportunity on one account. Never posts a transaction. */
export async function moveBetweenBuckets(ctx: Ctx, input: unknown): Promise<AccountBucketsDTO> {
  const data = parseInput(moveBetweenBucketsSchema, input);
  return withTransaction(async (session) => {
    const account = await loadAccount(ctx, data.accountId, session);
    assertCanCarry(account);
    const eff = effectiveEarmarks(
      account.balanceMinor,
      await earmarksOf(account.userId, account._id, session),
    );
    let amounts: BucketAmounts;
    try {
      amounts = planMove(eff, data.from, data.to, data.amountMinor);
    } catch (err) {
      if (err instanceof RangeError) {
        throw new AppError("VALIDATION", "Not enough in that bucket", {
          amountMinor: [
            `At most ${data.from === "free" ? eff.freeMinor : data.from === "emergency" ? eff.emergencyMinor : eff.opportunityMinor} can move`,
          ],
        });
      }
      throw err;
    }
    await storeBucketAmounts(ctx, account, amounts, "earmark_move", session);
    return toBucketsDTO(account, await earmarksOf(account.userId, account._id, session));
  });
}

export async function getAccountBuckets(ctx: Ctx, accountId: string): Promise<AccountBucketsDTO> {
  await connectDb();
  const account = await loadAccount(ctx, accountId);
  return toBucketsDTO(account, await earmarksOf(account.userId, account._id));
}

/** Buckets of every account, keyed by account id. */
export async function listAccountBuckets(ctx: Ctx): Promise<Map<string, AccountBucketsDTO>> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const [accounts, earmarks] = await Promise.all([
    AccountModel.find({ userId }).lean<AccountDoc[]>(),
    EarmarkModel.find({ userId }).lean<EarmarkDoc[]>(),
  ]);
  const byAccount = new Map<string, EarmarkDoc[]>();
  for (const e of earmarks) {
    const key = String(e.accountId);
    byAccount.set(key, [...(byAccount.get(key) ?? []), e]);
  }
  return new Map(
    accounts.map((a) => [String(a._id), toBucketsDTO(a, byAccount.get(String(a._id)) ?? [])]),
  );
}

function holdingValueToday(h: HoldingDoc, tz: string): number {
  const terms = fdTerms(h, tz);
  return terms ? fdValue(terms, utcToBusinessDate(new Date(), tz)) : h.currentValueMinor;
}

/**
 * Emergency / opportunity / free totals per currency (docs/04 §20). Emergency includes emergency-
 * flagged accounts and holdings; opportunity includes Opportunity Fund accounts.
 */
export async function getBuckets(ctx: Ctx): Promise<BucketTotalsDTO[]> {
  const perAccount = await listAccountBuckets(ctx);
  const holdings = await HoldingModel.find({
    userId: toObjectId(ctx.userId, "User"),
    status: "active",
    countsTowardEmergencyFund: true,
  }).lean<HoldingDoc[]>();
  const totals = new Map<string, BucketTotalsDTO>();
  const row = (currency: string) => {
    let t = totals.get(currency);
    if (!t) {
      t = { currency, emergencyMinor: 0, opportunityMinor: 0, freeMinor: 0 };
      totals.set(currency, t);
    }
    return t;
  };
  for (const b of perAccount.values()) {
    if (b.archived) continue;
    if (!b.dedicated && !b.earmarkable) continue;
    const t = row(b.currency);
    t.emergencyMinor += b.emergencyMinor;
    t.opportunityMinor += b.opportunityMinor;
    t.freeMinor += b.freeMinor;
  }
  for (const h of holdings) row(h.currency).emergencyMinor += holdingValueToday(h, ctx.tz);
  // Holding earmarks (owner request): emergency / opportunity money kept inside an asset.
  const { listHoldingBuckets } = await import("@/modules/earmarks/holding-service");
  for (const hb of (await listHoldingBuckets(ctx)).values()) {
    if (!hb.canCarryEarmarks || (hb.emergencyMinor === 0 && hb.opportunityMinor === 0)) continue;
    const t = row(hb.currency);
    t.emergencyMinor += hb.emergencyMinor;
    t.opportunityMinor += hb.opportunityMinor;
  }
  return [...totals.values()].sort((a, b) =>
    a.currency === ctx.baseCurrency
      ? -1
      : b.currency === ctx.baseCurrency
        ? 1
        : a.currency.localeCompare(b.currency),
  );
}

/** True when the account has explicit earmarks (accounts service: no dedicated flag on top). */
export async function hasEarmarks(
  userId: Types.ObjectId,
  accountId: Types.ObjectId,
  session: ClientSession,
): Promise<boolean> {
  return (await EarmarkModel.exists({ userId, accountId }).session(session)) !== null;
}

/** Bucket totals converted to base at today's rate (dashboard cash bar, safe to spend). */
export async function getBucketsInBase(ctx: Ctx): Promise<BucketTotalsDTO & { fxMissing: number }> {
  const [perCurrency, toBase] = await Promise.all([getBuckets(ctx), loadToBase(ctx)]);
  const today = utcToBusinessDate(new Date(), ctx.tz);
  const out = {
    currency: ctx.baseCurrency,
    emergencyMinor: 0,
    opportunityMinor: 0,
    freeMinor: 0,
    fxMissing: 0,
  };
  for (const t of perCurrency) {
    const e = toBase(t.emergencyMinor, t.currency, today);
    const o = toBase(t.opportunityMinor, t.currency, today);
    const f = toBase(t.freeMinor, t.currency, today);
    if (e === null || o === null || f === null) {
      out.fxMissing += 1;
      continue;
    }
    out.emergencyMinor += e;
    out.opportunityMinor += o;
    out.freeMinor += f;
  }
  return out;
}
