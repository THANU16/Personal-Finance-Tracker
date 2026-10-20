// Cashflow forecast (docs/04 §17) and net worth projection (docs/04 §22). Pure: business date keys,
// integer minor units; the caller converts to base before calling.
import { addDays } from "@/domain/recurring";

export const FORECAST_HORIZONS = [30, 60, 90] as const;
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];

export interface ForecastAccount {
  id: string;
  name: string;
  /** Starting balance (current cache), in base. */
  balanceMinor: number;
}

export interface ForecastEvent {
  date: string;
  /** null: no account is known (e.g. a card due without a payment account) — moves the total only. */
  accountId: string | null;
  /** Signed: + inflow, − outflow; base currency. */
  deltaMinor: number;
  title: string;
  kind: "recurring" | "sip" | "emi" | "card_due";
}

export interface ForecastDay {
  date: string;
  totalMinor: number;
  byAccount: Record<string, number>;
}

export interface Breach {
  date: string;
  balanceMinor: number;
  /** "zero": below 0; "minimum": below the warning minimum but not below 0. */
  below: "zero" | "minimum";
}

export interface AccountForecast {
  id: string;
  name: string;
  startMinor: number;
  lowestMinor: number;
  lowestDate: string;
  endMinor: number;
  breach: Breach | null;
}

export interface Forecast {
  from: string;
  to: string;
  days: ForecastDay[];
  accounts: AccountForecast[];
  total: { lowestMinor: number; lowestDate: string; breach: Breach | null };
  /** Events inside the horizon, by date. */
  events: ForecastEvent[];
}

function breachOf(balance: number, minimum: number): Breach["below"] | null {
  if (balance < 0) return "zero";
  if (minimum > 0 && balance < minimum) return "minimum";
  return null;
}

/**
 * Day-by-day balances from today (day 0 = today after today's events) to today + horizon − 1.
 * Events dated before today (overdue, not posted) land on today. Flags the first date each account
 * and the total goes below 0 or below `minimumMinor`.
 */
export function forecastBalances(input: {
  today: string;
  horizonDays: number;
  accounts: readonly ForecastAccount[];
  events: readonly ForecastEvent[];
  minimumMinor: number;
}): Forecast {
  const { today, horizonDays, minimumMinor } = input;
  const to = addDays(today, Math.max(1, horizonDays) - 1);
  const known = new Set(input.accounts.map((a) => a.id));
  const events = input.events
    .filter((e) => e.date <= to && e.deltaMinor !== 0)
    .map((e) => ({
      ...e,
      date: e.date < today ? today : e.date,
      accountId: e.accountId && known.has(e.accountId) ? e.accountId : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const byDate = new Map<string, ForecastEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  const balance = new Map(input.accounts.map((a) => [a.id, a.balanceMinor]));
  let unassigned = 0;
  const acc = new Map<string, AccountForecast>(
    input.accounts.map((a) => [
      a.id,
      {
        id: a.id,
        name: a.name,
        startMinor: a.balanceMinor,
        lowestMinor: a.balanceMinor,
        lowestDate: today,
        endMinor: a.balanceMinor,
        breach: null,
      },
    ]),
  );
  const total: Forecast["total"] = {
    lowestMinor: Number.POSITIVE_INFINITY,
    lowestDate: today,
    breach: null,
  };
  const days: ForecastDay[] = [];
  for (let date = today; date <= to; date = addDays(date, 1)) {
    for (const e of byDate.get(date) ?? []) {
      if (e.accountId) balance.set(e.accountId, balance.get(e.accountId)! + e.deltaMinor);
      else unassigned += e.deltaMinor;
    }
    const byAccount: Record<string, number> = {};
    let sum = unassigned;
    for (const [id, b] of balance) {
      byAccount[id] = b;
      sum += b;
      const a = acc.get(id)!;
      a.endMinor = b;
      if (b < a.lowestMinor) {
        a.lowestMinor = b;
        a.lowestDate = date;
      }
      const below = breachOf(b, minimumMinor);
      if (!a.breach && below) a.breach = { date, balanceMinor: b, below };
    }
    if (sum < total.lowestMinor) {
      total.lowestMinor = sum;
      total.lowestDate = date;
    }
    const below = breachOf(sum, minimumMinor);
    if (!total.breach && below) total.breach = { date, balanceMinor: sum, below };
    days.push({ date, totalMinor: sum, byAccount });
  }
  return { from: today, to, days, accounts: [...acc.values()], total, events };
}

// ------------------------------------------------------------------------- net worth projection

export const PROJECTION_SPREAD_BP = 200;

export interface ProjectionPoint {
  year: number;
  lowMinor: number;
  baseMinor: number;
  highMinor: number;
}

/** Monthly equivalent of a contribution: weekly × 52 / 12, rounded. */
export function monthlyEquivalent(amountMinor: number, frequency: "monthly" | "weekly"): number {
  return frequency === "weekly" ? Math.round((amountMinor * 52) / 12) : amountMinor;
}

function grow(startMinor: number, monthlyMinor: number, annualBp: number, months: number): number {
  const r = annualBp / 10_000 / 12;
  let v = startMinor;
  for (let m = 0; m < months; m++) v = Math.round(v * (1 + r)) + monthlyMinor;
  return v;
}

/**
 * Net worth projection (docs/04 §22): monthly compounding of the start value plus a monthly
 * contribution, at the annual return and ± 2 points. One point per year from 0 to `years`.
 * Always an estimate.
 */
export function projectNetWorth(input: {
  startMinor: number;
  monthlyContributionMinor: number;
  annualReturnBp: number;
  years: number;
}): ProjectionPoint[] {
  const out: ProjectionPoint[] = [];
  const low = Math.max(0, input.annualReturnBp - PROJECTION_SPREAD_BP);
  const high = input.annualReturnBp + PROJECTION_SPREAD_BP;
  for (let year = 0; year <= input.years; year++) {
    const months = year * 12;
    out.push({
      year,
      lowMinor: grow(input.startMinor, input.monthlyContributionMinor, low, months),
      baseMinor: grow(
        input.startMinor,
        input.monthlyContributionMinor,
        input.annualReturnBp,
        months,
      ),
      highMinor: grow(input.startMinor, input.monthlyContributionMinor, high, months),
    });
  }
  return out;
}
