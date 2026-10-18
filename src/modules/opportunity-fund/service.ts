import "server-only";
import { Types, type ClientSession } from "mongoose";
import { splitByTree, type AllocationTree } from "@/domain/allocation";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { dedicatedBucket } from "@/domain/earmarks";
import {
  DEFAULT_RULES,
  replayCycle,
  suggestedDeployment,
  type CycleState,
} from "@/domain/opportunity";
import { formatMoney } from "@/lib/format";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { AssetClassModel, type AssetClassDoc } from "@/modules/asset-classes/model";
import { assertValidTree, getTarget, treeFromDoc, treeToDoc } from "@/modules/allocation/service";
import {
  effectiveEarmarksOf,
  getBucketsInBase,
  storeBucketAmounts,
} from "@/modules/earmarks/service";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import {
  MarketLevelModel,
  OpportunityDeploymentModel,
  OpportunityFundModel,
  type DeploymentLineDoc,
  type MarketLevelDoc,
  type OpportunityDeploymentDoc,
  type OpportunityFundDoc,
} from "@/modules/opportunity-fund/model";
import {
  fundSettingsSchema,
  marketLevelSchema,
  previewDeploymentSchema,
  recordDeploymentSchema,
  type DeploymentDTO,
  type DeploymentPreviewLine,
  type OpportunityOverviewDTO,
  type SourceAccountDTO,
} from "@/modules/opportunity-fund/schemas";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { postTransaction } from "@/server/ledger/post";
import { voidTransaction } from "@/server/ledger/void";

// docs/04 §15 + §20 — Opportunity Fund: fund balance = opportunity bucket; market levels drive the
// cycle (replayed); rules suggest cumulative deployments; a deployment posts invest lines from an
// account holding opportunity money and reduces its opportunity earmark, all in one DB transaction.

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");

async function loadFund(
  ctx: Ctx,
  session: ClientSession | null = null,
): Promise<OpportunityFundDoc> {
  const userId = uid(ctx);
  const existing = await OpportunityFundModel.findOne({ userId })
    .session(session)
    .lean<OpportunityFundDoc>();
  if (existing) return existing;
  // Created on first use with the docs/04 example rules; upsert keeps concurrent first reads safe.
  await OpportunityFundModel.updateOne(
    { userId },
    {
      $setOnInsert: {
        userId,
        benchmarkName: "ASPI",
        targetSizeMinor: null,
        rules: DEFAULT_RULES.map((r) => ({ ...r })),
        allocationSource: "target",
        allocation: [],
        defaultSourceAccountId: null,
        cycle: { startedAt: null, fundBalanceAtStartMinor: 0 },
      },
    },
    { upsert: true, session: session ?? undefined },
  );
  return (await OpportunityFundModel.findOne({ userId })
    .session(session)
    .lean<OpportunityFundDoc>())!;
}

async function loadLevels(ctx: Ctx, benchmarkName: string, session: ClientSession | null = null) {
  return MarketLevelModel.find({ userId: uid(ctx), benchmarkName })
    .sort({ date: 1 })
    .session(session)
    .lean<MarketLevelDoc[]>();
}

async function fundBalance(ctx: Ctx): Promise<{ balanceMinor: number; fxMissing: number }> {
  const b = await getBucketsInBase(ctx);
  return { balanceMinor: b.opportunityMinor, fxMissing: b.fxMissing };
}

/**
 * Keeps the stored cycle in step with the replayed one: when the replay opens a new cycle (first
 * level or a new high), the current fund balance becomes `fundBalanceAtStart` (docs/04 §15).
 */
