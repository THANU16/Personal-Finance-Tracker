import "server-only";
import { Types, type ClientSession } from "mongoose";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { isEarmarkable } from "@/domain/earmarks";
import { firstDue, nextAfter, occurrences, reminderDate, type Schedule } from "@/domain/recurring";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { DebtModel, type DebtDoc } from "@/modules/debts/model";
import { postDebtPayment } from "@/modules/debts/service";
import { RecurringRuleModel, type RecurringRuleDoc } from "@/modules/recurring/model";
import {
  confirmRuleSchema,
  ruleInputSchema,
  skipRuleSchema,
  type RuleDTO,
  type TemplateDTO,
} from "@/modules/recurring/schemas";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { postTransaction } from "@/server/ledger/post";

// docs/04 §11 — recurring rules: templates with a schedule. Confirm posts the real transaction
// (amount editable, source `recurring`) and advances nextDueDate in one DB transaction; Skip only
// advances. Never auto-posts.

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");
const todayOf = (ctx: Ctx) => utcToBusinessDate(new Date(), ctx.tz);
const scheduleOf = (
  r: Pick<
    RecurringRuleDoc,
    "frequency" | "interval" | "dayOfMonth" | "weekday" | "monthOfYear" | "startDate" | "endDate"
  >,
): Schedule => ({
  frequency: r.frequency,
  interval: r.interval,
  dayOfMonth: r.dayOfMonth,
  weekday: r.weekday,
  monthOfYear: r.monthOfYear,
  startDate: r.startDate,
  endDate: r.endDate,
});
const oid = (v: string | null | undefined) => (v ? new Types.ObjectId(v) : null);

async function loadRule(
  ctx: Ctx,
  id: string,
  session: ClientSession | null = null,
): Promise<RecurringRuleDoc> {
  const r = await RecurringRuleModel.findOne({ _id: toObjectId(id, "Rule"), userId: uid(ctx) })
    .session(session)
    .lean<RecurringRuleDoc>();
  if (!r) throw new AppError("NOT_FOUND", "Recurring rule not found");
  return r;
}

/** Checks the template's references and returns the currency it posts in. */
async function validateRefs(
  ctx: Ctx,
  data: ReturnType<typeof ruleInputSchema.parse>,
  session: ClientSession,
): Promise<string> {
  const userId = uid(ctx);
  const account = async (id: string | null | undefined, field: string) => {
    if (!id) return null;
    const a = await AccountModel.findOne({ _id: toObjectId(id, "Account"), userId })
      .session(session)
      .lean<AccountDoc>();
    if (!a || a.archivedAt)
      throw new AppError("VALIDATION", "Account not found", { [field]: ["Account not found"] });
    return a;
  };
  const from = await account(data.fromAccountId, "fromAccountId");
  const to = await account(data.toAccountId, "toAccountId");
  if (data.kind === "income" || data.kind === "expense") {
    const c = await CategoryModel.findOne({ _id: toObjectId(data.categoryId!, "Category"), userId })
      .session(session)
      .lean<CategoryDoc>();
    if (!c || c.archivedAt || c.kind !== data.kind) {
      throw new AppError("VALIDATION", `Choose an active ${data.kind} category`, {
        categoryId: ["Wrong category"],
      });
    }
  }
  if (data.kind === "debt_payment") {
    const d = await DebtModel.findOne({ _id: toObjectId(data.debtId!, "Loan"), userId })
      .session(session)
      .lean<DebtDoc>();
    if (!d) throw new AppError("VALIDATION", "Loan not found", { debtId: ["Loan not found"] });
  }
  if (data.kind === "transfer" && from && to && from.currency !== to.currency) {
    throw new AppError("VALIDATION", "Recurring transfers use one currency", {
      toAccountId: ["Different currency"],
    });
  }
  return (data.kind === "income" ? to : from)?.currency ?? ctx.baseCurrency;
}

