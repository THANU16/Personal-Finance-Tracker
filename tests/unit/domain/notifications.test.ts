import { describe, expect, it } from "vitest";
import { buildNotifications, isoWeekKey, type NotificationState } from "@/domain/notifications";

const empty: NotificationState = {
  today: "2026-10-20", // a Tuesday
  sipExecutions: [],
  recurring: [],
  emis: [],
  cards: [],
  fds: [],
  fdPayouts: [],
  policies: [],
  staleCount: 0,
  budgets: [],
  offTrackGoals: [],
  opportunity: [],
  negativeForecast: [],
  overEarmarked: [],
};
const keys = (s: Partial<NotificationState>) =>
  buildNotifications({ ...empty, ...s }).map((n) => n.dedupeKey);

describe("buildNotifications (docs/04 §19)", () => {
  it("nothing → nothing", () => {
    expect(buildNotifications(empty)).toEqual([]);
  });

  it("SIP due within 2 days and overdue", () => {
    expect(
      keys({
        sipExecutions: [{ id: "e1", planName: "Core", dueDate: "2026-10-22", status: "due" }],
      }),
    ).toEqual(["sip_due:e1"]);
    expect(
      keys({
        sipExecutions: [{ id: "e1", planName: "Core", dueDate: "2026-10-23", status: "due" }],
      }),
    ).toEqual([]);
    expect(
      keys({
        sipExecutions: [{ id: "e2", planName: "Core", dueDate: "2026-10-19", status: "due" }],
      }),
    ).toEqual(["sip_overdue:e2"]);
    expect(
      keys({
        sipExecutions: [{ id: "e3", planName: "Core", dueDate: "2026-10-01", status: "missed" }],
      }),
    ).toEqual(["sip_overdue:e3"]);
    expect(
      keys({
        sipExecutions: [{ id: "e4", planName: "Core", dueDate: "2026-10-01", status: "done" }],
      }),
    ).toEqual([]);
  });

  it("recurring from the reminder date; EMI 3 days, card 5 days before (with outstanding)", () => {
    expect(
      keys({
        recurring: [
          { ruleId: "r", name: "Rent", dueDate: "2026-10-25", reminderDate: "2026-10-20" },
        ],
      }),
    ).toEqual(["rec:r:2026-10-25"]);
    expect(
      keys({
        recurring: [
          { ruleId: "r", name: "Rent", dueDate: "2026-10-25", reminderDate: "2026-10-21" },
        ],
      }),
    ).toEqual([]);
    expect(keys({ emis: [{ debtId: "d", name: "Car", dueDate: "2026-10-23" }] })).toEqual([
      "emi:d:2026-10",
    ]);
    expect(keys({ emis: [{ debtId: "d", name: "Car", dueDate: "2026-10-24" }] })).toEqual([]);
    expect(
      keys({
        cards: [{ accountId: "c", name: "Visa", dueDate: "2026-10-25", outstandingMinor: 1 }],
      }),
    ).toEqual(["card:c:2026-10"]);
    expect(
      keys({
        cards: [{ accountId: "c", name: "Visa", dueDate: "2026-10-25", outstandingMinor: 0 }],
      }),
    ).toEqual([]);
  });

  it("FD 7 days, insurance 30 days before; payout interest from its date", () => {
    expect(keys({ fds: [{ holdingId: "h", name: "FD", maturityDate: "2026-10-27" }] })).toEqual([
      "fd:h",
    ]);
    expect(keys({ fds: [{ holdingId: "h", name: "FD", maturityDate: "2026-10-28" }] })).toEqual([]);
    expect(keys({ policies: [{ id: "p", label: "Life", renewalDate: "2026-11-19" }] })).toEqual([
      "ins:p:2026-11-19",
    ]);
    expect(keys({ policies: [{ id: "p", label: "Life", renewalDate: "2026-11-20" }] })).toEqual([]);
    expect(keys({ fdPayouts: [{ holdingId: "h", name: "FD", payoutDate: "2026-10-20" }] })).toEqual(
      ["fdint:h:2026-10-20"],
    );
  });

  it("stale only on Mondays, keyed by ISO week", () => {
    expect(keys({ staleCount: 2 })).toEqual([]);
    expect(keys({ today: "2026-10-19", staleCount: 2 })).toEqual(["stale:2026-W43"]);
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
  });

  it("budget 80 / 100, goals per month, opportunity, forecast, earmarks", () => {
    const b = (spentMinor: number) => [
      { categoryId: "c", name: "Food", month: "2026-10", spentMinor, limitMinor: 100 },
    ];
    expect(keys({ budgets: b(79) })).toEqual([]);
    expect(keys({ budgets: b(80) })).toEqual(["bud:c:2026-10:80"]);
    expect(keys({ budgets: b(100) })).toEqual(["bud:c:2026-10:100"]);
    expect(keys({ offTrackGoals: [{ goalId: "g", name: "House" }] })).toEqual(["goal:g:2026-10"]);
    expect(keys({ opportunity: [{ dedupeKey: "opp:2026-01-01:0", drawdownBp: 1_000 }] })).toEqual([
      "opp:2026-01-01:0",
    ]);
    const fc = buildNotifications({
      ...empty,
      negativeForecast: [{ accountId: "a", name: "Bank", date: "2026-11-02", below: "zero" }],
    });
    expect(fc[0]).toMatchObject({
      dedupeKey: "fc:a:2026-11-02",
      severity: "critical",
      type: "negative_forecast",
    });
    expect(keys({ overEarmarked: [{ accountId: "a", name: "Bank" }] })).toEqual(["earm:a"]);
  });
});
