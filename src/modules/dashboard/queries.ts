import "server-only";
import { cache } from "react";
import type { PipelineStage } from "mongoose";
import { cardOutstandingMinor, nextMonthlyDate } from "@/domain/accounts";
import {
  bucketFlows,
  changeOf,
  flowTotals,
  runwayTenths,
  safeToSpend,
  type Change,
  type DailyFlow,
  type FlowPoint,
  type FlowTotals,
} from "@/domain/analytics";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import {
  buildBuckets,
  nextDayKey,
  previousPeriod,
  rangeDays,
  type Bucket,
  type KeyRange,
  type RangeView,
} from "@/domain/date-range";
import type { ToBase } from "@/domain/fx";
import { isStale } from "@/domain/holdings";
import { computeNetWorthSeries, type NetWorthPoint } from "@/domain/series";
import { AssetClassModel, type AssetClassDoc } from "@/modules/asset-classes/model";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { loadSeriesInput } from "@/modules/dashboard/series-input";
import { getBucketsInBase } from "@/modules/earmarks/service";
import { loadToBase } from "@/modules/fx/service";
import { getSettings } from "@/modules/settings/service";
import { listMonthEndSnapshots, type SnapshotPoint } from "@/modules/snapshots/service";
import { TransactionModel } from "@/modules/transactions/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { fdTerms } from "@/server/ledger/holding-events";

// docs/04 §2, §4, §21, §22 — ready-to-plot, gap-filled, base-currency series. No maths in components.

/** One request reads the ledger once, however many widgets ask (React cache per request). */
const seriesInput = cache(loadSeriesInput);
const toBaseOf = cache(loadToBase);

export const todayOf = (ctx: Ctx) => utcToBusinessDate(new Date(), ctx.tz);

function monthEndOf(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return utcToBusinessDate(new Date(Date.UTC(y, m, 0, 12)), "UTC");
}

// ------------------------------------------------------------------------------------- net worth

export interface NetWorthBucket {
  key: string;
  start: string;
  end: string;
  netWorthMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  holdingsValueMinor: number;
  investedMinor: number;
  /** Aligned previous-period closing net worth (compare on). */
  previousNetWorthMinor: number | null;
}

export interface NetWorthSeries {
  currency: string;
  points: NetWorthBucket[];
  /** Closing net worth vs the start of the range (or the previous period's close when comparing). */
  change: Change;
  fxMissing: number;
  /** "snapshots" when month-end cache served the points (month granularity, long ranges). */
  source: "live" | "snapshots";
}

const SNAPSHOT_MIN_DAYS = 366;

/** Closing values at each bucket end; one pass; cached month-ends used for long monthly ranges. */
export async function netWorthSeries(ctx: Ctx, view: RangeView): Promise<NetWorthSeries> {
  const buckets = buildBuckets(view.range, view.granularity);
  const prevBuckets = view.compare
    ? buildBuckets(previousPeriod(view.range), view.granularity)
    : [];
  const startEdge = utcToBusinessDate(
    new Date(businessDateToUtc(view.range.from, "UTC").getTime() - 86_400_000),
    "UTC",
  );
  const ends = [...prevBuckets.map((b) => b.end), startEdge, ...buckets.map((b) => b.end)];

  const useCache =
    view.granularity === "month" &&
    (view.preset === "all" || rangeDays(view.range) >= SNAPSHOT_MIN_DAYS);
  let byDate = new Map<string, NetWorthPoint | SnapshotPoint>();
  let source: NetWorthSeries["source"] = "live";
  if (useCache) {
    const cached = await listMonthEndSnapshots(ctx, ends[0]!, ends.at(-1)!);
    byDate = new Map(cached.map((s) => [s.date, s]));
    if (cached.length) source = "snapshots";
  }
  const missing = [...new Set(ends)].filter((d) => !byDate.has(d)).sort();
  if (missing.length) {
    for (const p of computeNetWorthSeries(await seriesInput(ctx), missing)) byDate.set(p.date, p);
  }

  const at = (d: string) => byDate.get(d)!;
  const points: NetWorthBucket[] = buckets.map((b, i) => {
    const p = at(b.end);
    const prev = prevBuckets[i] ? at(prevBuckets[i]!.end) : null;
    return {
      key: b.key,
      start: b.start,
      end: b.end,
      netWorthMinor: p.netWorthMinor,
      assetsMinor: p.assetsMinor,
      liabilitiesMinor: p.liabilitiesMinor,
      holdingsValueMinor: p.holdingsValueMinor,
      investedMinor: p.investedMinor,
      previousNetWorthMinor: prev ? prev.netWorthMinor : null,
    };
  });
  const last = points.at(-1)!;
  const baseline =
    view.compare && prevBuckets.length
      ? at(prevBuckets.at(-1)!.end).netWorthMinor
      : at(startEdge).netWorthMinor;
  return {
    currency: ctx.baseCurrency,
    points,
    change: changeOf(last.netWorthMinor, baseline),
    fxMissing: at(last.end).fxMissing,
    source,
  };
}

