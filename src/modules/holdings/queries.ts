import "server-only";
import { Types } from "mongoose";
import { utcToBusinessDate } from "@/domain/dates";
import { fdValue } from "@/domain/fd";
import { holdingCashFlows, replayHolding, type HoldingEvent } from "@/domain/holdings";
import { mulDivRound } from "@/domain/money";
import { simpleReturnBp, xirrBp, type CashFlow } from "@/domain/returns";
import { AssetClassModel, type AssetClassDoc } from "@/modules/asset-classes/model";
import { toHoldingDTO, toValuationDTO, type DtoContext } from "@/modules/holdings/dto";
import { HoldingModel, ValuationModel, type HoldingDoc } from "@/modules/holdings/model";
import type { HoldingDTO, ValuationDTO } from "@/modules/holdings/schemas";
import { getSettings } from "@/modules/settings/service";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { loadRefMaps, toTransactionDTO } from "@/modules/transactions/queries";
import type { TransactionDTO } from "@/modules/transactions/schemas";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { loadToBase } from "@/modules/fx/service";
import { toObjectId } from "@/server/db/ids";
import { AppError } from "@/server/errors";
import {
  HOLDING_TXN_TYPES,
  fdTerms,
  fdValueAt,
  loadHoldingEvents,
} from "@/server/ledger/holding-events";

async function context(ctx: Ctx): Promise<DtoContext & { classList: AssetClassDoc[] }> {
  const [settings, classList] = await Promise.all([
    getSettings(ctx),
    AssetClassModel.find({ userId: toObjectId(ctx.userId, "User") })
      .sort({ sortOrder: 1, name: 1 })
      .lean<AssetClassDoc[]>(),
  ]);
  return {
    tz: ctx.tz,
    today: utcToBusinessDate(new Date(), ctx.tz),
    staleDays: settings.staleDays,
    classes: new Map(classList.map((c) => [String(c._id), c])),
    classList,
  };
}

function txnEvent(t: TransactionDoc, tz: string): HoldingEvent {
  return {
    kind: "txn",
    id: String(t._id),
    type: t.type as Extract<HoldingEvent, { kind: "txn" }>["type"],
    date: utcToBusinessDate(t.date, tz),
    seq: t.createdAt.getTime(),
    amountMinor: t.amountMinor,
    feeMinor: t.feeMinor ?? 0,
    taxMinor: t.taxMinor ?? 0,
    units: t.units ?? null,
    priceMinorE4: t.priceMinorE4 ?? null,
    reinvest: t.reinvest ?? null,
  };
}

export interface PortfolioTotals {
  currency: string;
  valueMinor: number;
  investedMinor: number;
  unrealizedGainMinor: number;
  unrealizedBp: number | null;
  realizedGainMinor: number;
  incomeMinor: number;
  xirrBp: number | null;
  /** Active holdings left out of totals because no FX rate exists (docs/04 §14). */
  fxMissingCount: number;
}

export interface PortfolioHolding extends HoldingDTO {
  /** Share of the portfolio value in bp (null when closed or not convertible). */
  weightBp: number | null;
  /** Current value in base currency (null when the FX rate is missing). */
  valueBaseMinor: number | null;
  /** Share of its class value in bp. */
  classWeightBp: number | null;
  /** Holding earmarks (owner request), in the holding's currency; null when none. */
  reserved: { emergencyMinor: number; opportunityMinor: number } | null;
}

export interface PortfolioClass {
  id: string;
  name: string;
  color: string;
  holdings: PortfolioHolding[];
  valueMinor: number;
  investedMinor: number;
  unrealizedGainMinor: number;
  weightBp: number | null;
  xirrBp: number | null;
}

export interface Portfolio {
  totals: PortfolioTotals;
  classes: PortfolioClass[];
  holdings: PortfolioHolding[];
  closedCount: number;
  staleCount: number;
  /** Active emergency-fund holdings (base value) and whether they are left out of this view. */
  emergency: { count: number; valueMinor: number; hidden: boolean };
}

