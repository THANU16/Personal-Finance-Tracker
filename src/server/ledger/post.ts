import "server-only";
import type { ClientSession, Types } from "mongoose";
import { minorUnitDigits } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import {
  canCarryEarmarks,
  dedicatedBucket,
  dipCheck,
  earmarksAfterBucketReceive,
  earmarksAfterBucketSpend,
  earmarksAfterDip,
  isEarmarkable,
  type Bucket,
} from "@/domain/earmarks";
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
import { recomputeDebt } from "@/server/ledger/debt";
import type { Ctx } from "@/server/ctx";
import { toObjectId } from "@/server/db/ids";
import { AppError, type ActionWarning } from "@/server/errors";
import { holdingStateAsOf, recomputeAccounts, recomputeHolding } from "@/server/ledger/recompute";

/** Ledger types that can be posted. */
export type PostableType =
  | "debt_payment"
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
  /** debt_payment: the debt (its loan account is `toAccountId`) and the server-computed split. */
  debtId?: Types.ObjectId | null;
  principalMinor?: number | null;
  interestMinor?: number | null;
  /**
   * Optional bucket tags (owner request; default null = free cash). fromBucket: an expense, transfer
   * or loan payment is paid from that earmark of the source account. toBucket: income or a transfer
   * arrives into that earmark of the destination. Only for accounts that can carry earmarks.
   */
  fromBucket?: Bucket | null;
  toBucket?: Bucket | null;
  /** Dip guard confirmations (docs/04 §20). Emergency money needs its own flag. */
  confirmOpportunity?: boolean;
  confirmEmergency?: boolean;
  /** Edit (void + repost): the voided original, so only an increase on the same account is guarded. */
  replaces?: { fromAccountId: string; outflowMinor: number } | null;
  /**
   * Internal: the caller already ran the dip guard for a group of postings (SIP execution checks
   * the total once). Never set from user input — the transaction schemas don't carry it.
   */
  dipGuardDone?: boolean;
  /**
   * Internal: one leg of an asset → asset switch (redeem without a destination account, invest
   * without a source account). Never set from user input.
   */
  switchLeg?: boolean;
}