async function syncCycle(
  ctx: Ctx,
  fund: OpportunityFundDoc,
  state: CycleState,
  balanceMinor: number,
  session: ClientSession | null = null,
): Promise<OpportunityFundDoc["cycle"]> {
  if (state.cycleStart === fund.cycle.startedAt) return fund.cycle;
  const cycle = { startedAt: state.cycleStart, fundBalanceAtStartMinor: Math.max(0, balanceMinor) };
  await OpportunityFundModel.updateOne(
    { _id: fund._id, userId: fund.userId },
    { $set: { cycle } },
    { session: session ?? undefined },
  );
  await writeAudit(
    {
      userId: ctx.userId,
      action: "new_cycle",
      entity: "opportunityFund",
      entityId: fund._id,
      before: fund.cycle,
      after: cycle,
    },
    session ?? undefined,
  );
  return cycle;
}

async function deployedInCycle(
  ctx: Ctx,
  cycleStart: string | null,
  session: ClientSession | null = null,
) {
  if (!cycleStart) return 0;
  const docs = await OpportunityDeploymentModel.find({
    userId: uid(ctx),
    status: "posted",
    cycleStartedAt: cycleStart,
  })
    .select({ amountMinor: 1 })
    .session(session)
    .lean<{ amountMinor: number }[]>();
  return docs.reduce((s, d) => s + d.amountMinor, 0);
}

async function allocationInUse(
  ctx: Ctx,
  fund: OpportunityFundDoc,
  session?: ClientSession,
): Promise<AllocationTree> {
  return fund.allocationSource === "custom"
    ? treeFromDoc(fund.allocation)
    : (await getTarget(ctx, session)).allocation;
}

/** Accounts holding opportunity money: Opportunity Fund accounts and earmarked accounts. */
async function sourceAccounts(
  ctx: Ctx,
  session: ClientSession | null = null,
): Promise<{ doc: AccountDoc; dto: SourceAccountDTO }[]> {
  const accounts = await AccountModel.find({ userId: uid(ctx), archivedAt: null })
    .session(session)
    .lean<AccountDoc[]>();
  const out: { doc: AccountDoc; dto: SourceAccountDTO }[] = [];
  for (const a of accounts) {
    const dedicated = dedicatedBucket(a);
    if (dedicated === "emergency") continue;
    let opportunityMinor = 0;
    if (dedicated === "opportunity") opportunityMinor = Math.max(0, a.balanceMinor);
    else
      opportunityMinor = (await effectiveEarmarksOf(a, session as ClientSession)).opportunityMinor;
    if (opportunityMinor <= 0) continue;
    out.push({
      doc: a,
      dto: {
        id: String(a._id),
        name: a.name,
        currency: a.currency,
        opportunityMinor,
        dedicated: dedicated === "opportunity",
      },
    });
  }
  return out.sort((x, y) => y.dto.opportunityMinor - x.dto.opportunityMinor);
}

function toDeploymentDTO(
  d: OpportunityDeploymentDoc,
  names: {
    accounts: Map<string, string>;
    holdings: Map<string, string>;
    classes: Map<string, string>;
  },
): DeploymentDTO {
  return {
    id: String(d._id),
    date: d.date,
    amountMinor: d.amountMinor,
    feeMinor: d.lines.reduce((s, l) => s + l.feeMinor, 0),
    currency: d.currency,
    sourceAccount: names.accounts.get(String(d.sourceAccountId)) ?? "Unknown account",
    ruleIdx: d.ruleIdx,
    drawdownBpAtDeploy: d.drawdownBpAtDeploy,
    marketLevel: d.marketLevel,
    lines: d.lines.map((l) => ({
      holding: names.holdings.get(String(l.holdingId)) ?? "Unknown holding",
      assetClass: names.classes.get(String(l.assetClassId)) ?? "",
      amountMinor: l.amountMinor,
      feeMinor: l.feeMinor,
    })),
    status: d.status,
    notes: d.notes,
  };
}

