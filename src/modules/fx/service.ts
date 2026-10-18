import "server-only";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { buildFxTable, makeConverter, type FxTable, type ToBase } from "@/domain/fx";
import { FxRateModel, type FxRateDoc } from "@/modules/fx/model";
import { fxRateInputSchema, type FxRateDTO } from "@/modules/fx/schemas";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";

// docs/04 §14 — manual FX rates. Rates are reference data, not ledger records (edits/deletes allowed).

function toDTO(doc: FxRateDoc, tz: string): FxRateDTO {
  return {
    id: String(doc._id),
    date: utcToBusinessDate(doc.date, tz),
    base: doc.base,
    quote: doc.quote,
    rate: doc.rate,
  };
}

export async function listFxRates(ctx: Ctx): Promise<FxRateDTO[]> {
  await connectDb();
  const docs = await FxRateModel.find({ userId: toObjectId(ctx.userId, "User") })
    .sort({ date: -1, base: 1, quote: 1 })
    .lean<FxRateDoc[]>();
  return docs.map((d) => toDTO(d, ctx.tz));
}

/** Adds a rate, or replaces the rate of the same pair on the same date. Edit = delete + save, atomically. */
export async function saveFxRate(ctx: Ctx, input: unknown, id?: string): Promise<FxRateDTO> {
  const data = parseInput(fxRateInputSchema, input);
  const userId = toObjectId(ctx.userId, "User");
  const date = businessDateToUtc(data.date, ctx.tz);
  return withTransaction(async (session) => {
    if (id) {
      const res = await FxRateModel.deleteOne(
        { _id: toObjectId(id, "FX rate"), userId },
        { session },
      );
      if (res.deletedCount === 0) throw new AppError("NOT_FOUND", "FX rate not found");
    }
    const doc = await FxRateModel.findOneAndUpdate(
      { userId, base: data.base, quote: data.quote, date },
      { $set: { rate: data.rate, source: "manual" } },
      { upsert: true, returnDocument: "after", lean: true, runValidators: true, session },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: id ? "update" : "save",
        entity: "fxRate",
        entityId: doc!._id,
        after: data,
      },
      session,
    );
    return toDTO(doc as FxRateDoc, ctx.tz);
  });
}

export async function deleteFxRate(ctx: Ctx, id: string): Promise<void> {
  await connectDb();
  const res = await FxRateModel.deleteOne({
    _id: toObjectId(id, "FX rate"),
    userId: toObjectId(ctx.userId, "User"),
  });
  if (res.deletedCount === 0) throw new AppError("NOT_FOUND", "FX rate not found");
}

export async function loadFxTable(ctx: Ctx): Promise<FxTable> {
  await connectDb();
  const docs = await FxRateModel.find({ userId: toObjectId(ctx.userId, "User") }).lean<
    FxRateDoc[]
  >();
  return buildFxTable(docs.map((d) => ({ ...d, date: utcToBusinessDate(d.date, ctx.tz) })));
}

/** Converter to the user's base currency (null = rate missing on that date). */
export async function loadToBase(ctx: Ctx): Promise<ToBase> {
  return makeConverter(await loadFxTable(ctx), ctx.baseCurrency);
}