/** Sources that move earmarked money on purpose and are never guarded (docs/04 §20). */
const UNGUARDED_SOURCES: readonly SourceKind[] = [
  "opportunity_deployment",
  "fd_maturity",
  "reconcile",
  "import",
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

/** A bucket tag needs an account that can carry earmarks (dedicated accounts are one bucket already). */
function bucketAccount(account: AccountDoc, bucket: Bucket, field: string): void {
  const dedicated = dedicatedBucket(account);
  if (dedicated) {
    fail(field, `"${account.name}" is all ${dedicated} money already; leave the bucket empty`);
  }
  if (!canCarryEarmarks(account)) {
    fail(
      field,
      `"${account.name}" cannot hold ${bucket} money (bank, cash, wallet or broker cash only)`,
    );
  }
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
 * Dip guard for a multi-posting operation (SIP execution): checks the TOTAL outflow from one
 * account once; on confirmation reduces earmarks once. The postings then set `dipGuardDone`.
 */
export async function guardGroupOutflow(
  ctx: Ctx,
  accountId: string,
  outflowMinor: number,
  opts: { source: SourceKind; confirmOpportunity?: boolean; confirmEmergency?: boolean },
  session: ClientSession,
): Promise<void> {
  const account = await AccountModel.findOne({
    _id: toObjectId(accountId, "Account"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session)
    .lean<AccountDoc>();
  if (!account) throw new AppError("NOT_FOUND", "Account not found");
  await guardOutflow(
    ctx,
    account,
    outflowMinor,
    {
      type: "invest",
      date: new Date(),
      amountMinor: outflowMinor,
      source: { kind: opts.source },
      confirmOpportunity: opts.confirmOpportunity,
      confirmEmergency: opts.confirmEmergency,
    },
    session,
  );
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
  const needsFrom =
    t === "expense" ||
    t === "transfer" ||
    t === "debt_payment" ||
    (t === "invest" && !draft.switchLeg);
  const needsTo =
    t === "income" ||
    t === "transfer" ||
    t === "debt_payment" ||
    (t === "redeem" && !draft.switchLeg) ||
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
  if (t === "debt_payment") {
    const principal = draft.principalMinor ?? -1;
    const interest = draft.interestMinor ?? -1;
    if (!draft.debtId) fail("debtId", "Choose a loan");
    if (
      !Number.isSafeInteger(principal) ||
      principal < 0 ||
      !Number.isSafeInteger(interest) ||
      interest < 0
    ) {
      fail("amountMinor", "Invalid principal / interest split");
    }
    if (principal + interest !== draft.amountMinor)
      fail("amountMinor", "Principal + interest must equal the payment");
    if (draft.fromAccountId === draft.toAccountId)
      fail("fromAccountId", "Pay from another account");
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
  if (t === "debt_payment") {
    if (to!.type !== "loan") fail("toAccountId", `"${to!.name}" is not a loan account`);
    if (from!.currency !== to!.currency)
      fail("fromAccountId", `Pay "${to!.name}" from a ${to!.currency} account`);
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
  } else if (t === "debt_payment") {
    // Interest is an expense (docs/04 §4); the principal only reduces the loan.
    categoryId = await getSystemCategoryId(ctx, SYSTEM_CATEGORY.loanInterest, "expense", session);
  } else if (t === "transfer" && fee > 0) {
    // The fee is an expense; tag it so spending by category shows it (docs/04 §4).
    categoryId = await getSystemCategoryId(ctx, SYSTEM_CATEGORY.bankFees, "expense", session);
  }

  // Bucket tags (owner request): validate, then pay a tagged outflow from its earmark BEFORE the
  // dip guard (the earmark becomes free cash, so the guard passes without touching other buckets).
  const fromBucket = draft.fromBucket ?? null;
  const toBucket = draft.toBucket ?? null;
  if (fromBucket) {
    if (!(t === "expense" || t === "transfer" || t === "debt_payment") || !from) {
      fail("fromBucket", "Only money leaving an account can come from a bucket");
    }
    bucketAccount(from!, fromBucket, "fromBucket");
    const effective = await effectiveEarmarksOf(from!, session);
    const outflow = guardedOutflow({ type: t, amountMinor, feeMinor: fee });
    let amounts;
    try {
      amounts = earmarksAfterBucketSpend(effective, fromBucket, outflow);
    } catch {
      const have =
        fromBucket === "emergency" ? effective.emergencyMinor : effective.opportunityMinor;
      fail(
        "fromBucket",
        `"${from!.name}" has only ${formatMoney(have, from!.currency)} of ${fromBucket} money; pay the rest from free cash in a separate entry`,
      );
    }
    await storeBucketAmounts(ctx, from!, amounts!, "earmark_bucket_spend", session);
  }
  if (toBucket) {
    if (!(t === "income" || t === "transfer") || !to) {
      fail("toBucket", "Only money arriving in an account can go into a bucket");
    }
    bucketAccount(to!, toBucket, "toBucket");
  }

  if (from && t !== "adjustment" && !draft.dipGuardDone) {
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
        debtId: t === "debt_payment" ? draft.debtId : null,
        principalMinor: t === "debt_payment" ? draft.principalMinor : null,
        interestMinor: t === "debt_payment" ? draft.interestMinor : null,
        fromBucket,
        toBucket,
        status: "posted",
      },
    ],
    { session },
  );
  let txn = doc!.toObject() as TransactionDoc;

  await recomputeAccounts(userId, [txn.fromAccountId, txn.toAccountId], session);
  if (toBucket && to) {
    // After the balance moved: the arrival grows its earmark (capped at free cash).
    const fresh = (await AccountModel.findOne({ _id: to._id, userId })
      .session(session)
      .lean<AccountDoc>())!;
    const inflow = toAmountMinor ?? amountMinor;
    await storeBucketAmounts(
      ctx,
      fresh,
      earmarksAfterBucketReceive(await effectiveEarmarksOf(fresh, session), toBucket, inflow),
      "earmark_bucket_receive",
      session,
    );
  }
  if (txn.debtId) await recomputeDebt(ctx, txn.debtId, session);
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