// --------------------------------------------------------------------------------------- flows

interface FlowRow {
  _id: { day: string; type: string; currency: string; reinvest: boolean | null };
  amount: number;
  fee: number;
  interest: number;
}

/** Daily flows in base: $dateTrunc by day in the user timezone, converted at each day's rate. */
async function dailyFlows(
  ctx: Ctx,
  range: KeyRange,
  toBase: ToBase,
): Promise<{ days: DailyFlow[]; fxMissing: number }> {
  await connectDb();
  const pipeline: PipelineStage[] = [
    {
      $match: {
        userId: toObjectId(ctx.userId, "User"),
        status: "posted",
        type: {
          $in: ["income", "investment_income", "expense", "transfer", "invest", "debt_payment"],
        },
        date: {
          $gte: businessDateToUtc(range.from, ctx.tz),
          $lt: businessDateToUtc(nextDayKey(range.to), ctx.tz),
        },
      },
    },
    {
      $group: {
        _id: {
          day: {
            $dateToString: {
              date: { $dateTrunc: { date: "$date", unit: "day", timezone: ctx.tz } },
              format: "%Y-%m-%d",
              timezone: ctx.tz,
            },
          },
          type: "$type",
          currency: "$currency",
          reinvest: { $ifNull: ["$reinvest", false] },
        },
        amount: { $sum: "$amountMinor" },
        fee: { $sum: { $ifNull: ["$feeMinor", 0] } },
        interest: { $sum: { $ifNull: ["$interestMinor", 0] } },
      },
    },
  ];
  const rows = await TransactionModel.aggregate<FlowRow>(pipeline);
  const byDay = new Map<string, DailyFlow>();
  let fxMissing = 0;
  for (const r of rows) {
    const { day, type, currency, reinvest } = r._id;
    // docs/04 §4: what each type contributes (transfer: fee only; debt payment: interest only).
    const amount = type === "transfer" ? r.fee : type === "debt_payment" ? r.interest : r.amount;
    if (amount === 0 || (type === "investment_income" && reinvest)) continue;
    const v = toBase(amount, currency, day);
    if (v === null) {
      fxMissing += 1;
      continue;
    }
    const d = byDay.get(day) ?? {
      day,
      incomeMinor: 0,
      investmentIncomeMinor: 0,
      expenseMinor: 0,
      investMinor: 0,
    };
    if (type === "income") d.incomeMinor += v;
    else if (type === "investment_income") d.investmentIncomeMinor += v;
    else if (type === "invest")
      d.investMinor += v; // excluding fees (investment rate)
    else d.expenseMinor += v; // expense, transfer fee, loan interest
    byDay.set(day, d);
  }
  return { days: [...byDay.values()], fxMissing };
}

export interface CashflowBucket extends FlowPoint {
  previous: { incomeMinor: number; expenseMinor: number; savingsRateBp: number | null } | null;
}

