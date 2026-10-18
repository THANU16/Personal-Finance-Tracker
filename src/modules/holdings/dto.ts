import "server-only";
import { utcToBusinessDate } from "@/domain/dates";
import {
  daysToMaturity,
  fdAccruedInterest,
  fdMaturityValue,
  fdPayoutPerPeriod,
  fdValue,
} from "@/domain/fd";
import { isStale, staleDays, totalReturnMinor, unrealizedGainMinor } from "@/domain/holdings";
import { simpleReturnBp } from "@/domain/returns";
import type { AssetClassDoc } from "@/modules/asset-classes/model";
import type { HoldingDoc, ValuationDoc } from "@/modules/holdings/model";
import type { HoldingDTO, ValuationDTO } from "@/modules/holdings/schemas";
import { fdTerms } from "@/server/ledger/holding-events";

export interface DtoContext {
  tz: string;
  today: string;
  staleDays: number;
  classes: Map<string, AssetClassDoc>;
}

/**
 * Holding DTO. FD values are computed for today (they accrue daily); the stored cache is the
 * value as of the last write/recompute.
 */
export function toHoldingDTO(
  h: HoldingDoc,
  c: DtoContext,
  xirrBp: number | null = null,
): HoldingDTO {
  const terms = fdTerms(h, c.tz);
  const fullyRedeemed = h.investedMinor === 0 && h.currentValueMinor === 0 && h.status === "closed";
  const currentValueMinor =
    terms && h.status === "active" && !fullyRedeemed
      ? fdValue(terms, c.today)
      : h.currentValueMinor;
  const lastValuedAt = h.lastValuedAt ? utcToBusinessDate(h.lastValuedAt, c.tz) : null;
  const cls = c.classes.get(String(h.assetClassId));
  const state = {
    currentValueMinor,
    investedMinor: h.investedMinor,
    realizedGainMinor: h.realizedGainMinor,
    incomeReceivedMinor: h.incomeReceivedMinor,
    taxWithheldMinor: h.taxWithheldMinor,
  };
  const unrealized = unrealizedGainMinor(state);
  return {
    id: String(h._id),
    name: h.name,
    assetClass: cls
      ? { id: String(cls._id), name: cls.name, color: cls.color }
      : { id: String(h.assetClassId), name: "Unknown", color: "#6250d6" },
    instrumentType: h.instrumentType,
    currency: h.currency,
    platform: h.platform ?? null,
    symbol: h.symbol ?? null,
    liquidity: h.liquidity,
    tags: h.tags ?? [],
    notes: h.notes ?? null,
    trackUnits: h.trackUnits,
    countsTowardEmergencyFund: h.countsTowardEmergencyFund,
    status: h.status,
    fd:
      terms && h.fd
        ? {
            principalMinor: terms.principalMinor,
            rateBp: terms.rateBp,
            startDate: terms.startDate,
            maturityDate: terms.maturityDate,
            compounding: terms.compounding,
            payout: terms.payout,
            payoutAccountId: h.fd.payoutAccountId ? String(h.fd.payoutAccountId) : null,
            autoRenew: h.fd.autoRenew,
            maturityValueMinor: fdMaturityValue(terms),
            accruedInterestMinor: fdAccruedInterest(terms, c.today),
            daysToMaturity: daysToMaturity(terms, c.today),
            payoutPerPeriodMinor: fdPayoutPerPeriod(terms),
          }
        : null,
    investedMinor: h.investedMinor,
    currentValueMinor,
    units: h.units ?? null,
    avgCostMinor: h.avgCostMinor ?? null,
    realizedGainMinor: h.realizedGainMinor,
    incomeReceivedMinor: h.incomeReceivedMinor,
    feesPaidMinor: h.feesPaidMinor,
    taxWithheldMinor: h.taxWithheldMinor,
    unrealizedGainMinor: unrealized,
    unrealizedBp: simpleReturnBp(unrealized, h.investedMinor),
    totalReturnMinor: totalReturnMinor({
      ...state,
      units: null,
      avgCostMinor: null,
      feesPaidMinor: h.feesPaidMinor,
      firstInvestedAt: null,
      lastValuedAt: null,
      lastPriceMinorE4: null,
      fullyRedeemed,
    }),
    firstInvestedAt: h.firstInvestedAt ? utcToBusinessDate(h.firstInvestedAt, c.tz) : null,
    lastValuedAt,
    lastPriceMinorE4: h.lastPriceMinorE4 ?? null,
    stale: isStale({
      active: h.status === "active",
      isFd: Boolean(terms),
      currentValueMinor,
      lastValuedAt,
      today: c.today,
      staleDays: c.staleDays,
    }),
    daysSinceValued: staleDays(lastValuedAt, c.today),
    xirrBp,
  };
}

export function toValuationDTO(v: ValuationDoc, tz: string): ValuationDTO {
  return {
    id: String(v._id),
    date: utcToBusinessDate(v.date, tz),
    valueMinor: v.valueMinor,
    priceMinorE4: v.priceMinorE4 ?? null,
    units: v.units ?? null,
    source: v.source,
    note: v.note ?? null,
  };
}