function fieldsOf(data: ReturnType<typeof ruleInputSchema.parse>, currency: string) {
  const keep = (k: "fromAccountId" | "toAccountId" | "categoryId" | "debtId", kinds: string[]) =>
    kinds.includes(data.kind) ? oid(data[k]) : null;
  return {
    name: data.name,
    kind: data.kind,
    template: {
      amountMinor: data.amountMinor,
      currency,
      fromAccountId: keep("fromAccountId", ["expense", "transfer", "debt_payment"]),
      toAccountId: keep("toAccountId", ["income", "transfer"]),
      categoryId: keep("categoryId", ["income", "expense"]),
      debtId: keep("debtId", ["debt_payment"]),
      description: data.description,
      tags: [...new Set(data.tags)],
    },
    frequency: data.frequency,
    interval:
      data.frequency === "weekly" || data.frequency === "every_n_months" ? data.interval : 1,
    dayOfMonth: data.frequency === "weekly" ? null : (data.dayOfMonth ?? null),
    weekday: data.frequency === "weekly" ? (data.weekday ?? null) : null,
    monthOfYear: data.frequency === "yearly" ? (data.monthOfYear ?? null) : null,
    startDate: data.startDate,
    endDate: data.endDate ?? null,
    reminderDaysBefore: data.reminderDaysBefore,
    isVariableAmount: data.isVariableAmount,
  };
}

export async function createRule(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const data = parseInput(ruleInputSchema, input);
  return withTransaction(async (session) => {
    const currency = await validateRefs(ctx, data, session);
    const fields = fieldsOf(data, currency);
    const next = firstDue(scheduleOf(fields));
    const [doc] = await RecurringRuleModel.create(
      [{ ...fields, userId: uid(ctx), nextDueDate: next, status: next ? "active" : "ended" }],
      { session },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "create",
        entity: "recurringRule",
        entityId: doc!._id,
        after: data,
      },
      session,
    );
    return { id: String(doc!._id) };
  });
}

/** Edit: a changed schedule restarts from the first occurrence on/after max(start, today). */
export async function updateRule(ctx: Ctx, id: string, input: unknown): Promise<{ id: string }> {
  const data = parseInput(ruleInputSchema, input);
  return withTransaction(async (session) => {
    const rule = await loadRule(ctx, id, session);
    const currency = await validateRefs(ctx, data, session);
    const fields = fieldsOf(data, currency);
    const schedule = scheduleOf(fields);
    const before = scheduleOf(rule);
    const changed = JSON.stringify(schedule) !== JSON.stringify(before);
    const today = todayOf(ctx);
    const next = changed
      ? firstDue({
          ...schedule,
          startDate: schedule.startDate > today ? schedule.startDate : today,
        })
      : rule.nextDueDate && fields.endDate && rule.nextDueDate > fields.endDate
        ? null
        : rule.nextDueDate;
    await RecurringRuleModel.updateOne(
      { _id: rule._id, userId: rule.userId },
      {
        $set: {
          ...fields,
          nextDueDate: next,
          status: next ? (rule.status === "ended" ? "active" : rule.status) : "ended",
        },
      },
      { session },
    );
    return { id };
  });
}

export async function setRuleStatus(
  ctx: Ctx,
  id: string,
  status: "active" | "paused" | "ended",
): Promise<{ id: string }> {
  await connectDb();
  const rule = await loadRule(ctx, id);
  if (status === "active" && !rule.nextDueDate)
    throw new AppError("CONFLICT", "This rule has no further dates; edit it to restart");
  await RecurringRuleModel.updateOne({ _id: rule._id, userId: rule.userId }, { $set: { status } });
  return { id };
}

