import "server-only";
import type { ClientSession, Types } from "mongoose";
import { minorUnitDigits } from "@/domain/money";
import { dedicatedBucket, dipCheck, earmarksAfterDip, isEarmarkable } from "@/domain/earmarks";
import { effectiveEarmarksOf, storeBucketAmounts } from "@/modules/earmarks/service";
import { utcToBusinessDate } from "@/domain/dates";
import { validateSplits } from "@/domain/ledger";
import { PRICE_SCALE, redeemByAmount, redeemByUnits, roundUnits } from "@/domain/redemption";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { assertUsableCategory, getSystemCategoryId } from "@/modules/categories/service";
import { SYSTEM_CATEGORY } from "@/modules/categories/seed";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import {
  TransactionModel,
  type INCOME_KINDS,
  type SourceKind,
  type TransactionDoc,
} from "@/modules/transactions/model";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { toObjectId } from "@/server/db/ids";
import { AppError, type ActionWarning } from "@/server/errors";
import { holdingStateAsOf, recomputeAccounts, recomputeHolding } from "@/server/ledger/recompute";

/** Ledger types that can be posted so far (debt_payment: Phase 8). */
export type PostableType =
  | "income"
  | "expense"
  | "transfer"
  | "adjustment"
  | "invest"
  | "redeem"
  | "investment_income"
  | "opening_balance";

export interface LedgerDraft {
  type: PostableType;
  /** Stored instant (business date at local midnight). */
  date: Date;
  /** For by-units redemptions this is computed from units × price and may be 0 on input. */
  amountMinor: number;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  toAmountMinor?: number | null;
  categoryId?: string | null;
  splits?: { categoryId: string; amountMinor: number; note?: string | null }[] | null;
  holdingId?: string | null;
  feeMinor?: number;
  taxMinor?: number;
  units?: number | null;
  priceMinorE4?: number | null;
  incomeKind?: (typeof INCOME_KINDS)[number] | null;
  reinvest?: boolean | null;
  description?: string | null;
  counterparty?: string | null;
  notes?: string | null;
  tags?: string[];
  source?: { kind: SourceKind; refId?: Types.ObjectId | null };
  groupId?: Types.ObjectId | null;
  /** Dip guard confirmations (docs/04 §20). Emergency money needs its own flag. */
  confirmOpportunity?: boolean;
  confirmEmergency?: boolean;
  /** Edit (void + repost): the voided original, so only an increase on the same account is guarded. */
  replaces?: { fromAccountId: string; outflowMinor: number } | null;
}

/** Sources that move earmarked money on purpose and are never guarded (docs/04 §20). */
const UNGUARDED_SOURCES: readonly SourceKind[] = [
  "opportunity_deployment",
  "fd_maturity",
  "reconcile",
];

/** Money leaving the source account that the dip guard checks: expense, transfer + fee, invest + fee. */
export function guardedOutflow(t: {
  type: string;
  amountMinor: number;
  feeMinor?: number | null;
}): number {
  if (t.type === "expense") return t.amountMinor;
  if (t.type === "transfer" || t.type === "invest") return t.amountMinor + (t.feeMinor ?? 0);
  if (t.type === "debt_payment") return t.amountMinor;
  return 0;
}

/**
 * Dip guard (docs/04 §20). Earmarkable source: an outflow beyond free cash needs confirmation;
 * confirmed, the dipped earmarks are reduced (opportunity first) in this same DB transaction.
 * Dedicated source (emergency / opportunity account): any outflow needs confirmation.
 */
