// docs/04 §7 — SIP engine rules. Pure; dates are business-date keys (YYYY-MM-DD, user timezone).
import {
  addDays,
  differenceInCalendarDays,
  format,
  getISOWeek,
  getISOWeekYear,
  parse,
} from "date-fns";
import { minorUnitDigits, mulDivRound, roundHalfAwayFromZero, BP_SCALE } from "@/domain/money";

export const SIP_FREQUENCIES = ["monthly", "weekly"] as const;
export type SipFrequency = (typeof SIP_FREQUENCIES)[number];
export const MISSED_POLICIES = ["skip", "carry_forward"] as const;
export type MissedPolicy = (typeof MISSED_POLICIES)[number];
export const EXECUTION_STATUSES = ["due", "done", "partial", "skipped", "missed"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
/** dayOfMonth 31 = last day of the month (clamped). */
export const LAST_DAY = 31;

const KEY = "yyyy-MM-dd";
const toDate = (k: string) => parse(k, KEY, new Date(2000, 0, 1));
const toKey = (d: Date) => format(d, KEY);

export interface SipSchedule {
  frequency: SipFrequency;
  /** monthly: 1–28 or 31 (last day). */
  dayOfMonth?: number | null;
  /** weekly: 0 = Sunday … 6 = Saturday. */
  weekday?: number | null;
  startDate: string;
  endDate?: string | null;
}

export interface Period {
  periodKey: string;
  dueDate: string;
}

function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}

/** Monthly due date: the plan day clamped to the month's length (31 = last day). */
export function monthlyDueDate(year: number, monthIndex: number, dayOfMonth: number): string {
  const d = Math.min(dayOfMonth, daysInMonth(year, monthIndex));
  return toKey(new Date(year, monthIndex, d));
}

/** Period key of a due date: `YYYY-MM` monthly, ISO `YYYY-Www` weekly. */
export function periodKeyOf(dueDate: string, frequency: SipFrequency): string {
  if (frequency === "monthly") return dueDate.slice(0, 7);
  const d = toDate(dueDate);
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`;
}

/** Every period whose due date is within [startDate, min(until, endDate)], in order. */
export function periodsUntil(s: SipSchedule, until: string): Period[] {
  const last = s.endDate && s.endDate < until ? s.endDate : until;
  const out: Period[] = [];
  if (last < s.startDate) return out;
  if (s.frequency === "monthly") {
    const day = s.dayOfMonth ?? 1;
    const start = toDate(s.startDate);
    for (let i = 0; ; i++) {
      const due = monthlyDueDate(start.getFullYear(), start.getMonth() + i, day);
      if (due > last) break;
      if (due >= s.startDate) out.push({ periodKey: periodKeyOf(due, "monthly"), dueDate: due });
    }
  } else {
    const weekday = s.weekday ?? 1;
    let d = toDate(s.startDate);
    d = addDays(d, (weekday - d.getDay() + 7) % 7);
    while (toKey(d) <= last) {
      const due = toKey(d);
      out.push({ periodKey: periodKeyOf(due, "weekly"), dueDate: due });
      d = addDays(d, 7);
    }
  }
  return out;
}

/** Whole calendar months from `start` to `date` (a month counts once its day is reached). */
export function monthsSince(start: string, date: string): number {
  const a = toDate(start);
  const b = toDate(date);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate() && b.getDate() < daysInMonth(b.getFullYear(), b.getMonth())) {
    months -= 1;
  }
  return Math.max(0, months);
}

export interface StepUp {
  percentBp: number;
  everyMonths: number;
}

/**
 * stepped = round(amount × (1 + p)^floor(monthsSinceStart / everyMonths)), rounded to whole
 * major units (docs/04 §7).
 */
export function steppedAmount(
  amountMinor: number,
  currency: string,
  stepUp: StepUp | null | undefined,
  planStart: string,
  dueDate: string,
): number {
  if (!stepUp || stepUp.percentBp <= 0 || stepUp.everyMonths <= 0) return amountMinor;
  const steps = Math.floor(monthsSince(planStart, dueDate) / stepUp.everyMonths);
  if (steps === 0) return amountMinor;
  const unit = 10 ** minorUnitDigits(currency);
  const factor = (1 + stepUp.percentBp / BP_SCALE) ** steps;
  return roundHalfAwayFromZero((amountMinor / unit) * factor) * unit;
}

export interface PreviousExecution {
  status: ExecutionStatus;
  plannedTotalMinor: number;
  actualTotalMinor: number;
}

/** Shortfall carried in from the previous period (carry_forward, previous missed or partial). */
export function carryIn(
  policy: MissedPolicy,
  previous: PreviousExecution | null | undefined,
): number {
  if (policy !== "carry_forward" || !previous) return 0;
  if (previous.status !== "missed" && previous.status !== "partial") return 0;
  return Math.max(0, previous.plannedTotalMinor - previous.actualTotalMinor);
}

export interface VersionLike {
  version: number;
  effectiveFrom: string;
}

/** The version with the greatest effectiveFrom ≤ dueDate (ties → higher version). */
export function versionFor<T extends VersionLike>(
  versions: readonly T[],
  dueDate: string,
): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > dueDate) continue;
    if (
      !best ||
      v.effectiveFrom > best.effectiveFrom ||
      (v.effectiveFrom === best.effectiveFrom && v.version > best.version)
    ) {
      best = v;
    }
  }
  return best;
}

export function graceEnd(dueDate: string, graceDays: number): string {
  return toKey(addDays(toDate(dueDate), graceDays));
}

/** `due` and today > dueDate + graceDays → missed. */
export function isMissed(
  status: ExecutionStatus,
  dueDate: string,
  graceDays: number,
  today: string,
): boolean {
  return status === "due" && today > graceEnd(dueDate, graceDays);
}

/** After execution: done if actual ≥ planned (over-investing allowed), partial if 0 < actual < planned. */
export function executionStatus(
  plannedTotalMinor: number,
  actualTotalMinor: number,
): "done" | "partial" {
  if (actualTotalMinor <= 0) throw new RangeError("Enter at least one amount, or skip this period");
  return actualTotalMinor >= plannedTotalMinor ? "done" : "partial";
}

export function isOnTime(executedOn: string, dueDate: string, graceDays: number): boolean {
  return executedOn <= graceEnd(dueDate, graceDays);
}

export interface ConsistencyInput {
  status: ExecutionStatus;
  dueDate: string;
  onTime?: boolean | null;
}

/**
 * Consistency = on-time done executions ÷ executions with dueDate ≤ today (skipped count as not on
 * time), in bp; null when nothing is due yet.
 */
export function consistencyBp(
  executions: readonly ConsistencyInput[],
  today: string,
): number | null {
  const due = executions.filter((e) => e.dueDate <= today);
  if (due.length === 0) return null;
  const good = due.filter((e) => e.status === "done" && e.onTime === true).length;
  return mulDivRound(good, BP_SCALE, due.length);
}

/**
 * Estimated value of a plan's share of a holding (docs/04 §7: "estimated share"):
 * holding value × (plan's invested in the holding ÷ holding invested).
 */
export function estimatedShareMinor(
  holdingValueMinor: number,
  planInvestedMinor: number,
  holdingInvestedMinor: number,
): number {
  if (holdingInvestedMinor <= 0 || planInvestedMinor <= 0) return 0;
  const share = Math.min(planInvestedMinor, holdingInvestedMinor);
  return mulDivRound(holdingValueMinor, share, holdingInvestedMinor);
}

export const daysBetweenKeys = (a: string, b: string) =>
  differenceInCalendarDays(toDate(b), toDate(a));
