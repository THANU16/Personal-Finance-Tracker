import "server-only";
import { z } from "zod";
import {
  isValidPattern,
  MAX_REGEX_LENGTH,
  RULE_FIELDS,
  RULE_OPERATORS,
  type RuleLike,
} from "@/domain/category-rules";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { CategoryRuleModel, type CategoryRuleDoc } from "@/modules/categories/rules-model";
import { parseInput } from "@/server/action-result";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { AppError } from "@/server/errors";

// docs/03 categoryRules — auto-categorisation for the bank CSV import (Settings → Categories).

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");

export const ruleInputSchema = z
  .object({
    matchField: z.enum(RULE_FIELDS),
    operator: z.enum(RULE_OPERATORS),
    pattern: z.string().trim().min(1, "Enter what to look for").max(MAX_REGEX_LENGTH),
    categoryId: z.string().regex(/^[a-f0-9]{24}$/i, "Choose a category"),
    priority: z.number().int().min(0).max(10_000).default(100),
  })
  .strict()
  .refine((v) => isValidPattern(v.operator, v.pattern), {
    path: ["pattern"],
    message: "Not a valid regular expression",
  });
export type RuleInput = z.input<typeof ruleInputSchema>;

export interface RuleDTO {
  id: string;
  matchField: CategoryRuleDoc["matchField"];
  operator: CategoryRuleDoc["operator"];
  pattern: string;
  categoryId: string;
  categoryName: string;
  categoryKind: "income" | "expense";
  priority: number;
}

async function assertCategory(ctx: Ctx, id: string): Promise<CategoryDoc> {
  const c = await CategoryModel.findOne({
    _id: toObjectId(id, "Category"),
    userId: uid(ctx),
    archivedAt: null,
  }).lean<CategoryDoc>();
  if (!c)
    throw new AppError("VALIDATION", "Choose a category", { categoryId: ["Choose a category"] });
  return c;
}

export async function listCategoryRules(ctx: Ctx): Promise<RuleDTO[]> {
  await connectDb();
  const [rules, categories] = await Promise.all([
    CategoryRuleModel.find({ userId: uid(ctx) })
      .sort({ priority: 1, createdAt: 1 })
      .lean<CategoryRuleDoc[]>(),
    CategoryModel.find({ userId: uid(ctx) }).lean<CategoryDoc[]>(),
  ]);
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  return rules.flatMap((r) => {
    const c = byId.get(String(r.categoryId));
    if (!c) return [];
    const parent = c.parentId ? byId.get(String(c.parentId)) : undefined;
    return [
      {
        id: String(r._id),
        matchField: r.matchField,
        operator: r.operator,
        pattern: r.pattern,
        categoryId: String(r.categoryId),
        categoryName: parent ? `${parent.name} › ${c.name}` : c.name,
        categoryKind: c.kind,
        priority: r.priority,
      },
    ];
  });
}

/** Rules ready for `matchCategory` (archived categories left out). */
export async function loadRules(ctx: Ctx): Promise<RuleLike[]> {
  const rules = await listCategoryRules(ctx);
  const active = new Set(
    (
      await CategoryModel.find({ userId: uid(ctx), archivedAt: null })
        .select({ _id: 1 })
        .lean<{ _id: unknown }[]>()
    ).map((c) => String(c._id)),
  );
  return rules.filter((r) => active.has(r.categoryId));
}

export async function createCategoryRule(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const data = parseInput(ruleInputSchema, input);
  await connectDb();
  await assertCategory(ctx, data.categoryId);
  const doc = await CategoryRuleModel.create({
    ...data,
    categoryId: toObjectId(data.categoryId, "Category"),
    userId: uid(ctx),
  });
  return { id: String(doc._id) };
}

export async function updateCategoryRule(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<{ id: string }> {
  const data = parseInput(ruleInputSchema, input);
  await connectDb();
  await assertCategory(ctx, data.categoryId);
  const res = await CategoryRuleModel.updateOne(
    { _id: toObjectId(id, "Rule"), userId: uid(ctx) },
    { $set: { ...data, categoryId: toObjectId(data.categoryId, "Category") } },
    { runValidators: true },
  );
  if (res.matchedCount === 0) throw new AppError("NOT_FOUND", "Rule not found");
  return { id };
}

export async function deleteCategoryRule(ctx: Ctx, id: string): Promise<{ id: string }> {
  await connectDb();
  const res = await CategoryRuleModel.deleteOne({ _id: toObjectId(id, "Rule"), userId: uid(ctx) });
  if (res.deletedCount === 0) throw new AppError("NOT_FOUND", "Rule not found");
  return { id };
}
