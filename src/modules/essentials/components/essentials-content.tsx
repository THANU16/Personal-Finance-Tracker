import { listAccounts } from "@/modules/accounts/service";
import { getCategoryTree } from "@/modules/categories/service";
import { EssentialsClient } from "@/modules/essentials/components/essentials-client";
import { getEssentials } from "@/modules/essentials/service";
import { requireUser } from "@/server/auth/require-user";

export async function EssentialsContent() {
  const ctx = await requireUser();
  const [data, tree, accounts] = await Promise.all([
    getEssentials(ctx),
    getCategoryTree(ctx),
    listAccounts(ctx),
  ]);
  const categories = tree
    .filter((c) => c.kind === "expense" && !c.isSystem)
    .flatMap((c) => [
      { id: c.id, label: c.name },
      ...c.children
        .filter((k) => !k.archived)
        .map((k) => ({ id: k.id, label: `${c.name} › ${k.name}` })),
    ]);
  const cashTypes = ["bank", "cash", "wallet", "broker_cash", "credit_card"];
  return (
    <EssentialsClient
      data={data}
      categories={categories}
      accounts={accounts
        .filter((a) => !a.archived && cashTypes.includes(a.type))
        .map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
    />
  );
}
