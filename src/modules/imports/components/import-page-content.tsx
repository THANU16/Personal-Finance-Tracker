import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportHistory } from "@/modules/imports/components/import-history";
import { MoneyManagerUploadForm } from "@/modules/imports/components/upload-form";
import { listImportBatches } from "@/modules/imports/service";
import { listBankImports } from "@/modules/imports/bank-service";
import {
  BankImportClient,
  BankImportHistory,
} from "@/modules/imports/components/bank-import-client";
import { requireUser } from "@/server/auth/require-user";

export async function ImportPageContent() {
  const ctx = await requireUser();
  const [batches, bank] = await Promise.all([listImportBatches(ctx), listBankImports(ctx)]);
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Bank statement (CSV)</CardTitle>
            <CardDescription>
              Import a statement exported from your bank. Map the columns once (remembered for the
              next file with the same columns), check the categories, then import. Rows already
              imported are skipped, and every import can be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BankImportClient />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bank imports</CardTitle>
            <CardDescription>Undo voids the transactions of that file.</CardDescription>
          </CardHeader>
          <CardContent>
            <BankImportHistory items={bank} />
          </CardContent>
        </Card>
      </div>
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
            <CardDescription>
              Continue a draft, or open a finished import to undo it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ImportHistory batches={batches} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