/** Everything the Opportunity Fund page needs; also brings the stored cycle up to date. */
export async function getOpportunityOverview(ctx: Ctx): Promise<OpportunityOverviewDTO> {
  await connectDb();
  const fund = await loadFund(ctx);
  const [levels, balance] = await Promise.all([
    loadLevels(ctx, fund.benchmarkName),
    fundBalance(ctx),
  ]);
  const state = replayCycle(levels, fund.rules);
  const cycle = await syncCycle(ctx, fund, state, balance.balanceMinor);
  const deployed = await deployedInCycle(ctx, cycle.startedAt);
  const userId = uid(ctx);
  const [sources, deployments, accounts, holdings, classes, allocation] = await Promise.all([
    sourceAccounts(ctx),
    OpportunityDeploymentModel.find({ userId })
      .sort({ date: -1, createdAt: -1 })
      .limit(50)
      .lean<OpportunityDeploymentDoc[]>(),
    AccountModel.find({ userId }).select({ name: 1 }).lean<Pick<AccountDoc, "_id" | "name">[]>(),
    HoldingModel.find({ userId }).select({ name: 1 }).lean<Pick<HoldingDoc, "_id" | "name">[]>(),
    AssetClassModel.find({ userId })
      .select({ name: 1 })
      .lean<Pick<AssetClassDoc, "_id" | "name">[]>(),
    allocationInUse(ctx, fund),
  ]);
  const names = {
    accounts: new Map(accounts.map((a) => [String(a._id), a.name])),
    holdings: new Map(holdings.map((h) => [String(h._id), h.name])),
    classes: new Map(classes.map((c) => [String(c._id), c.name])),
  };
  return {
    baseCurrency: ctx.baseCurrency,
    todayKey: utcToBusinessDate(new Date(), ctx.tz),
    settings: {
      benchmarkName: fund.benchmarkName,
      targetSizeMinor: fund.targetSizeMinor,
      rules: fund.rules.map((r) => ({
        drawdownBp: r.drawdownBp,
        deployPercentBp: r.deployPercentBp,
      })),
      allocationSource: fund.allocationSource,
      allocation: treeFromDoc(fund.allocation),
      defaultSourceAccountId: fund.defaultSourceAccountId
        ? String(fund.defaultSourceAccountId)
        : null,
    },
    fundBalanceMinor: balance.balanceMinor,
    fxMissing: balance.fxMissing,
    cycle: {
      startedAt: cycle.startedAt,
      fundBalanceAtStartMinor: cycle.fundBalanceAtStartMinor,
      referenceHigh: state.referenceHigh,
      referenceHighDate: state.referenceHighDate,
      latest: state.latest,
      drawdownBp: state.drawdownBp,
      maxDrawdownBp: state.maxDrawdownBp,
      triggered: state.triggered,
      deployedThisCycleMinor: deployed,
    },
    suggestion: suggestedDeployment({
      rules: fund.rules,
      triggered: state.triggered,
      fundBalanceAtStartMinor: cycle.fundBalanceAtStartMinor,
      deployedThisCycleMinor: deployed,
      fundBalanceMinor: balance.balanceMinor,
    }),
    levels: levels.map((l) => ({ id: String(l._id), date: l.date, level: l.level, note: l.note })),
    sources: sources.map((s) => s.dto),
    deployments: deployments.map((d) => toDeploymentDTO(d, names)),
    allocationInUse: allocation,
  };
}

/**
 * Trigger detection for the daily job (Phase 10 notifications, docs/04 §19): the rules triggered in
 * the current cycle with their dedupe keys `opp:<cycleStart>:<ruleIdx>`.
 */
export async function detectOpportunityTriggers(
  ctx: Ctx,
): Promise<{ ruleIdx: number; drawdownBp: number; dedupeKey: string }[]> {
  await connectDb();
  const fund = await loadFund(ctx);
  const state = replayCycle(await loadLevels(ctx, fund.benchmarkName), fund.rules);
  await syncCycle(ctx, fund, state, (await fundBalance(ctx)).balanceMinor);
  return state.triggered.map((i) => ({
    ruleIdx: i,
    drawdownBp: fund.rules[i]!.drawdownBp,
    dedupeKey: `opp:${state.cycleStart}:${i}`,
  }));
}

// ------------------------------------------------------------------------------- settings