const share = (part: number, whole: number) =>
  whole > 0 ? mulDivRound(part, 10_000, whole) : null;

/** /assets: every holding with returns, class groups and portfolio totals (docs/05 §5). */
export async function getPortfolio(
  ctx: Ctx,
  opts: { includeClosed?: boolean; excludeEmergency?: boolean } = {},
): Promise<Portfolio> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const c = await context(ctx);
  const [docs, txns] = await Promise.all([
    HoldingModel.find({ userId }).sort({ name: 1 }).lean<HoldingDoc[]>(),
    TransactionModel.find({
      userId,
      status: "posted",
      holdingId: { $ne: null },
      type: { $in: HOLDING_TXN_TYPES },
    }).lean<TransactionDoc[]>(),
  ]);

  const eventsByHolding = new Map<string, HoldingEvent[]>();
  for (const t of txns) {
    const key = String(t.holdingId);
    const list = eventsByHolding.get(key) ?? [];
    list.push(txnEvent(t, ctx.tz));
    eventsByHolding.set(key, list);
  }

  const toBase = await loadToBase(ctx);
  // Assets toggle (owner request): leave emergency-fund holdings out of totals, weights and XIRR.
  const emergencyDocs = docs.filter((d) => d.countsTowardEmergencyFund && d.status === "active");
  const emergency = {
    count: emergencyDocs.length,
    valueMinor: emergencyDocs.reduce(
      (s, d) => s + (toBase(toHoldingDTO(d, c).currentValueMinor, d.currency, c.today) ?? 0),
      0,
    ),
    hidden: Boolean(opts.excludeEmergency),
  };
  const shown = opts.excludeEmergency ? docs.filter((d) => !d.countsTowardEmergencyFund) : docs;
  const flowsByHolding = new Map<string, CashFlow[] | null>();
  const all = shown.map((doc) => {
    const base = toHoldingDTO(doc, c);
    const terminal =
      doc.status === "active" && base.currentValueMinor > 0
        ? { date: c.today, valueMinor: base.currentValueMinor }
        : null;
    const flows = holdingCashFlows(eventsByHolding.get(String(doc._id)) ?? [], terminal);
    // Portfolio/class XIRR in base: each flow at its own date's rate; null if any rate is missing.
    const converted = flows.map((f) => ({
      date: f.date,
      amountMinor: toBase(f.amountMinor, base.currency, f.date),
    }));
    flowsByHolding.set(
      base.id,
      converted.every((f) => f.amountMinor !== null) ? (converted as CashFlow[]) : null,
    );
    return { ...base, xirrBp: xirrBp(flows) };
  });

  /** Figures in base at today's rate; null when the rate is missing. */
  const inBase = new Map(
    all.map((h) => {
      const conv = (v: number) => toBase(v, h.currency, c.today);
      const value = conv(h.currentValueMinor);
      const invested = conv(h.investedMinor);
      const realized = conv(h.realizedGainMinor);
      const income = conv(h.incomeReceivedMinor);
      return [
        h.id,
        value === null || invested === null || realized === null || income === null
          ? null
          : { value, invested, realized, income },
      ] as const;
    }),
  );
  const fig = (h: HoldingDTO) => inBase.get(h.id) ?? null;

  const visible = all.filter((h) => opts.includeClosed || h.status === "active");
  const active = all.filter((h) => h.status === "active");
  const counted = active.filter((h) => fig(h) !== null);
  const sum = (list: HoldingDTO[], pick: (f: NonNullable<ReturnType<typeof fig>>) => number) =>
    list.reduce((s, h) => s + pick(fig(h)!), 0);
  const totalValue = sum(counted, (f) => f.value);
  const totalInvested = sum(counted, (f) => f.invested);
  const convertible = all.filter((h) => fig(h) !== null);
  const flowsOf = (ids: Set<string>) =>
    [...flowsByHolding.entries()]
      .filter(([id, f]) => ids.has(id) && f !== null)
      .flatMap(([, f]) => f!);

  const classValue = new Map<string, number>();
  for (const h of counted)
    classValue.set(h.assetClass.id, (classValue.get(h.assetClass.id) ?? 0) + fig(h)!.value);

  const { listHoldingBuckets } = await import("@/modules/earmarks/holding-service");
  const holdingBuckets = await listHoldingBuckets(ctx);
  const withWeights: PortfolioHolding[] = visible.map((h) => {
    const f = fig(h);
    const hb = holdingBuckets.get(h.id);
    const reserved =
      hb?.canCarryEarmarks && hb.emergencyMinor + hb.opportunityMinor > 0
        ? { emergencyMinor: hb.emergencyMinor, opportunityMinor: hb.opportunityMinor }
        : null;
    const live = h.status === "active" && f !== null;
    return {
      ...h,
      valueBaseMinor: f?.value ?? null,
      weightBp: live ? share(f.value, totalValue) : null,
      classWeightBp: live ? share(f.value, classValue.get(h.assetClass.id) ?? 0) : null,
      reserved,
    };
  });

  const classes: PortfolioClass[] = c.classList
    .map((cls) => {
      const holdings = withWeights.filter((h) => h.assetClass.id === String(cls._id));
      const countedInClass = holdings.filter((h) => h.status === "active" && fig(h) !== null);
      const value = sum(countedInClass, (f) => f.value);
      const invested = sum(countedInClass, (f) => f.invested);
      return {
        id: String(cls._id),
        name: cls.name,
        color: cls.color,
        holdings,
        valueMinor: value,
        investedMinor: invested,
        unrealizedGainMinor: value - invested,
        weightBp: share(value, totalValue),
        xirrBp: xirrBp(flowsOf(new Set(holdings.map((h) => h.id)))),
      };
    })
    .filter((cls) => cls.holdings.length > 0);

  return {
    totals: {
      currency: ctx.baseCurrency,
      valueMinor: totalValue,
      investedMinor: totalInvested,
      unrealizedGainMinor: totalValue - totalInvested,
      unrealizedBp: simpleReturnBp(totalValue - totalInvested, totalInvested),
      realizedGainMinor: sum(convertible, (f) => f.realized),
      incomeMinor: sum(convertible, (f) => f.income),
      xirrBp: xirrBp(flowsOf(new Set(all.map((h) => h.id)))),
      fxMissingCount: active.filter((h) => fig(h) === null).length,
    },
    classes,
    holdings: withWeights,
    closedCount: all.filter((h) => h.status === "closed").length,
    staleCount: active.filter((h) => h.stale).length,
    emergency,
  };
}