async function guardOutflow(
  ctx: Ctx,
  from: AccountDoc,
  outflowMinor: number,
  draft: LedgerDraft,
  session: ClientSession,
): Promise<void> {
  if (outflowMinor <= 0) return;
  if (UNGUARDED_SOURCES.includes(draft.source?.kind ?? "manual")) return;
  if (
    draft.replaces &&
    draft.replaces.fromAccountId === String(from._id) &&
    outflowMinor <= draft.replaces.outflowMinor
  ) {
    return;
  }
  const warn = (code: ActionWarning["code"], amountMinor: number): ActionWarning => ({
    code,
    amountMinor,
    currency: from.currency,
    accountName: from.name,
  });

  const dedicated = dedicatedBucket(from);
  if (dedicated) {
    const confirmed = dedicated === "emergency" ? draft.confirmEmergency : draft.confirmOpportunity;
    if (confirmed) return;
    const code =
      dedicated === "emergency" ? "WITHDRAWS_FROM_EMERGENCY" : "WITHDRAWS_FROM_OPPORTUNITY";
    throw new AppError(
      "NEEDS_CONFIRMATION",
      `This takes money out of "${from.name}", which is ${dedicated} money. Confirm to continue.`,
      undefined,
      { warnings: [warn(code, outflowMinor)] },
    );
  }

  if (!isEarmarkable(from)) return;
  const effective = await effectiveEarmarksOf(from, session);
  const dip = dipCheck(outflowMinor, effective);
  if (!dip.needsConfirm) return;
  const opportunityOk = dip.dipsOpportunityMinor === 0 || draft.confirmOpportunity === true;
  const emergencyOk = dip.dipsEmergencyMinor === 0 || draft.confirmEmergency === true;
  if (!opportunityOk || !emergencyOk) {
    const warnings: ActionWarning[] = [];
    if (dip.dipsOpportunityMinor > 0)
      warnings.push(warn("DIPS_INTO_OPPORTUNITY", dip.dipsOpportunityMinor));
    if (dip.dipsEmergencyMinor > 0)
      warnings.push(warn("DIPS_INTO_EMERGENCY", dip.dipsEmergencyMinor));
    throw new AppError(
      "NEEDS_CONFIRMATION",
      `This is more than the free cash in "${from.name}" and uses earmarked money. Confirm to continue.`,
      undefined,
      { warnings },
    );
  }
  await storeBucketAmounts(ctx, from, earmarksAfterDip(effective, dip), "earmark_dip", session);
}

const SPLIT_MESSAGES = {
  too_few_lines: "A split needs at least two lines",
  non_positive_line: "Every split line needs an amount above zero",
  sum_mismatch: "Split lines must add up to the total",
  duplicate_category: "Use each category once per split",
} as const;

const fail = (field: string, message: string): never => {
  throw new AppError("VALIDATION", message, { [field]: [message] });
};