export async function saveFundSettings(ctx: Ctx, input: unknown): Promise<{ saved: true }> {
  const data = parseInput(fundSettingsSchema, input);
  return withTransaction(async (session) => {
    const fund = await loadFund(ctx, session);
    const allocation = data.allocationSource === "custom" ? (data.allocation ?? []) : [];
    if (data.allocationSource === "custom")
      await assertValidTree(ctx, allocation, { requireAssets: true, session });
    if (data.defaultSourceAccountId) {
      const a = await AccountModel.exists({
        _id: toObjectId(data.defaultSourceAccountId, "Account"),
        userId: uid(ctx),
      }).session(session);
      if (!a)
        throw new AppError("VALIDATION", "Account not found", {
          defaultSourceAccountId: ["Account not found"],
        });
    }
    const $set = {
      benchmarkName: data.benchmarkName,
      targetSizeMinor: data.targetSizeMinor,
      rules: data.rules,
      allocationSource: data.allocationSource,
      allocation: treeToDoc(allocation),
      defaultSourceAccountId: data.defaultSourceAccountId
        ? new Types.ObjectId(data.defaultSourceAccountId)
        : null,
    };
    await OpportunityFundModel.updateOne(
      { _id: fund._id, userId: fund.userId },
      { $set },
      { session },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "update",
        entity: "opportunityFund",
        entityId: fund._id,
        after: data,
      },
      session,
    );
    return { saved: true };
  });
}

// --------------------------------------------------------------------------- market levels

/** Adds (or replaces, same date) a benchmark level and updates the cycle. */
export async function addMarketLevel(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const data = parseInput(marketLevelSchema, input);
  if (data.date > utcToBusinessDate(new Date(), ctx.tz)) {
    throw new AppError("VALIDATION", "A level cannot be in the future", {
      date: ["Pick today or earlier"],
    });
  }
  const balance = (await fundBalance(ctx)).balanceMinor;
  return withTransaction(async (session) => {
    const fund = await loadFund(ctx, session);
    const userId = uid(ctx);
    const doc = await MarketLevelModel.findOneAndUpdate(
      { userId, benchmarkName: fund.benchmarkName, date: data.date },
      { $set: { level: data.level, note: data.note ?? null } },
      { upsert: true, new: true, session },
    ).lean<MarketLevelDoc>();
    const state = replayCycle(await loadLevels(ctx, fund.benchmarkName, session), fund.rules);
    await syncCycle(ctx, fund, state, balance, session);
    return { id: String(doc!._id) };
  });
}

export async function deleteMarketLevel(ctx: Ctx, id: string): Promise<{ id: string }> {
  const balance = (await fundBalance(ctx)).balanceMinor;
  return withTransaction(async (session) => {
    const fund = await loadFund(ctx, session);
    const removed = await MarketLevelModel.findOneAndDelete(
      { _id: toObjectId(id, "Level"), userId: uid(ctx) },
      { session },
    );
    if (!removed) throw new AppError("NOT_FOUND", "Level not found");
    const state = replayCycle(await loadLevels(ctx, fund.benchmarkName, session), fund.rules);
    await syncCycle(ctx, fund, state, balance, session);
    return { id };
  });
}

// ----------------------------------------------------------------------------- deployment

/** Splits an amount by the allocation in use (largest remainder; lines sum exactly). */
export async function previewDeployment(
  ctx: Ctx,
  input: unknown,
): Promise<DeploymentPreviewLine[]> {
  const { amountMinor } = parseInput(previewDeploymentSchema, input);
  await connectDb();
  const tree = await allocationInUse(ctx, await loadFund(ctx));
  if (!tree.length) {
    throw new AppError(
      "VALIDATION",
      "Set the target allocation (or a custom one for the fund) first",
    );
  }
  return splitByTree(amountMinor, tree);
}

/**
 * Record deployment (one DB transaction, docs/04 §15): checks the source account holds enough
 * opportunity money for amounts + fees, posts one `invest` per line (source opportunity_deployment,
 * shared groupId, no dip guard), reduces the account's opportunity earmark by the cash that left
 * (not for a dedicated Opportunity Fund account) and saves the deployment.
 */