/** Confirm (docs/04 §11): posts the real transaction once and advances, atomically. */
export async function confirmRule(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<{ transactionId: string; nextDueDate: string | null; warnings: string[] }> {
  const data = parseInput(confirmRuleSchema, input);
  return withTransaction(async (session) => {
    const rule = await loadRule(ctx, id, session);
    if (rule.status !== "active") throw new AppError("CONFLICT", "This rule is not active");
    if (rule.nextDueDate !== data.dueDate) {
      throw new AppError("CONFLICT", "This date was already confirmed or skipped; reload the page");
    }
    const t = rule.template;
    const amountMinor = data.amountMinor ?? t.amountMinor;
    const dateKey = data.date ?? data.dueDate;
    const source = { kind: "recurring" as const, refId: rule._id };
    let transactionId: string;
    let warnings: string[] = [];
    if (rule.kind === "debt_payment") {
      const r = await postDebtPayment(
        ctx,
        String(t.debtId),
        {
          date: dateKey,
          amountMinor,
          fromAccountId: String(t.fromAccountId),
          description: t.description ?? rule.name,
          confirmOpportunity: data.confirmOpportunity,
          confirmEmergency: data.confirmEmergency,
          source,
        },
        session,
      );
      transactionId = r.transactionId;
      warnings = r.warnings;
    } else {
      const txn = await postTransaction(
        ctx,
        {
          type: rule.kind,
          date: businessDateToUtc(dateKey, ctx.tz),
          amountMinor,
          fromAccountId: t.fromAccountId ? String(t.fromAccountId) : null,
          toAccountId: t.toAccountId ? String(t.toAccountId) : null,
          categoryId: t.categoryId ? String(t.categoryId) : null,
          description: t.description ?? rule.name,
          tags: t.tags,
          source,
          confirmOpportunity: data.confirmOpportunity,
          confirmEmergency: data.confirmEmergency,
        },
        session,
      );
      transactionId = String(txn._id);
    }
    const next = nextAfter(scheduleOf(rule), data.dueDate);
    // Guarded on the due date: two confirms of the same date cannot both advance.
    const res = await RecurringRuleModel.updateOne(
      { _id: rule._id, userId: rule.userId, nextDueDate: data.dueDate },
      {
        $set: { nextDueDate: next, status: next ? "active" : "ended", lastConfirmedAt: new Date() },
      },
      { session },
    );
    if (res.modifiedCount !== 1)
      throw new AppError("CONFLICT", "This date was already confirmed; reload the page");
    await writeAudit(
      {
        userId: ctx.userId,
        action: "confirm",
        entity: "recurringRule",
        entityId: rule._id,
        after: { dueDate: data.dueDate, transactionId, amountMinor },
      },
      session,
    );
    return { transactionId, nextDueDate: next, warnings };
  });
}

/** Skip: advances without posting. */
export async function skipRule(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<{ nextDueDate: string | null }> {
  const data = parseInput(skipRuleSchema, input);
  return withTransaction(async (session) => {
    const rule = await loadRule(ctx, id, session);
    if (rule.status !== "active") throw new AppError("CONFLICT", "This rule is not active");
    if (rule.nextDueDate !== data.dueDate)
      throw new AppError("CONFLICT", "This date was already confirmed or skipped");
    const next = nextAfter(scheduleOf(rule), data.dueDate);
    await RecurringRuleModel.updateOne(
      { _id: rule._id, userId: rule.userId, nextDueDate: data.dueDate },
      { $set: { nextDueDate: next, status: next ? "active" : "ended" } },
      { session },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "skip",
        entity: "recurringRule",
        entityId: rule._id,
        after: { dueDate: data.dueDate },
      },
      session,
    );
    return { nextDueDate: next };
  });
}

// ---------------------------------------------------------------------------------- reads

export async function listRules(ctx: Ctx): Promise<RuleDTO[]> {
  await connectDb();
  const userId = uid(ctx);
  const today = todayOf(ctx);
  const [rules, accounts, categories, debts] = await Promise.all([
    RecurringRuleModel.find({ userId })
      .sort({ status: 1, nextDueDate: 1, name: 1 })
      .lean<RecurringRuleDoc[]>(),
    AccountModel.find({ userId }).select({ name: 1 }).lean<Pick<AccountDoc, "_id" | "name">[]>(),
    CategoryModel.find({ userId }).select({ name: 1 }).lean<Pick<CategoryDoc, "_id" | "name">[]>(),
    DebtModel.find({ userId }).select({ name: 1 }).lean<Pick<DebtDoc, "_id" | "name">[]>(),
  ]);
  const ref = (map: Map<string, string>, id: Types.ObjectId | null) =>
    id ? { id: String(id), name: map.get(String(id)) ?? "Unknown" } : null;
  const a = new Map(accounts.map((x) => [String(x._id), x.name]));
  const c = new Map(categories.map((x) => [String(x._id), x.name]));
  const d = new Map(debts.map((x) => [String(x._id), x.name]));
  return rules.map((r) => ({
    id: String(r._id),
    name: r.name,
    kind: r.kind,
    amountMinor: r.template.amountMinor,
    currency: r.template.currency,
    fromAccount: ref(a, r.template.fromAccountId),
    toAccount: ref(a, r.template.toAccountId),
    category: ref(c, r.template.categoryId),
    debt: ref(d, r.template.debtId),
    description: r.template.description,
    tags: r.template.tags,
    frequency: r.frequency,
    interval: r.interval,
    dayOfMonth: r.dayOfMonth,
    weekday: r.weekday,
    monthOfYear: r.monthOfYear,
    startDate: r.startDate,
    endDate: r.endDate,
    nextDueDate: r.nextDueDate,
    reminderDaysBefore: r.reminderDaysBefore,
    isVariableAmount: r.isVariableAmount,
    status: r.status,
    overdue: r.status === "active" && Boolean(r.nextDueDate && r.nextDueDate < today),
    dueSoon:
      r.status === "active" &&
      Boolean(r.nextDueDate && reminderDate(r.nextDueDate, r.reminderDaysBefore) <= today),
  }));
}

/** Income / expense / transfer templates for Quick add. */
export async function listTemplates(ctx: Ctx): Promise<TemplateDTO[]> {
  await connectDb();
  const rules = await RecurringRuleModel.find({
    userId: uid(ctx),
    status: { $ne: "ended" },
    kind: { $in: ["income", "expense", "transfer"] },
  })
    .sort({ name: 1 })
    .lean<RecurringRuleDoc[]>();
  return rules.map((r) => ({
    id: String(r._id),
    name: r.name,
    kind: r.kind as TemplateDTO["kind"],
    amountMinor: r.template.amountMinor,
    fromAccountId: r.template.fromAccountId ? String(r.template.fromAccountId) : null,
    toAccountId: r.template.toAccountId ? String(r.template.toAccountId) : null,
    categoryId: r.template.categoryId ? String(r.template.categoryId) : null,
    description: r.template.description,
    tags: r.template.tags,
  }));
}

/**
 * Recurring occurrences up to `until` (overdue included) for Upcoming / safe to spend: outflow for
 * expense, transfer and loan payments from an earmarkable account (docs/04 §21).
 */
export async function recurringUpcoming(
  ctx: Ctx,
  until: string,
): Promise<
  {
    id: string;
    title: string;
    dueDate: string;
    amountMinor: number;
    currency: string;
    outflowMinor: number | null;
    accountId: string | null;
    href: string;
    /** Forecast (Phase 10): what the occurrence does to which accounts. */
    ruleKind: RecurringRuleDoc["kind"];
    fromAccountId: string | null;
    toAccountId: string | null;
  }[]
> {
  await connectDb();
  const userId = uid(ctx);
  const [rules, accounts] = await Promise.all([
    RecurringRuleModel.find({
      userId,
      status: "active",
      nextDueDate: { $ne: null, $lte: until },
    }).lean<RecurringRuleDoc[]>(),
    AccountModel.find({ userId }).lean<AccountDoc[]>(),
  ]);
  const byId = new Map(accounts.map((a) => [String(a._id), a]));
  return rules.flatMap((r) => {
    const from = r.template.fromAccountId ? byId.get(String(r.template.fromAccountId)) : undefined;
    const outflow = r.kind !== "income" && from && isEarmarkable(from);
    return occurrences(scheduleOf(r), r.nextDueDate!, until, 24).map((due, i) => ({
      id: `rec-${String(r._id)}-${i}`,
      title: r.name,
      dueDate: due,
      amountMinor: r.template.amountMinor,
      currency: r.template.currency,
      outflowMinor: outflow ? r.template.amountMinor : null,
      accountId:
        (r.kind === "income" ? r.template.toAccountId : r.template.fromAccountId)?.toString() ??
        null,
      href: "/recurring",
      ruleKind: r.kind,
      fromAccountId: r.template.fromAccountId ? String(r.template.fromAccountId) : null,
      toAccountId: r.template.toAccountId ? String(r.template.toAccountId) : null,
    }));
  });
}

/** Loans covered by an active recurring rule (their EMI shows through the rule instead). */
export async function debtIdsWithRules(ctx: Ctx): Promise<Set<string>> {
  const rules = await RecurringRuleModel.find({
    userId: uid(ctx),
    status: { $ne: "ended" },
    kind: "debt_payment",
  })
    .select({ "template.debtId": 1 })
    .lean<{ template: { debtId: Types.ObjectId | null } }[]>();
  return new Set(rules.map((r) => String(r.template.debtId)));
}
