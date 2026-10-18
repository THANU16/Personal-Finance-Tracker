import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportHistory } from "@/modules/imports/components/import-history";
import { MoneyManagerUploadForm } from "@/modules/imports/components/upload-form";
import { listImportBatches } from "@/modules/imports/service";
import { requireUser } from "@/server/auth/require-user";

export async function ImportPageContent() {
  const ctx = await requireUser();
  const batches = await listImportBatches(ctx);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Money Manager</CardTitle>
          <CardDescription>
            Bring your history from the Money Manager app (Realbyte): accounts, categories,
            transfers with fees and balance corrections. You map everything before anything is
            saved, and you can undo the import.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MoneyManagerUploadForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent imports</CardTitle>
          <CardDescription>Continue a draft, or open a finished import to undo it.</CardDescription>
        </CardHeader>
        <CardContent>
          <ImportHistory batches={batches} />
        </CardContent>
      </Card>
    </div>
  );
}
