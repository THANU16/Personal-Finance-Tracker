// Notification rules (docs/04 §19). Pure: the daily job gathers state, these decide what to raise.
// Idempotency lives in the dedupe key (unique per user).
import { addDays } from "@/domain/recurring";

export const NOTIFICATION_TYPES = [
  "sip_due",
  "sip_overdue",
  "recurring_due",
  "emi_due",
  "card_due",
  "fd_maturing",
  "insurance_renewal",
  "stale_values",
  "budget_80",
  "budget_100",
  "goal_off_track",
  "opportunity_trigger",
  "negative_forecast",
  "over_earmarked",
  "system",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const SEVERITIES = ["info", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface NotificationDraft {
  type: NotificationType;
  dedupeKey: string;
  title: string;
  body: string;
  link: string;
  dueDate: string | null;
  severity: Severity;
}

export interface NotificationState {
  today: string;
  sipExecutions: { id: string; planName: string; dueDate: string; status: string }[];
  recurring: { ruleId: string; name: string; dueDate: string; reminderDate: string }[];
  emis: { debtId: string; name: string; dueDate: string }[];
  cards: { accountId: string; name: string; dueDate: string; outstandingMinor: number }[];
  fds: { holdingId: string; name: string; maturityDate: string }[];
  /** Payout FDs: next interest date (Phase 10 decision: a `system` reminder). */
  fdPayouts: { holdingId: string; name: string; payoutDate: string }[];
  policies: { id: string; label: string; renewalDate: string }[];
  staleCount: number;
  budgets: {
    categoryId: string;
    name: string;
    month: string;
    spentMinor: number;
    limitMinor: number;
  }[];
  offTrackGoals: { goalId: string; name: string }[];
  opportunity: { dedupeKey: string; drawdownBp: number }[];
  negativeForecast: { accountId: string; name: string; date: string; below: "zero" | "minimum" }[];
  overEarmarked: { accountId: string; name: string }[];
}

const inWindow = (today: string, due: string, daysBefore: number) =>
  today >= addDays(due, -daysBefore) && today <= due;

/** ISO week key `YYYY-Www` of a date key. */
export function isoWeekKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const isMonday = (dateKey: string) => {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
};

/** Everything that should exist today; already-raised keys are skipped by the store. */
export function buildNotifications(s: NotificationState): NotificationDraft[] {
  const { today } = s;
  const out: NotificationDraft[] = [];
  for (const e of s.sipExecutions) {
    if (e.status === "due" && inWindow(today, e.dueDate, 2)) {
      out.push({
        type: "sip_due",
        dedupeKey: `sip_due:${e.id}`,
        title: `${e.planName} SIP due`,
        body: `Due ${e.dueDate}.`,
        link: `/sip/execute/${e.id}`,
        dueDate: e.dueDate,
        severity: "info",
      });
    }
    if ((e.status === "due" || e.status === "missed") && e.dueDate < today) {
      out.push({
        type: "sip_overdue",
        dedupeKey: `sip_overdue:${e.id}`,
        title: `${e.planName} SIP overdue`,
        body: `It was due ${e.dueDate} and has not been executed.`,
        link: `/sip/execute/${e.id}`,
        dueDate: e.dueDate,
        severity: "warning",
      });
    }
  }
  for (const r of s.recurring) {
    if (today < r.reminderDate) continue;
    out.push({
      type: "recurring_due",
      dedupeKey: `rec:${r.ruleId}:${r.dueDate}`,
      title: `${r.name} due`,
      body: `Due ${r.dueDate}. Confirm it on Recurring when it happens.`,
      link: "/recurring",
      dueDate: r.dueDate,
      severity: r.dueDate < today ? "warning" : "info",
    });
  }
  for (const e of s.emis) {
    if (!inWindow(today, e.dueDate, 3)) continue;
    out.push({
      type: "emi_due",
      dedupeKey: `emi:${e.debtId}:${e.dueDate.slice(0, 7)}`,
      title: `${e.name} EMI due`,
      body: `Due ${e.dueDate}.`,
      link: `/debts/${e.debtId}`,
      dueDate: e.dueDate,
      severity: "info",
    });
  }
  for (const c of s.cards) {
    if (c.outstandingMinor <= 0 || !inWindow(today, c.dueDate, 5)) continue;
    out.push({
      type: "card_due",
      dedupeKey: `card:${c.accountId}:${c.dueDate.slice(0, 7)}`,
      title: `${c.name} payment due`,
      body: `Pay the outstanding balance by ${c.dueDate}.`,
      link: `/accounts/${c.accountId}`,
      dueDate: c.dueDate,
      severity: "warning",
    });
  }
  for (const f of s.fds) {
    if (!inWindow(today, f.maturityDate, 7)) continue;
    out.push({
      type: "fd_maturing",
      dedupeKey: `fd:${f.holdingId}`,
      title: `${f.name} matures ${f.maturityDate}`,
      body: "Withdraw or renew it on the holding page.",
      link: `/assets/${f.holdingId}`,
      dueDate: f.maturityDate,
      severity: "info",
    });
  }
  for (const f of s.fdPayouts) {
    if (today < f.payoutDate) continue;
    out.push({
      type: "system",
      dedupeKey: `fdint:${f.holdingId}:${f.payoutDate}`,
      title: `${f.name} interest due`,
      body: `Interest for ${f.payoutDate}: record it as investment income when it arrives.`,
      link: `/assets/${f.holdingId}`,
      dueDate: f.payoutDate,
      severity: "info",
    });
  }
  for (const p of s.policies) {
    if (!inWindow(today, p.renewalDate, 30)) continue;
    out.push({
      type: "insurance_renewal",
      dedupeKey: `ins:${p.id}:${p.renewalDate}`,
      title: `${p.label} renews ${p.renewalDate}`,
      body: "Renew the policy, then update its renewal date on Essentials.",
      link: "/essentials",
      dueDate: p.renewalDate,
      severity: "info",
    });
  }
  if (s.staleCount > 0 && isMonday(today)) {
    out.push({
      type: "stale_values",
      dedupeKey: `stale:${isoWeekKey(today)}`,
      title: `${s.staleCount} holding value${s.staleCount === 1 ? " is" : "s are"} stale`,
      body: "Update values so net worth stays accurate.",
      link: "/assets/update-values",
      dueDate: null,
      severity: "info",
    });
  }
  for (const b of s.budgets) {
    if (b.limitMinor <= 0) continue;
    const over = b.spentMinor >= b.limitMinor;
    if (!over && b.spentMinor * 10 < b.limitMinor * 8) continue;
    const level = over ? 100 : 80;
    out.push({
      type: over ? "budget_100" : "budget_80",
      dedupeKey: `bud:${b.categoryId}:${b.month}:${level}`,
      title: over ? `${b.name} budget used up` : `${b.name} budget at 80%`,
      body: over ? `The ${b.month} budget is spent.` : `80% of the ${b.month} budget is spent.`,
      link: `/budgets?month=${b.month}`,
      dueDate: null,
      severity: over ? "warning" : "info",
    });
  }
  const month = today.slice(0, 7);
  for (const g of s.offTrackGoals) {
    out.push({
      type: "goal_off_track",
      dedupeKey: `goal:${g.goalId}:${month}`,
      title: `${g.name} is off track`,
      body: "The required monthly amount is above what you have been putting in.",
      link: "/goals",
      dueDate: null,
      severity: "warning",
    });
  }
  for (const o of s.opportunity) {
    out.push({
      type: "opportunity_trigger",
      dedupeKey: o.dedupeKey,
      title: `Opportunity rule reached (−${Math.round(o.drawdownBp / 100)}%)`,
      body: "The market has fallen to a deployment level.",
      link: "/opportunity-fund",
      dueDate: null,
      severity: "warning",
    });
  }
  for (const f of s.negativeForecast) {
    out.push({
      type: "negative_forecast",
      dedupeKey: `fc:${f.accountId}:${f.date}`,
      title: `${f.name} ${f.below === "zero" ? "goes below zero" : "drops below your minimum"}`,
      body: `Forecast for ${f.date}.`,
      link: "/forecast",
      dueDate: f.date,
      severity: f.below === "zero" ? "critical" : "warning",
    });
  }
  for (const a of s.overEarmarked) {
    out.push({
      type: "over_earmarked",
      dedupeKey: `earm:${a.accountId}`,
      title: `${a.name} is over-earmarked`,
      body: "Earmarks add up to more than the balance.",
      link: `/accounts/${a.accountId}`,
      dueDate: null,
      severity: "warning",
    });
  }
  return out;
}
