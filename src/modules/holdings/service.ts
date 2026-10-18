import "server-only";
import { Types, type ClientSession } from "mongoose";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { fdMaturityValue } from "@/domain/fd";
import { isBigChange } from "@/domain/holdings";
import { PRICE_SCALE, unitsValueMinor } from "@/domain/redemption";
import { formatMoney, formatPercentBp } from "@/lib/format";
import { AssetClassModel, type AssetClassDoc } from "@/modules/asset-classes/model";
import { toHoldingDTO, toValuationDTO, type DtoContext } from "@/modules/holdings/dto";
import {
  HoldingModel,
  ValuationModel,
  type HoldingDoc,
  type ValuationSource,
} from "@/modules/holdings/model";
import {
  bulkValuationsSchema,
  closeHoldingSchema,
  createHoldingSchema,
  fdRenewSchema,
  fdWithdrawSchema,
  recordValuationSchema,
  updateHoldingSchema,
  type HoldingDTO,
  type ValuationDTO,
} from "@/modules/holdings/schemas";
import { getSettings } from "@/modules/settings/service";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError, type FieldErrors } from "@/server/errors";
import { fdTerms } from "@/server/ledger/holding-events";
import { postTransaction } from "@/server/ledger/post";
import { holdingStateAsOf, recomputeHolding } from "@/server/ledger/recompute";

async function dtoContext(ctx: Ctx, session?: ClientSession): Promise<DtoContext> {
  const [settings, classes] = await Promise.all([
    getSettings(ctx),
    AssetClassModel.find({ userId: toObjectId(ctx.userId, "User") })
      .session(session ?? null)
      .lean<AssetClassDoc[]>(),
  ]);
  return {
    tz: ctx.tz,
    today: utcToBusinessDate(new Date(), ctx.tz),
    staleDays: settings.staleDays,
    classes: new Map(classes.map((c) => [String(c._id), c])),
  };
}