export interface HoldingDetail {
  holding: HoldingDTO;
  transactions: TransactionDTO[];
  valuations: ValuationDTO[];
  /** Invested and value after each day with activity, plus today. */
  timeline: { date: string; investedMinor: number; valueMinor: number }[];
}

/** /assets/[id] */
export async function getHoldingDetail(ctx: Ctx, id: string): Promise<HoldingDetail> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const holdingId = toObjectId(id, "Holding");
  const doc = await HoldingModel.findOne({ _id: holdingId, userId }).lean<HoldingDoc>();
  if (!doc) throw new AppError("NOT_FOUND", "Holding not found");
  const c = await context(ctx);

  const [{ events }, txns, valuations, refs] = await Promise.all([
    loadHoldingEvents(userId, holdingId, ctx.tz, null),
    TransactionModel.find({ userId, holdingId })
      .sort({ date: -1, createdAt: -1 })
      .lean<TransactionDoc[]>(),
    ValuationModel.find({ userId, holdingId }).sort({ date: -1, createdAt: -1 }).lean(),
    loadRefMaps(userId),
  ]);

  const base = toHoldingDTO(doc, c);
  const terminal =
    doc.status === "active" && base.currentValueMinor > 0
      ? { date: c.today, valueMinor: base.currentValueMinor }
      : null;
  const holding = { ...base, xirrBp: xirrBp(holdingCashFlows(events, terminal)) };

  const valueAt = fdValueAt(doc, ctx.tz);
  const { timeline } = replayHolding(events, { trackUnits: doc.trackUnits, valueAt });
  const last = timeline.at(-1);
  if (doc.status === "active" && last && last.date < c.today) {
    const terms = fdTerms(doc, ctx.tz);
    timeline.push({
      date: c.today,
      investedMinor: last.investedMinor,
      valueMinor: terms ? fdValue(terms, c.today) : last.valueMinor,
    });
  }

  return {
    holding,
    transactions: txns.map((t) => toTransactionDTO(t, refs, ctx.tz)),
    valuations: valuations.map((v) => toValuationDTO(v, ctx.tz)),
    timeline,
  };
}

