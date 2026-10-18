import { notFound } from "next/navigation";
import { ImportWizard } from "@/modules/imports/components/import-wizard";
import { getWizardData } from "@/modules/imports/service";
import { requireUser } from "@/server/auth/require-user";
import { isAppError } from "@/server/errors";

export async function WizardContent({ batchId }: { batchId: string }) {
  const ctx = await requireUser();
  const data = await getWizardData(ctx, batchId).catch((err: unknown) => {
    if (isAppError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  });
  return <ImportWizard data={data} />;
}