async function loadOwned(ctx: Ctx, id: string, session?: ClientSession): Promise<HoldingDoc> {
  const doc = await HoldingModel.findOne({
    _id: toObjectId(id, "Holding"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session ?? null)
    .lean<HoldingDoc>();
  if (!doc) throw new AppError("NOT_FOUND", "Holding not found");
  return doc;
}

async function dto(
  ctx: Ctx,
  id: Types.ObjectId | string,
  session?: ClientSession,
): Promise<HoldingDTO> {
  return toHoldingDTO(await loadOwned(ctx, String(id), session), await dtoContext(ctx, session));
}

async function assertUsableClass(
  ctx: Ctx,
  id: string,
  session: ClientSession,
): Promise<Types.ObjectId> {
  const cls = await AssetClassModel.findOne({
    _id: toObjectId(id, "Asset class"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session)
    .lean<AssetClassDoc>();
  if (!cls)
    throw new AppError("VALIDATION", "Asset class not found", {
      assetClassId: ["Choose an asset class"],
    });
  if (cls.archivedAt) {
    throw new AppError("VALIDATION", `"${cls.name}" is archived`, {
      assetClassId: ["Choose an active class"],
    });
  }
  return cls._id;
}

/** Active holdings using an asset class (asset classes refuse to archive while any exist). */
export async function countActiveHoldingsInClass(
  ctx: Ctx,
  assetClassId: Types.ObjectId,
  session?: ClientSession,
): Promise<number> {
  return HoldingModel.countDocuments({
    userId: toObjectId(ctx.userId, "User"),
    assetClassId,
    status: "active",
  }).session(session ?? null);
}

async function insertValuation(
  ctx: Ctx,
  holding: HoldingDoc,
  v: {
    date: string;
    valueMinor: number;
    priceMinorE4?: number | null;
    units?: number | null;
    source: ValuationSource;
    note?: string | null;
  },
  session: ClientSession,
) {
  const [doc] = await ValuationModel.create(
    [
      {
        userId: holding.userId,
        holdingId: holding._id,
        date: businessDateToUtc(v.date, ctx.tz),
        valueMinor: v.valueMinor,
        priceMinorE4: v.priceMinorE4 ?? null,
        units: v.units ?? null,
        source: v.source,
        note: v.note ?? null,
      },
    ],
    { session },
  );
  await writeAudit(
    {
      userId: ctx.userId,
      action: "valuation",
      entity: "holding",
      entityId: holding._id,
      after: doc!.toObject(),
    },
    session,
  );
}

/**
 * Add holding (wizard): market holdings get an opening_balance transaction for the invested amount
 * and a valuation for the current value on the opening date; FDs get their terms and an
 * opening_balance for the principal (value is calculated, §9).
 */
export async function createHolding(ctx: Ctx, input: unknown): Promise<HoldingDTO> {
  const data = parseInput(createHoldingSchema, input);
  return withTransaction(async (session) => {
    const userId = toObjectId(ctx.userId, "User");
    const assetClassId = await assertUsableClass(ctx, data.assetClassId, session);
    const isFd = data.instrumentType === "fd" && data.fd;
    if (data.fd?.payoutAccountId) toObjectId(data.fd.payoutAccountId, "Account");
    const [doc] = await HoldingModel.create(
      [
        {
          userId,
          name: data.name,
          assetClassId,
          instrumentType: data.instrumentType,
          currency: data.currency,
          platform: data.platform,
          symbol: data.symbol,
          liquidity: data.liquidity,
          tags: data.tags,
          notes: data.notes,
          trackUnits: isFd ? false : data.trackUnits,
          countsTowardEmergencyFund: data.countsTowardEmergencyFund,
          fd: isFd
            ? {
                ...data.fd!,
                startDate: businessDateToUtc(data.fd!.startDate, ctx.tz),
                maturityDate: businessDateToUtc(data.fd!.maturityDate, ctx.tz),
                payoutAccountId: data.fd!.payoutAccountId
                  ? new Types.ObjectId(data.fd!.payoutAccountId)
                  : null,
              }
            : null,
        },
      ],
      { session },
    );
    const holding = doc!.toObject() as HoldingDoc;
    const id = String(holding._id);

    if (isFd) {
      await postTransaction(
        ctx,
        {
          type: "opening_balance",
          date: businessDateToUtc(data.fd!.startDate, ctx.tz),
          amountMinor: data.fd!.principalMinor,
          holdingId: id,
          description: "Opening principal",
        },
        session,
      );
    } else {
      const date = data.openingDate!;
      const units = data.trackUnits ? (data.units ?? null) : null;
      const price =
        data.trackUnits && data.priceMinorE4
          ? data.priceMinorE4
          : units && data.currentValueMinor
            ? Math.round((data.currentValueMinor! * PRICE_SCALE) / units)
            : null;
      if (data.investedMinor! > 0) {
        await postTransaction(
          ctx,
          {
            type: "opening_balance",
            date: businessDateToUtc(date, ctx.tz),
            amountMinor: data.investedMinor!,
            holdingId: id,
            units,
            description: "Opening balance",
          },
          session,
        );
      }
      await insertValuation(
        ctx,
        holding,
        {
          date,
          valueMinor:
            data.trackUnits && units && price
              ? unitsValueMinor(units, price)
              : data.currentValueMinor!,
          priceMinorE4: price,
          units,
          source: "manual",
          note: "Opening value",
        },
        session,
      );
    }
    await recomputeHolding(ctx, holding._id, session);
    await writeAudit(
      {
        userId: ctx.userId,
        action: "create",
        entity: "holding",
        entityId: holding._id,
        after: data,
      },
      session,
    );
    return dto(ctx, holding._id, session);
  });
}

export async function updateHolding(ctx: Ctx, id: string, input: unknown): Promise<HoldingDTO> {
  const data = parseInput(updateHoldingSchema, input);
  return withTransaction(async (session) => {
    const current = await loadOwned(ctx, id, session);
    const $set: Record<string, unknown> = { ...data };
    delete $set.fd;
    if (data.assetClassId)
      $set.assetClassId = await assertUsableClass(ctx, data.assetClassId, session);
    if (data.trackUnits !== undefined && current.fd) delete $set.trackUnits;
    if (data.fd) {
      if (!current.fd) throw new AppError("VALIDATION", "Only fixed deposits have terms");
      for (const [k, v] of Object.entries(data.fd)) {
        if (k === "maturityDate") $set["fd.maturityDate"] = businessDateToUtc(v as string, ctx.tz);
        else if (k === "payoutAccountId")
          $set["fd.payoutAccountId"] = v ? toObjectId(v as string, "Account") : null;
        else $set[`fd.${k}`] = v;
      }
      if (
        data.fd.maturityDate &&
        data.fd.maturityDate <= utcToBusinessDate(current.fd.startDate, ctx.tz)
      ) {
        throw new AppError("VALIDATION", "Maturity must be after the start date", {
          "fd.maturityDate": ["Maturity must be after the start date"],
        });
      }
    }
    await HoldingModel.updateOne(
      { _id: current._id, userId: current.userId },
      { $set },
      { session },
    );
    await recomputeHolding(ctx, current._id, session);
    await writeAudit(
      {
        userId: ctx.userId,
        action: "update",
        entity: "holding",
        entityId: current._id,
        after: data,
      },
      session,
    );
    return dto(ctx, current._id, session);
  });
}

interface PlannedValuation {
  holding: HoldingDoc;
  date: string;
  valueMinor: number;
  priceMinorE4: number | null;
  units: number | null;
  oldValueMinor: number;
  big: boolean;
}

/** Works out a new valuation and whether it is a big change (docs/04 §12). */
async function planValuation(
  ctx: Ctx,
  holding: HoldingDoc,
  input: {
    date: string;
    valueMinor?: number | null;
    priceMinorE4?: number | null;
    units?: number | null;
  },
  thresholdBp: number,
  session: ClientSession,
): Promise<PlannedValuation> {
  if (holding.status !== "active") throw new AppError("VALIDATION", `"${holding.name}" is closed`);
  if (holding.fd)
    throw new AppError("VALIDATION", "Fixed deposit values are calculated from their terms");
  const state = await holdingStateAsOf(ctx, holding, input.date, session);
  let valueMinor = input.valueMinor ?? null;
  const units = holding.trackUnits ? (input.units ?? state.units) : null;
  const price = holding.trackUnits ? (input.priceMinorE4 ?? null) : null;
  if (price && units !== null) valueMinor = unitsValueMinor(units, price);
  if (valueMinor === null) {
    throw new AppError("VALIDATION", "Enter the new value", {
      valueMinor: ["Enter the new value"],
    });
  }
  return {
    holding,
    date: input.date,
    valueMinor,
    priceMinorE4: price,
    units: holding.trackUnits ? units : null,
    oldValueMinor: state.currentValueMinor,
    big: isBigChange(state.currentValueMinor, valueMinor, thresholdBp),
  };
}

function bigChangeMessage(p: PlannedValuation, thresholdBp: number): string {
  const change =
    p.oldValueMinor === 0
      ? "from zero"
      : `${formatPercentBp(Math.round(((p.valueMinor - p.oldValueMinor) * 10_000) / p.oldValueMinor), { signed: true })}`;
  return `${p.holding.name}: ${formatMoney(p.oldValueMinor, p.holding.currency)} → ${formatMoney(p.valueMinor, p.holding.currency)} (${change}) is more than ${formatPercentBp(thresholdBp)}. Confirm the big change.`;
}

/** Update value (single). A change above the threshold needs `confirmBigChange: true`. */
export async function recordValuation(
  ctx: Ctx,
  holdingId: string,
  input: unknown,
): Promise<HoldingDTO> {
  const data = parseInput(recordValuationSchema, input);
  const { bigChangeThresholdBp } = await getSettings(ctx);
  return withTransaction(async (session) => {
    const holding = await loadOwned(ctx, holdingId, session);
    const plan = await planValuation(ctx, holding, data, bigChangeThresholdBp, session);
    if (plan.big && !data.confirmBigChange) {
      throw new AppError("VALIDATION", bigChangeMessage(plan, bigChangeThresholdBp), {
        confirmBigChange: ["Tick to confirm this big change"],
      });
    }
    await insertValuation(ctx, holding, { ...plan, source: "manual", note: data.note }, session);
    await recomputeHolding(ctx, holding._id, session);
    return dto(ctx, holding._id, session);
  });
}

/** Bulk update (docs/04 §12): one valuation per row, all in one DB transaction; any error → none. */
export async function bulkUpdateValues(ctx: Ctx, input: unknown): Promise<{ updated: number }> {
  const data = parseInput(bulkValuationsSchema, input);
  const { bigChangeThresholdBp } = await getSettings(ctx);
  return withTransaction(async (session) => {
    const plans: PlannedValuation[] = [];
    const errors: FieldErrors = {};
    const seen = new Set<string>();
    for (const [i, row] of data.rows.entries()) {
      if (seen.has(row.holdingId)) {
        errors[`rows.${i}.holdingId`] = ["Listed twice"];
        continue;
      }
      seen.add(row.holdingId);
      try {
        const holding = await loadOwned(ctx, row.holdingId, session);
        const plan = await planValuation(
          ctx,
          holding,
          { date: data.date, ...row },
          bigChangeThresholdBp,
          session,
        );
        if (plan.big && !row.confirmBigChange) {
          errors[`rows.${i}.confirmBigChange`] = [bigChangeMessage(plan, bigChangeThresholdBp)];
        }
        plans.push(plan);
      } catch (err) {
        if (err instanceof AppError) errors[`rows.${i}.valueMinor`] = [err.message];
        else throw err;
      }
    }
    if (Object.keys(errors).length) {
      throw new AppError("VALIDATION", "Some rows need attention; nothing was saved.", errors);
    }
    for (const plan of plans) {
      await insertValuation(ctx, plan.holding, { ...plan, source: "bulk" }, session);
      await recomputeHolding(ctx, plan.holding._id, session);
    }
    return { updated: plans.length };
  });
}

/** Removes a valuation entered by mistake (valuations are inputs, not ledger records). */
export async function deleteValuation(
  ctx: Ctx,
  holdingId: string,
  valuationId: string,
): Promise<HoldingDTO> {
  return withTransaction(async (session) => {
    const holding = await loadOwned(ctx, holdingId, session);
    const removed = await ValuationModel.findOneAndDelete(
      { _id: toObjectId(valuationId, "Valuation"), userId: holding.userId, holdingId: holding._id },
      { session },
    );
    if (!removed) throw new AppError("NOT_FOUND", "Valuation not found");
    await recomputeHolding(ctx, holding._id, session);
    await writeAudit(
      {
        userId: ctx.userId,
        action: "delete_valuation",
        entity: "holding",
        entityId: holding._id,
        before: removed.toObject(),
      },
      session,
    );
    return dto(ctx, holding._id, session);
  });
}

export async function listValuations(ctx: Ctx, holdingId: string): Promise<ValuationDTO[]> {
  const holding = await loadOwned(ctx, holdingId);
  const docs = await ValuationModel.find({ userId: holding.userId, holdingId: holding._id })
    .sort({ date: -1, createdAt: -1 })
    .lean();
  return docs.map((d) => toValuationDTO(d, ctx.tz));
}

/** Close (docs/04 §18): a holding with value needs explicit confirmation (`force`). */
export async function closeHolding(ctx: Ctx, id: string, input: unknown): Promise<HoldingDTO> {
  const { force } = parseInput(closeHoldingSchema, input ?? {});
  return withTransaction(async (session) => {
    const holding = await loadOwned(ctx, id, session);
    if (holding.status === "closed") return dto(ctx, holding._id, session);
    const value = (await dto(ctx, holding._id, session)).currentValueMinor;
    if (value !== 0 && !force) {
      throw new AppError(
        "CONFLICT",
        `"${holding.name}" is still worth ${formatMoney(value, holding.currency)}. Confirm to close it anyway.`,
      );
    }
    await HoldingModel.updateOne(
      { _id: holding._id, userId: holding.userId },
      { $set: { status: "closed", closedAt: new Date() } },
      { session },
    );
    await writeAudit(
      { userId: ctx.userId, action: "close", entity: "holding", entityId: holding._id },
      session,
    );
    return dto(ctx, holding._id, session);
  });
}

export async function reopenHolding(ctx: Ctx, id: string): Promise<HoldingDTO> {
  return withTransaction(async (session) => {
    const holding = await loadOwned(ctx, id, session);
    await HoldingModel.updateOne(
      { _id: holding._id, userId: holding.userId },
      { $set: { status: "active", closedAt: null } },
      { session },
    );
    await recomputeHolding(ctx, holding._id, session);
    await writeAudit(
      { userId: ctx.userId, action: "reopen", entity: "holding", entityId: holding._id },
      session,
    );
    return dto(ctx, holding._id, session);
  });
}

async function closeIn(ctx: Ctx, holding: HoldingDoc, session: ClientSession) {
  await HoldingModel.updateOne(
    { _id: holding._id, userId: holding.userId },
    { $set: { status: "closed", closedAt: new Date() } },
    { session },
  );
  await writeAudit(
    { userId: ctx.userId, action: "close", entity: "holding", entityId: holding._id },
    session,
  );
}

function requireFd(holding: HoldingDoc) {
  if (!holding.fd)
    throw new AppError("VALIDATION", "Only fixed deposits can be withdrawn or renewed this way");
  if (holding.status !== "active")
    throw new AppError("VALIDATION", `"${holding.name}" is already closed`);
}

/** FD withdraw (docs/04 §9): redeem the whole deposit into an account and close it. */
export async function withdrawFd(ctx: Ctx, id: string, input: unknown): Promise<HoldingDTO> {
  const data = parseInput(fdWithdrawSchema, input);
  return withTransaction(async (session) => {
    const holding = await loadOwned(ctx, id, session);
    requireFd(holding);
    await postTransaction(
      ctx,
      {
        type: "redeem",
        date: businessDateToUtc(data.date, ctx.tz),
        amountMinor: data.amountMinor,
        feeMinor: data.feeMinor,
        taxMinor: data.taxMinor,
        holdingId: id,
        toAccountId: data.toAccountId,
        description: `${holding.name} withdrawn`,
        source: { kind: "fd_maturity", refId: holding._id },
      },
      session,
    );
    await closeIn(ctx, holding, session);
    return dto(ctx, holding._id, session);
  });
}

/**
 * FD renew (docs/04 §9): redeem into `viaAccount`, then invest the cash that arrived into a new FD
 * from the same account — one DB transaction, both lines linked by groupId; the old FD closes.
 */
export async function renewFd(ctx: Ctx, id: string, input: unknown): Promise<HoldingDTO> {
  const data = parseInput(fdRenewSchema, input);
  return withTransaction(async (session) => {
    const old = await loadOwned(ctx, id, session);
    requireFd(old);
    const groupId = new Types.ObjectId();
    const date = businessDateToUtc(data.date, ctx.tz);
    await postTransaction(
      ctx,
      {
        type: "redeem",
        date,
        amountMinor: data.amountMinor,
        feeMinor: data.feeMinor,
        taxMinor: data.taxMinor,
        holdingId: id,
        toAccountId: data.viaAccountId,
        description: `${old.name} matured (renewed)`,
        source: { kind: "fd_maturity", refId: old._id },
        groupId,
      },
      session,
    );
    await closeIn(ctx, old, session);

    const principal = data.amountMinor - data.feeMinor - data.taxMinor;
    if (principal <= 0)
      throw new AppError("VALIDATION", "Nothing left to renew after tax and fees");
    const [created] = await HoldingModel.create(
      [
        {
          userId: old.userId,
          name: data.name ?? old.name,
          assetClassId: old.assetClassId,
          instrumentType: "fd",
          currency: old.currency,
          platform: old.platform,
          liquidity: old.liquidity,
          tags: old.tags,
          notes: old.notes,
          countsTowardEmergencyFund: old.countsTowardEmergencyFund,
          fd: {
            principalMinor: principal,
            rateBp: data.rateBp,
            startDate: date,
            maturityDate: businessDateToUtc(data.maturityDate, ctx.tz),
            compounding: data.compounding,
            payout: data.payout,
            payoutAccountId: old.fd!.payoutAccountId,
            autoRenew: old.fd!.autoRenew,
          },
        },
      ],
      { session },
    );
    await postTransaction(
      ctx,
      {
        type: "invest",
        date,
        amountMinor: principal,
        holdingId: String(created!._id),
        fromAccountId: data.viaAccountId,
        description: `${data.name ?? old.name} (renewal)`,
        source: { kind: "fd_maturity", refId: old._id },
        groupId,
      },
      session,
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "renew",
        entity: "holding",
        entityId: old._id,
        after: { newHoldingId: created!._id },
      },
      session,
    );
    return dto(ctx, created!._id, session);
  });
}

/** Default withdraw amount for an FD: its value at maturity. */
export function maturityValueOf(holding: HoldingDoc, tz: string): number | null {
  const terms = fdTerms(holding, tz);
  return terms ? fdMaturityValue(terms) : null;
}
