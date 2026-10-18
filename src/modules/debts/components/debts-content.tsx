import { notFound } from "next/navigation";
import { utcToBusinessDate } from "@/domain/dates";
import { DebtDetailClient } from "@/modules/debts/components/debt-detail-client";
import { DebtsClient } from "@/modules/debts/components/debts-client";
import { getDebt, listDebts } from "@/modules/debts/service";
import { requireUser } from "@/server/auth/require-user";
import { isAppError } from "@/server/errors";

export async function DebtsContent() {
  const ctx = await requireUser();
  return <DebtsClient data={await listDebts(ctx)} />;
}

export async function DebtDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, ctx] = await Promise.all([params, requireUser()]);
  const d = await getDebt(ctx, id).catch((err: unknown) => {
    if (isAppError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  });
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{d.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {d.lender ? `${d.lender} · ` : ""}
          {d.tenureMonths} months from {d.startDate}
          {d.status === "closed" ? " · repaid" : ""}
        </p>
      </div>
      <DebtDetailClient d={d} today={utcToBusinessDate(new Date(), ctx.tz)} />
    </>
  );
}