export async function recordDeployment(ctx: Ctx, input: unknown): Promise<DeploymentDTO> {
  const data = parseInput(recordDeploymentSchema, input);
  if (data.date > utcToBusinessDate(new Date(), ctx.tz)) {
    throw new AppError("VALIDATION", "A deployment cannot be in the future", {
      date: ["Pick today or earlier"],
    });
  }
  const balance = (await fundBalance(ctx)).balanceMinor;
  return withTransaction(async (session) => {
    const userId = uid(ctx);
    const fund = await loadFund(ctx, session);
    const sources = await sourceAccounts(ctx, session);
    const source = sources.find((s) => s.dto.id === data.sourceAccountId);
    if (!source) {
      throw new AppError("VALIDATION", "Choose an account that holds opportunity money", {
        sourceAccountId: ["No opportunity money on this account"],
      });
    }
    const lines = data.lines.filter((l) => l.amountMinor > 0);
    const holdingIds = lines.map((l) => l.holdingId).filter((v): v is string => Boolean(v));
    const holdings = new Map(
      (
        await HoldingModel.find({
          userId,
          _id: { $in: holdingIds.map((h) => new Types.ObjectId(h)) },
        })
          .session(session)
          .lean<HoldingDoc[]>()
      ).map((h) => [String(h._id), h]),
    );
    lines.forEach((l) => {
      const field = `lines.${data.lines.indexOf(l)}.holdingId`;
      const h = l.holdingId ? holdings.get(l.holdingId) : undefined;
      if (!h)
        throw new AppError("VALIDATION", "Choose a holding for every line you invest in", {
          [field]: ["Choose a holding"],
        });
      if (h.status !== "active")
        throw new AppError("VALIDATION", `"${h.name}" is closed`, { [field]: ["Closed holding"] });
      if (String(h.assetClassId) !== l.assetClassId) {
        throw new AppError("VALIDATION", `"${h.name}" is in another asset class`, {
          [field]: ["Wrong class"],
        });
      }
      if (h.currency !== source.doc.currency) {
        throw new AppError(
          "VALIDATION",
          `"${h.name}" is in ${h.currency}; "${source.doc.name}" is in ${source.doc.currency}`,
          {
            [field]: ["Different currency"],
          },
        );
      }
    });
    const amountMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
    const outflow = lines.reduce((s, l) => s + l.amountMinor + l.feeMinor, 0);
    if (outflow > source.dto.opportunityMinor) {
      throw new AppError(
        "VALIDATION",
        `"${source.doc.name}" holds ${formatMoney(source.dto.opportunityMinor, source.doc.currency)} of opportunity money; this deployment needs ${formatMoney(outflow, source.doc.currency)} (amounts + fees)`,
        { sourceAccountId: ["Not enough opportunity money"] },
      );
    }

    // Cycle context at the moment of deploying.
    const state = replayCycle(await loadLevels(ctx, fund.benchmarkName, session), fund.rules);
    const cycle = await syncCycle(ctx, fund, state, balance, session);
    const deployedBefore = await deployedInCycle(ctx, cycle.startedAt, session);
    const suggestion = suggestedDeployment({
      rules: fund.rules,
      triggered: state.triggered,
      fundBalanceAtStartMinor: cycle.fundBalanceAtStartMinor,
      deployedThisCycleMinor: deployedBefore,
      fundBalanceMinor: balance,
    });

    const groupId = new Types.ObjectId();
    const postedLines: DeploymentLineDoc[] = [];
    for (const l of lines) {
      const txn = await postTransaction(
        ctx,
        {
          type: "invest",
          date: businessDateToUtc(data.date, ctx.tz),
          amountMinor: l.amountMinor,
          feeMinor: l.feeMinor,
          fromAccountId: data.sourceAccountId,
          holdingId: l.holdingId!,
          description: `Opportunity deployment${state.drawdownBp ? ` · −${(state.drawdownBp / 100).toFixed(1)}%` : ""}`,
          source: { kind: "opportunity_deployment", refId: groupId },
          groupId,
        },
        session,
      );
      postedLines.push({
        assetClassId: new Types.ObjectId(l.assetClassId),
        holdingId: new Types.ObjectId(l.holdingId!),
        amountMinor: l.amountMinor,
        feeMinor: l.feeMinor,
        transactionId: txn._id,
      });
    }

    // Earmark: the cash that left is no longer opportunity money (dedicated accounts need nothing).
    let earmarkReducedMinor = 0;
    if (!source.dto.dedicated) {
      earmarkReducedMinor = Math.min(outflow, source.dto.opportunityMinor);
      const account = (await AccountModel.findOne({ _id: source.doc._id, userId })
        .session(session)
        .lean<AccountDoc>())!;
      await storeBucketAmounts(
        ctx,
        account,
        {
          emergencyMinor: null,
          opportunityMinor: source.dto.opportunityMinor - earmarkReducedMinor,
        },
        "opportunity_deployment",
        session,
      );
    }

    const [doc] = await OpportunityDeploymentModel.create(
      [
        {
          userId,
          date: data.date,
          amountMinor,
          currency: source.doc.currency,
          sourceAccountId: source.doc._id,
          ruleIdx: suggestion.ruleIdx,
          drawdownBpAtDeploy: state.drawdownBp,
          marketLevel: state.latest?.level ?? null,
          cycleStartedAt: cycle.startedAt,
          allocationUsed: treeToDoc(await allocationInUse(ctx, fund, session)),
          lines: postedLines,
          earmarkReducedMinor,
          groupId,
          notes: data.notes ?? null,
          status: "posted",
        },
      ],
      { session },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "deploy",
        entity: "opportunityDeployment",
        entityId: doc!._id,
        after: { amountMinor, outflow },
      },
      session,
    );
    const holdingNames = new Map([...holdings.values()].map((h) => [String(h._id), h.name]));
    return toDeploymentDTO(doc!.toObject() as OpportunityDeploymentDoc, {
      accounts: new Map([[String(source.doc._id), source.doc.name]]),
      holdings: holdingNames,
      classes: new Map(),
    });
  });
}

