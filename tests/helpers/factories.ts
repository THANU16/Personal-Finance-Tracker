import { Types } from "mongoose";
import { businessDateToUtc } from "@/domain/dates";
import { AccountModel } from "@/modules/accounts/model";
import { createAccount } from "@/modules/accounts/service";
import type { AccountDTO, CreateAccountInput } from "@/modules/accounts/schemas";
import { CategoryModel, type CategoryDoc, type CategoryKind } from "@/modules/categories/model";
import { createTransaction } from "@/modules/transactions/service";
import type { TransactionInput } from "@/modules/transactions/schemas";
import { ensureUserSetup } from "@/server/bootstrap";
import type { Ctx } from "@/server/ctx";

/** A user context set up exactly as on first login (settings + seeded categories/classes). */
export async function makeUser(): Promise<Ctx> {
  const userId = new Types.ObjectId().toString();
  const settings = await ensureUserSetup(userId);
  return { userId, tz: settings.timezone, baseCurrency: settings.baseCurrency };
}

export const OPENING_DATE = "2026-01-01";

/** Creates an account through the service (caches stay correct). */
export async function makeAccount(
  ctx: Ctx,
  overrides: Partial<CreateAccountInput> = {},
): Promise<AccountDTO> {
  return createAccount(ctx, {
    name: `Account ${Math.random().toString(36).slice(2, 7)}`,
    type: "bank",
    currency: "LKR",
    openingBalanceMinor: 0,
    openingDate: OPENING_DATE,
    ...overrides,
  });
}

/** Seeded category id by name (e.g. "Groceries", "Salary"). */
export async function categoryId(ctx: Ctx, name: string, kind?: CategoryKind): Promise<string> {
  const doc = await CategoryModel.findOne({
    userId: new Types.ObjectId(ctx.userId),
    name,
    ...(kind ? { kind } : {}),
  }).lean<CategoryDoc>();
  if (!doc) throw new Error(`category ${name} not seeded`);
  return String(doc._id);
}

/** Posts a user transaction through the service. */
export async function post(ctx: Ctx, input: TransactionInput): Promise<string> {
  return (await createTransaction(ctx, input)).id;
}

/** Current cached balance straight from the database. */
export async function balanceOf(ctx: Ctx, accountId: string): Promise<number> {
  const doc = await AccountModel.findOne({
    _id: new Types.ObjectId(accountId),
    userId: new Types.ObjectId(ctx.userId),
  }).lean();
  if (!doc) throw new Error("account missing");
  return doc.balanceMinor;
}

export const at = (dateKey: string, tz = "Asia/Colombo") => businessDateToUtc(dateKey, tz);