export interface CashflowSeries {
  currency: string;
  points: CashflowBucket[];
  totals: FlowTotals;
  previousTotals: FlowTotals | null;
  incomeChange: Change | null;
  expenseChange: Change | null;
  fxMissing: number;
}

/** Flows SUMMED per bucket (docs/04 §4, §22); compare adds the aligned previous period. */
export async function cashflowSeries(ctx: Ctx, view: RangeView): Promise<CashflowSeries> {
  const toBase = await toBaseOf(ctx);
  const buckets = buildBuckets(view.range, view.granularity);
  const prevRange = view.compare ? previousPeriod(view.range) : null;
  const span: KeyRange = prevRange ? { from: prevRange.from, to: view.range.to } : view.range;
  const { days, fxMissing } = await dailyFlows(ctx, span, toBase);
  const points = bucketFlows(days, buckets);
  const prev = prevRange ? bucketFlows(days, buildBuckets(prevRange, view.granularity)) : null;
  const totals = flowTotals(points);
  const previousTotals = prev ? flowTotals(prev) : null;
  return {
    currency: ctx.baseCurrency,
    points: points.map((p, i) => ({
      ...p,
      previous: prev?.[i]
        ? {
            incomeMinor: prev[i]!.incomeMinor,
            expenseMinor: prev[i]!.expenseMinor,
            savingsRateBp: prev[i]!.savingsRateBp,
          }
        : null,
    })),
    totals,
    previousTotals,
    incomeChange: previousTotals ? changeOf(totals.incomeMinor, previousTotals.incomeMinor) : null,
    expenseChange: previousTotals
      ? changeOf(totals.expenseMinor, previousTotals.expenseMinor)
      : null,
    fxMissing,
  };
}

/** Flow totals for an arbitrary range (standing summary, this month). */
async function flowTotalsFor(ctx: Ctx, range: KeyRange, buckets?: Bucket[]): Promise<FlowPoint[]> {
  const { days } = await dailyFlows(ctx, range, await toBaseOf(ctx));
  return bucketFlows(days, buckets ?? [{ key: range.from, start: range.from, end: range.to }]);
}

// ---------------------------------------------------------------------------- top categories

export interface TopCategory {
  id: string;
  name: string;
  valueMinor: number;
  shareBp: number;
}

export interface TopCategories {
  currency: string;
  totalMinor: number;
  categories: TopCategory[];
  /** Everything outside the top N. */
  otherMinor: number;
  fxMissing: number;
}

/** Range expense by top-level category (children rolled up, splits per line, transfer fees). */
export async function topExpenseCategories(
  ctx: Ctx,
  range: KeyRange,
  limit = 5,
): Promise<TopCategories> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const [rows, categories, toBase] = await Promise.all([
    TransactionModel.aggregate<{
      _id: { cat: unknown; currency: string; day: string };
      amount: number;
    }>([
      {
        $match: {
          userId,
          status: "posted",
          date: {
            $gte: businessDateToUtc(range.from, ctx.tz),
            $lt: businessDateToUtc(nextDayKey(range.to), ctx.tz),
          },
          $or: [{ type: "expense" }, { type: "transfer", feeMinor: { $gt: 0 } }],
        },
      },
      {
        $project: {
          currency: 1,
          day: { $dateToString: { date: "$date", format: "%Y-%m-%d", timezone: ctx.tz } },
          lines: {
            $cond: [
              { $eq: ["$type", "transfer"] },
              [{ categoryId: "$categoryId", amountMinor: "$feeMinor" }],
              {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ["$splits", []] } }, 0] },
                  "$splits",
                  [{ categoryId: "$categoryId", amountMinor: "$amountMinor" }],
                ],
              },
            ],
          },
        },
      },
      { $unwind: "$lines" },
      {
        $group: {
          _id: { cat: "$lines.categoryId", currency: "$currency", day: "$day" },
          amount: { $sum: "$lines.amountMinor" },
        },
      },
    ]),
    CategoryModel.find({ userId }).lean<CategoryDoc[]>(),
    toBaseOf(ctx),
  ]);
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const topOf = (id: string): CategoryDoc | undefined => {
    const c = byId.get(id);
    return c?.parentId ? (byId.get(String(c.parentId)) ?? c) : c;
  };
  const totals = new Map<string, number>();
  let fxMissing = 0;
  for (const r of rows) {
    const v = toBase(r.amount, r._id.currency, r._id.day);
    if (v === null) {
      fxMissing += 1;
      continue;
    }
    const top = topOf(String(r._id.cat));
    const key = top ? String(top._id) : "uncategorised";
    totals.set(key, (totals.get(key) ?? 0) + v);
  }
  const total = [...totals.values()].reduce((s, v) => s + v, 0);
  const sorted = [...totals.entries()]
    .map(([id, valueMinor]) => ({ id, name: byId.get(id)?.name ?? "Uncategorised", valueMinor }))
    .sort((a, b) => b.valueMinor - a.valueMinor || a.name.localeCompare(b.name));
  const top = sorted.slice(0, limit);
  const share = (v: number) => (total > 0 ? Math.round((v * 10_000) / total) : 0);
  return {
    currency: ctx.baseCurrency,
    totalMinor: total,
    categories: top.map((c) => ({ ...c, shareBp: share(c.valueMinor) })),
    otherMinor: total - top.reduce((s, c) => s + c.valueMinor, 0),
    fxMissing,
  };
}