/** Undo: voids the deployment's transactions through their owner and restores the earmark it took. */
export async function undoDeployment(ctx: Ctx, id: string): Promise<{ id: string }> {
  return withTransaction(async (session) => {
    const userId = uid(ctx);
    const d = await OpportunityDeploymentModel.findOne({
      _id: toObjectId(id, "Deployment"),
      userId,
    })
      .session(session)
      .lean<OpportunityDeploymentDoc>();
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found");
    if (d.status !== "posted") throw new AppError("CONFLICT", "This deployment was already undone");
    const txns = await TransactionModel.find({ userId, groupId: d.groupId, status: "posted" })
      .session(session)
      .lean<TransactionDoc[]>();
    for (const t of txns) {
      await voidTransaction(ctx, String(t._id), "Opportunity deployment undone", session, {
        viaOwner: true,
      });
    }
    if (d.earmarkReducedMinor > 0) {
      const account = await AccountModel.findOne({ _id: d.sourceAccountId, userId })
        .session(session)
        .lean<AccountDoc>();
      if (account && !dedicatedBucket(account)) {
        const effective = await effectiveEarmarksOf(account, session);
        await storeBucketAmounts(
          ctx,
          account,
          {
            emergencyMinor: null,
            opportunityMinor: effective.opportunityMinor + d.earmarkReducedMinor,
          },
          "opportunity_deployment_undone",
          session,
        );
      }
    }
    await OpportunityDeploymentModel.updateOne(
      { _id: d._id, userId },
      { $set: { status: "undone", undoneAt: new Date() } },
      { session },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "undo",
        entity: "opportunityDeployment",
        entityId: d._id,
        before: { status: "posted" },
      },
      session,
    );
    return { id };
  });
}