export interface ValueUpdateRow {
  id: string;
  name: string;
  assetClass: { name: string; color: string };
  currency: string;
  investedMinor: number;
  currentValueMinor: number;
  lastValuedAt: string | null;
  stale: boolean;
  daysSinceValued: number | null;
  trackUnits: boolean;
  units: number | null;
  lastPriceMinorE4: number | null;
}

/** /assets/update-values: active, market-valued holdings (FDs are calculated). */
export async function getValueUpdateRows(
  ctx: Ctx,
): Promise<{ rows: ValueUpdateRow[]; bigChangeThresholdBp: number; today: string }> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const [c, settings, docs] = await Promise.all([
    context(ctx),
    getSettings(ctx),
    HoldingModel.find({ userId, status: "active", fd: null }).lean<HoldingDoc[]>(),
  ]);
  const order = new Map(c.classList.map((cls, i) => [String(cls._id), i]));
  const rows = docs
    .map((d) => toHoldingDTO(d, c))
    .sort(
      (a, b) =>
        (order.get(a.assetClass.id) ?? 0) - (order.get(b.assetClass.id) ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .map((h) => ({
      id: h.id,
      name: h.name,
      assetClass: { name: h.assetClass.name, color: h.assetClass.color },
      currency: h.currency,
      investedMinor: h.investedMinor,
      currentValueMinor: h.currentValueMinor,
      lastValuedAt: h.lastValuedAt,
      stale: h.stale,
      daysSinceValued: h.daysSinceValued,
      trackUnits: h.trackUnits,
      units: h.units,
      lastPriceMinorE4: h.lastPriceMinorE4,
    }));
  return { rows, bigChangeThresholdBp: settings.bigChangeThresholdBp, today: c.today };
}

export interface HoldingOption {
  id: string;
  name: string;
  currency: string;
  trackUnits: boolean;
  isFd: boolean;
  investedMinor: number;
  currentValueMinor: number;
  units: number | null;
  lastPriceMinorE4: number | null;
  stale: boolean;
}

/** Active holdings for pickers (Quick add). */
export async function listHoldingOptions(ctx: Ctx): Promise<HoldingOption[]> {
  await connectDb();
  const c = await context(ctx);
  const docs = await HoldingModel.find({ userId: new Types.ObjectId(ctx.userId), status: "active" })
    .sort({ name: 1 })
    .lean<HoldingDoc[]>();
  return docs.map((d) => {
    const h = toHoldingDTO(d, c);
    return {
      id: h.id,
      name: h.name,
      currency: h.currency,
      trackUnits: h.trackUnits,
      isFd: Boolean(h.fd),
      investedMinor: h.investedMinor,
      currentValueMinor: h.currentValueMinor,
      units: h.units,
      lastPriceMinorE4: h.lastPriceMinorE4,
      stale: h.stale,
    };
  });
}

/** Asset classes for the add-holding wizard. */
export async function listActiveClasses(
  ctx: Ctx,
): Promise<{ id: string; name: string; color: string }[]> {
  const c = await context(ctx);
  return c.classList
    .filter((x) => !x.archivedAt)
    .map((x) => ({ id: String(x._id), name: x.name, color: x.color }));
}
