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
  /** Holdings in other currencies, left out of totals until FX rates exist (Phase 4). */
  otherCurrencyCount: number;
}

export interface PortfolioHolding extends HoldingDTO {
  /** Share of the portfolio value in bp (base-currency holdings only). */
  weightBp: number | null;
  /** Share of its class value in bp. */
  classWeightBp: number | null;
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
}

const share = (part: number, whole: number) =>
  whole > 0 ? mulDivRound(part, 10_000, whole) : null;

/** /assets: every holding with returns, class groups and portfolio totals (docs/05 §5). */
export async function getPortfolio(
  ctx: Ctx,
  opts: { includeClosed?: boolean } = {},
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

  const flowsByHolding = new Map<string, CashFlow[]>();
  const all = docs.map((doc) => {
    const base = toHoldingDTO(doc, c);
    const terminal =
      doc.status === "active" && base.currentValueMinor > 0
        ? { date: c.today, valueMinor: base.currentValueMinor }
        : null;
    const flows = holdingCashFlows(eventsByHolding.get(String(doc._id)) ?? [], terminal);
    flowsByHolding.set(base.id, flows);
    return { ...base, xirrBp: xirrBp(flows) };
  });

  const visible = all.filter((h) => opts.includeClosed || h.status === "active");
  const inBase = (h: HoldingDTO) => h.currency === ctx.baseCurrency;
  const active = all.filter((h) => h.status === "active");
  const counted = active.filter(inBase);
  const sum = (list: HoldingDTO[], pick: (h: HoldingDTO) => number) =>
    list.reduce((s, h) => s + pick(h), 0);
  const totalValue = sum(counted, (h) => h.currentValueMinor);
  const totalInvested = sum(counted, (h) => h.investedMinor);
  const baseIds = new Set(all.filter(inBase).map((h) => h.id));
  const portfolioFlows = [...flowsByHolding.entries()]
    .filter(([id]) => baseIds.has(id))
    .flatMap(([, f]) => f);

  const classValue = new Map<string, number>();
  for (const h of counted)
    classValue.set(h.assetClass.id, (classValue.get(h.assetClass.id) ?? 0) + h.currentValueMinor);

  const withWeights: PortfolioHolding[] = visible.map((h) => ({
    ...h,
    weightBp: h.status === "active" && inBase(h) ? share(h.currentValueMinor, totalValue) : null,
    classWeightBp:
      h.status === "active" && inBase(h)
        ? share(h.currentValueMinor, classValue.get(h.assetClass.id) ?? 0)
        : null,
  }));

  const classes: PortfolioClass[] = c.classList
    .map((cls) => {
      const holdings = withWeights.filter((h) => h.assetClass.id === String(cls._id));
      const countedInClass = holdings.filter((h) => h.status === "active" && inBase(h));
      const value = sum(countedInClass, (h) => h.currentValueMinor);
      const ids = new Set(holdings.filter(inBase).map((h) => h.id));
      return {
        id: String(cls._id),
        name: cls.name,
        color: cls.color,
        holdings,
        valueMinor: value,
        investedMinor: sum(countedInClass, (h) => h.investedMinor),
        unrealizedGainMinor: sum(countedInClass, (h) => h.unrealizedGainMinor),
        weightBp: share(value, totalValue),
        xirrBp: xirrBp(
          [...flowsByHolding.entries()].filter(([id]) => ids.has(id)).flatMap(([, f]) => f),
        ),
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
      realizedGainMinor: sum(all.filter(inBase), (h) => h.realizedGainMinor),
      incomeMinor: sum(all.filter(inBase), (h) => h.incomeReceivedMinor),
      xirrBp: xirrBp(portfolioFlows),
      otherCurrencyCount: active.filter((h) => !inBase(h)).length,
    },
    classes,
    holdings: withWeights,
    closedCount: all.filter((h) => h.status === "closed").length,
    staleCount: active.filter((h) => h.stale).length,
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
