import { utcToBusinessDate } from "@/domain/dates";
import { listAccounts } from "@/modules/accounts/service";
import { getCategoryTree } from "@/modules/categories/service";
import { DebtModel, type DebtDoc } from "@/modules/debts/model";
import { RecurringClient } from "@/modules/recurring/components/recurring-client";
import { listRules } from "@/modules/recurring/service";
import { requireUser } from "@/server/auth/require-user";
import { toObjectId } from "@/server/db/ids";

export async function RecurringContent() {
  const ctx = await requireUser();
  const [rules, accounts, categories, debts] = await Promise.all([
    listRules(ctx),
    listAccounts(ctx),
    getCategoryTree(ctx),
    DebtModel.find({ userId: toObjectId(ctx.userId, "User"), status: "active" })
      .sort({ name: 1 })
      .lean<DebtDoc[]>(),
  ]);
  return (
    <RecurringClient
      rules={rules}
      options={{
        todayKey: utcToBusinessDate(new Date(), ctx.tz),
        baseCurrency: ctx.baseCurrency,
        accounts: accounts
          .filter((a) => !a.archived)
          .map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
        debts: debts.map((d) => ({ id: String(d._id), name: d.name })),
        categories,
      }}
    />
  );
}
