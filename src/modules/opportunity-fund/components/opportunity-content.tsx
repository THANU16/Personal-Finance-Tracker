import { getTreeOptions } from "@/modules/allocation/service";
import { listAccounts } from "@/modules/accounts/service";
import { OpportunityClient } from "@/modules/opportunity-fund/components/opportunity-client";
import { getOpportunityOverview } from "@/modules/opportunity-fund/service";
import { requireUser } from "@/server/auth/require-user";

export async function OpportunityContent() {
  const ctx = await requireUser();
  const [data, treeOptions, accounts] = await Promise.all([
    getOpportunityOverview(ctx),
    getTreeOptions(ctx),
    listAccounts(ctx),
  ]);
  return (
    <OpportunityClient
      data={data}
      treeOptions={treeOptions}
      accounts={accounts
        .filter(
          (a) =>
            !a.archived &&
            ["bank", "cash", "wallet", "broker_cash", "opportunity_fund"].includes(a.type),
        )
        .map((a) => ({ id: a.id, name: a.name }))}
    />
  );
}