// --------------------------------------------------------------------------------- allocation

export interface AllocationClass {
  id: string;
  name: string;
  color: string;
  valueMinor: number;
  shareBp: number;
  holdings: { id: string; name: string; valueMinor: number; shareBp: number }[];
}

export interface Allocation {
  currency: string;
  asOf: string;
  totalMinor: number;
  classes: AllocationClass[];
  fxMissing: number;
}

/** Holding values by class as of `end` (closing value), with the class → holdings drill-down. */
export async function allocationAsOf(ctx: Ctx, end: string): Promise<Allocation> {
  const input = await seriesInput(ctx);
  const [point] = computeNetWorthSeries(input, [end]);
  const classes = await AssetClassModel.find({ userId: toObjectId(ctx.userId, "User") })
    .sort({ sortOrder: 1, name: 1 })
    .lean<AssetClassDoc[]>();
  const holdingName = new Map(input.holdingDocs.map((h) => [String(h._id), h]));
  const total = point!.holdingsValueMinor;
  const share = (v: number, of: number) => (of > 0 ? Math.round((v * 10_000) / of) : 0);
  return {
    currency: ctx.baseCurrency,
    asOf: end,
    totalMinor: total,
    fxMissing: point!.fxMissing,
    classes: classes
      .map((cls) => {
        const id = String(cls._id);
        const value = point!.byClass[id] ?? 0;
        const holdings = Object.entries(point!.byHolding)
          .filter(([hid]) => String(holdingName.get(hid)?.assetClassId) === id)
          .map(([hid, v]) => ({
            id: hid,
            name: holdingName.get(hid)?.name ?? "Holding",
            valueMinor: v,
            shareBp: share(v, value),
          }))
          .sort((a, b) => b.valueMinor - a.valueMinor);
        return {
          id,
          name: cls.name,
          color: cls.color,
          valueMinor: value,
          shareBp: share(value, total),
          holdings,
        };
      })
      .filter((c) => c.valueMinor > 0),
  };
}

// ---------------------------------------------------------------------------------- standing

export interface Standing {
  currency: string;
  netWorthMinor: number;
  netWorthChange: Change;
  /** Net worth change since the end of last month (stat card "Δ this month"). */
  monthChange: Change;
  assetsMinor: number;
  liabilitiesMinor: number;
  savingsRateBp: number | null;
  thisMonthSavingsRateBp: number | null;
  investmentRateBp: number | null;
  /** Tenths of a month; null without expense history. */
  runwayTenths: number | null;
  /** Phase 8. */
  debtLoadBp: null;
  /** Phase 10. */
  healthScore: null;
  fxMissing: number;
}