async function loadAccount(
  ctx: Ctx,
  id: string,
  field: string,
  date: Date,
  session: ClientSession,
): Promise<AccountDoc> {
  const account = await AccountModel.findOne({
    _id: toObjectId(id, "Account"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session)
    .lean<AccountDoc>();
  if (!account) return fail(field, "Account not found");
  if (account.archivedAt) return fail(field, `"${account.name}" is archived`);
  if (utcToBusinessDate(date, ctx.tz) < utcToBusinessDate(account.openingDate, ctx.tz)) {
    fail("date", `Date is before "${account.name}" was opened (its opening balance date)`);
  }
  return account;
}

async function loadHolding(ctx: Ctx, id: string, session: ClientSession): Promise<HoldingDoc> {
  const holding = await HoldingModel.findOne({
    _id: toObjectId(id, "Holding"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session)
    .lean<HoldingDoc>();
  if (!holding) return fail("holdingId", "Holding not found");
  if (holding.status === "closed") return fail("holdingId", `"${holding.name}" is closed`);
  return holding;
}

/** Major-unit exchange rate implied by a cross-currency transfer (quote per 1 source unit). */
function impliedRate(amountMinor: number, fromCcy: string, toAmountMinor: number, toCcy: string) {
  const from = amountMinor / 10 ** minorUnitDigits(fromCcy);
  const to = toAmountMinor / 10 ** minorUnitDigits(toCcy);
  return Number((to / from).toPrecision(12));
}

function sameCurrency(account: AccountDoc, holding: HoldingDoc, field: string) {
  if (account.currency !== holding.currency) {
    fail(
      field,
      `"${account.name}" is in ${account.currency} but "${holding.name}" is in ${holding.currency}; use a ${holding.currency} account (cross-currency arrives with FX rates)`,
    );
  }
}

/**
 * Validates references and posts one transaction, then recomputes the accounts and holding it
 * touches. Must run inside `withTransaction` — every write uses `session`.
 */
export async function postTransaction(
  ctx: Ctx,
  draft: LedgerDraft,
  session: ClientSession,
): Promise<TransactionDoc> {
  const userId = toObjectId(ctx.userId, "User");
  const t = draft.type;
  const fee = draft.feeMinor ?? 0;
  const tax = draft.taxMinor ?? 0;
  const needsFrom = t === "expense" || t === "transfer" || t === "invest";
  const needsTo =
    t === "income" ||
    t === "transfer" ||
    t === "redeem" ||
    (t === "investment_income" && !draft.reinvest);
  const needsHolding =
    t === "invest" || t === "redeem" || t === "investment_income" || t === "opening_balance";
  if (needsFrom && !draft.fromAccountId) fail("fromAccountId", "Choose an account");
  if (needsTo && !draft.toAccountId) fail("toAccountId", "Choose an account");
  if (needsHolding && !draft.holdingId) fail("holdingId", "Choose a holding");
  if (t === "adjustment" && Boolean(draft.fromAccountId) === Boolean(draft.toAccountId)) {
    throw new AppError("VALIDATION", "An adjustment touches exactly one account");
  }
  if (t === "transfer" && draft.fromAccountId === draft.toAccountId) {
    fail("toAccountId", "Choose a different account");
  }
  for (const [field, v] of [
    ["feeMinor", fee],
    ["taxMinor", tax],
  ] as const) {
    if (!Number.isSafeInteger(v) || v < 0) fail(field, "Cannot be negative");
  }

  const from =
    needsFrom || (t === "adjustment" && draft.fromAccountId)
      ? await loadAccount(ctx, draft.fromAccountId!, "fromAccountId", draft.date, session)
      : null;
  const to =
    needsTo || (t === "adjustment" && draft.toAccountId)
      ? await loadAccount(ctx, draft.toAccountId!, "toAccountId", draft.date, session)
      : null;
  const holding = needsHolding ? await loadHolding(ctx, draft.holdingId!, session) : null;

  let amountMinor = draft.amountMinor;
  let units = draft.units ?? null;
  let priceMinorE4 = draft.priceMinorE4 ?? null;
  if (units !== null && (!Number.isFinite(units) || units <= 0))
    fail("units", "Enter units above zero");
  if (priceMinorE4 !== null && (!Number.isSafeInteger(priceMinorE4) || priceMinorE4 <= 0)) {
    fail("priceMinorE4", "Enter a price above zero");
  }

  if (holding) {
    if (from) sameCurrency(from, holding, "fromAccountId");
    if (to) sameCurrency(to, holding, "toAccountId");
    const dateKey = utcToBusinessDate(draft.date, ctx.tz);

    if (t === "invest" && holding.trackUnits) {
      // Derive the missing one of units / price from the amount.
      if (units === null && priceMinorE4)
        units = roundUnits((amountMinor * PRICE_SCALE) / priceMinorE4);
      if (priceMinorE4 === null && units)
        priceMinorE4 = Math.round((amountMinor * PRICE_SCALE) / units);
    }
    if (!holding.trackUnits && t !== "redeem") {
      units = null;
      priceMinorE4 = null;
    }

    if (t === "redeem") {
      const state = await holdingStateAsOf(ctx, holding, dateKey, session);
      if (state.currentValueMinor <= 0) {
        fail("amountMinor", `"${holding.name}" has no value on that date; update its value first`);
      }
      try {
        if (holding.trackUnits && units !== null) {
          const price = priceMinorE4 ?? state.lastPriceMinorE4;
          if (!price) fail("priceMinorE4", "Enter the price per unit");
          if (state.units === null || state.units <= 0) fail("units", "No units held on that date");
          priceMinorE4 = price;
          amountMinor = redeemByUnits({
            investedMinor: state.investedMinor,
            currentValueMinor: state.currentValueMinor,
            unitsHeld: state.units!,
            unitsSold: units,
            priceMinorE4: price!,
            feeMinor: fee,
            taxMinor: tax,
          }).amountMinor;
        } else {
          units = null;
          redeemByAmount({
            investedMinor: state.investedMinor,
            currentValueMinor: state.currentValueMinor,
            amountMinor,
            feeMinor: fee,
            taxMinor: tax,
          });
        }
      } catch (err) {
        if (err instanceof RangeError) fail(units !== null ? "units" : "amountMinor", err.message);
        throw err;
      }
    }
  }

  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    fail("amountMinor", "Enter an amount above zero");
  }
  if (t === "investment_income" && tax > amountMinor)
    fail("taxMinor", "Tax cannot exceed the amount");

  const currency = holding?.currency ?? (from ?? to)!.currency;

  let toAmountMinor: number | null = null;
  let fxRate: number | null = null;
  if (t === "transfer" && from && to && from.currency !== to.currency) {
    if (!draft.toAmountMinor || draft.toAmountMinor <= 0) {
      fail("toAmountMinor", `Enter the amount received in ${to.currency}`);
    }
    toAmountMinor = draft.toAmountMinor!;
    fxRate = impliedRate(amountMinor, from.currency, toAmountMinor, to.currency);
  }

  let categoryId: Types.ObjectId | null = null;
  const splits: { categoryId: Types.ObjectId; amountMinor: number; note: string | null }[] = [];
  if (t === "income") {
    if (!draft.categoryId) fail("categoryId", "Choose a category");
    categoryId = (await assertUsableCategory(ctx, draft.categoryId!, "income", session))._id;
  } else if (t === "expense") {
    const hasSplits = Boolean(draft.splits?.length);
    if (hasSplits === Boolean(draft.categoryId)) {
      fail("categoryId", "Choose a category or split the amount");
    }
    if (hasSplits) {
      const error = validateSplits(amountMinor, draft.splits!);
      if (error) fail("splits", SPLIT_MESSAGES[error]);
      for (const s of draft.splits!) {
        const cat = await assertUsableCategory(ctx, s.categoryId, "expense", session);
        splits.push({ categoryId: cat._id, amountMinor: s.amountMinor, note: s.note ?? null });
      }
    } else {
      categoryId = (await assertUsableCategory(ctx, draft.categoryId!, "expense", session))._id;
    }
  } else if (t === "adjustment") {
    categoryId = await getSystemCategoryId(
      ctx,
      SYSTEM_CATEGORY.balanceAdjustment,
      "expense",
      session,
    );
  } else if (t === "investment_income") {
    categoryId = await getSystemCategoryId(
      ctx,
      SYSTEM_CATEGORY.investmentIncome,
      "income",
      session,
    );
  } else if (t === "transfer" && fee > 0) {
    // The fee is an expense; tag it so spending by category shows it (docs/04 §4).
    categoryId = await getSystemCategoryId(ctx, SYSTEM_CATEGORY.bankFees, "expense", session);
  }

  if (from && t !== "adjustment") {
    await guardOutflow(
      ctx,
      from,
      guardedOutflow({ type: t, amountMinor, feeMinor: fee }),
      draft,
      session,
    );
  }

  const [doc] = await TransactionModel.create(
    [
      {
        userId,
        type: t,
        date: draft.date,
        amountMinor,
        currency,
        fromAccountId: from?._id ?? null,
        toAccountId: to?._id ?? null,
        toAmountMinor,
        fxRate,
        categoryId,
        splits,
        holdingId: holding?._id ?? null,
        units,
        priceMinorE4,
        feeMinor: t === "invest" || t === "redeem" || t === "transfer" ? fee : 0,
        taxMinor: t === "redeem" || t === "investment_income" ? tax : 0,
        incomeKind: t === "investment_income" ? (draft.incomeKind ?? "other") : null,
        reinvest: t === "investment_income" ? Boolean(draft.reinvest) : null,
        description: draft.description || null,
        counterparty: draft.counterparty || null,
        notes: draft.notes || null,
        tags: draft.tags ?? [],
        source: { kind: draft.source?.kind ?? "manual", refId: draft.source?.refId ?? null },
        groupId: draft.groupId ?? null,
        status: "posted",
      },
    ],
    { session },
  );
  let txn = doc!.toObject() as TransactionDoc;

  await recomputeAccounts(userId, [txn.fromAccountId, txn.toAccountId], session);
  if (holding) {
    await recomputeHolding(ctx, holding._id, session);
    // Redemption figures are filled in by the replay.
    if (t === "redeem") {
      txn = (await TransactionModel.findOne({ _id: txn._id, userId })
        .session(session)
        .lean<TransactionDoc>())!;
    }
  }
  await writeAudit(
    { userId: ctx.userId, action: "post", entity: "transaction", entityId: txn._id, after: txn },
    session,
  );
  return txn;
}