/** docs/04 §22 standing summary for the range (nullable fields render as "—"). */
export async function getStanding(ctx: Ctx, view: RangeView): Promise<Standing> {
  const today = todayOf(ctx);
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = utcToBusinessDate(
    new Date(businessDateToUtc(monthStart, "UTC").getTime() - 86_400_000),
    "UTC",
  );
  const startEdge = utcToBusinessDate(
    new Date(businessDateToUtc(view.range.from, "UTC").getTime() - 86_400_000),
    "UTC",
  );
  // Runway: average monthly expense over the last 3 complete months.
  const threeBack = buildBuckets({ from: addMonthsKey(monthStart, -3), to: lastMonthEnd }, "month");
  const input = await seriesInput(ctx);
  const ends = [...new Set([lastMonthEnd, startEdge, view.range.to, today])].sort();
  const pts = new Map(computeNetWorthSeries(input, ends).map((p) => [p.date, p]));
  const [rangeFlows, monthFlows, pastMonths] = await Promise.all([
    flowTotalsFor(ctx, view.range),
    flowTotalsFor(ctx, { from: monthStart, to: today }),
    flowTotalsFor(ctx, { from: threeBack[0]!.start, to: lastMonthEnd }, threeBack),
  ]);
  const totals = flowTotals(rangeFlows);
  const avgExpense = Math.round(pastMonths.reduce((s, p) => s + p.expenseMinor, 0) / 3);

  // Liquid = cash accounts + high-liquidity holdings, today, in base.
  const now = pts.get(today)!;
  const highLiquidity = input.holdingDocs
    .filter((h) => h.liquidity === "high")
    .reduce((s, h) => s + (now.byHolding[String(h._id)] ?? 0), 0);
  const end = pts.get(view.range.to)!;
  return {
    currency: ctx.baseCurrency,
    netWorthMinor: end.netWorthMinor,
    netWorthChange: changeOf(end.netWorthMinor, pts.get(startEdge)!.netWorthMinor),
    monthChange: changeOf(now.netWorthMinor, pts.get(lastMonthEnd)!.netWorthMinor),
    assetsMinor: end.assetsMinor,
    liabilitiesMinor: end.liabilitiesMinor,
    savingsRateBp: totals.savingsRateBp,
    thisMonthSavingsRateBp: flowTotals(monthFlows).savingsRateBp,
    investmentRateBp: totals.investmentRateBp,
    runwayTenths: runwayTenths(now.cashMinor + highLiquidity, avgExpense),
    debtLoadBp: null,
    healthScore: null,
    fxMissing: end.fxMissing,
  };
}

function addMonthsKey(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  return utcToBusinessDate(d, "UTC");
}

// ---------------------------------------------------------------------- upcoming / safe to spend

export interface UpcomingItem {
  id: string;
  kind: "fd_maturity" | "card_due" | "sip" | "recurring" | "emi";
  title: string;
  dueDate: string;
  amountMinor: number | null;
  currency: string;
  /** Money that will leave an earmarkable account (safe to spend, docs/04 §21). */
  outflowMinor?: number | null;
  accountId?: string | null;
  href: string;
  posted?: boolean;
}

/**
 * Items due from today up to `until` (inclusive). Later phases add SIPs (5), EMIs (8) and recurring
 * items (9) with `outflowMinor` so safe-to-spend picks them up automatically.
 */
export async function getUpcoming(ctx: Ctx, until: string): Promise<UpcomingItem[]> {
  const today = todayOf(ctx);
  const input = await seriesInput(ctx);
  const items: UpcomingItem[] = [];
  for (const h of input.holdingDocs) {
    if (h.status !== "active") continue;
    const terms = fdTerms(h, ctx.tz);
    if (!terms || terms.maturityDate < today || terms.maturityDate > until) continue;
    items.push({
      id: `fd-${String(h._id)}`,
      kind: "fd_maturity",
      title: `${h.name} matures`,
      dueDate: terms.maturityDate,
      amountMinor: null,
      currency: h.currency,
      href: `/assets/${String(h._id)}`,
    });
  }
  for (const a of input.accountDocs) {
    if (a.type !== "credit_card" || a.archivedAt || !a.creditCard) continue;
    const due = nextMonthlyDate(today, a.creditCard.dueDay);
    const outstanding = cardOutstandingMinor(a.balanceMinor);
    if (due > until || outstanding === 0) continue;
    items.push({
      id: `card-${String(a._id)}`,
      kind: "card_due",
      title: `${a.name} payment due`,
      dueDate: due,
      amountMinor: outstanding,
      currency: a.currency,
      // Owner decision (Phase 4): the full outstanding counts against safe to spend.
      outflowMinor: outstanding,
      accountId: String(a._id),
      href: `/accounts/${String(a._id)}`,
    });
  }
  // SIPs (Phase 5): generated and projected periods; outflow only from earmarkable accounts.
  const { sipUpcoming } = await import("@/modules/sip/queries");
  for (const s of await sipUpcoming(ctx, until)) {
    if (s.dueDate < today && !s.href.startsWith("/sip/execute/")) continue;
    items.push({ ...s, kind: "sip" });
  }
  return items.sort((x, y) => x.dueDate.localeCompare(y.dueDate) || x.title.localeCompare(y.title));
}

export interface SafeToSpend {
  currency: string;
  freeCashMinor: number;
  committedMinor: number;
  safeMinor: number;
  monthEnd: string;
  /** Upcoming outflows included (breakdown popover). */
  items: UpcomingItem[];
  emergencyMinor: number;
  opportunityMinor: number;
  fxMissing: number;
}

/** docs/04 §21 — free cash minus unposted outflows due by the end of this month (base currency). */
export async function getSafeToSpend(ctx: Ctx): Promise<SafeToSpend> {
  const today = todayOf(ctx);
  const monthEnd = monthEndOf(today);
  const [buckets, upcoming, toBase] = await Promise.all([
    getBucketsInBase(ctx),
    getUpcoming(ctx, monthEnd),
    toBaseOf(ctx),
  ]);
  let fxMissing = buckets.fxMissing;
  const outflows = upcoming
    .filter((i) => (i.outflowMinor ?? 0) > 0)
    .flatMap((i) => {
      const v = toBase(i.outflowMinor!, i.currency, today);
      if (v === null) {
        fxMissing += 1;
        return [];
      }
      return [{ ...i, outflowMinor: v, currency: ctx.baseCurrency }];
    });
  const { safeMinor, committedMinor } = safeToSpend(buckets.freeMinor, outflows, monthEnd);
  return {
    currency: ctx.baseCurrency,
    freeCashMinor: buckets.freeMinor,
    committedMinor,
    safeMinor,
    monthEnd,
    items: outflows,
    emergencyMinor: buckets.emergencyMinor,
    opportunityMinor: buckets.opportunityMinor,
    fxMissing,
  };
}

// ---------------------------------------------------------------------------------- attention

export interface Attention {
  staleCount: number;
  /** Target classes beyond the drift threshold (Phase 6). */
  offTargetCount: number;
}

export async function getAttention(ctx: Ctx): Promise<Attention> {
  const [input, settings] = await Promise.all([seriesInput(ctx), getSettings(ctx)]);
  const today = todayOf(ctx);
  const staleCount = input.holdingDocs.filter((h) =>
    isStale({
      active: h.status === "active",
      isFd: Boolean(h.fd),
      currentValueMinor: h.currentValueMinor,
      lastValuedAt: h.lastValuedAt ? utcToBusinessDate(h.lastValuedAt, ctx.tz) : null,
      today,
      staleDays: settings.staleDays,
    }),
  ).length;
  const { countOffTarget } = await import("@/modules/rebalancing/service");
  return { staleCount, offTargetCount: await countOffTarget(ctx) };
}

/** First date with data, for the "All" preset. */
export async function getEarliestKey(ctx: Ctx): Promise<string | null> {
  return (await seriesInput(ctx)).earliestKey;
}
