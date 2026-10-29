"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { undoBankImportAction } from "@/modules/imports/bank-actions";
import { undoValuationImportAction } from "@/modules/imports/valuation-actions";
import type { ImportHistoryItem } from "@/modules/imports/valuation-service";

const STATUS: Record<ImportHistoryItem["status"], string> = {
  draft: "Draft",
  previewed: "Previewed",
  imported: "Imported",
  reverted: "Undone",
};

/** Settings → Data: every import (Money Manager, bank statement, valuation CSV) with Undo / View. */
export function ImportHistoryList({ items }: { items: ImportHistoryItem[] }) {
  const router = useRouter();
  if (!items.length) return <p className="text-sm text-muted-foreground">No imports yet.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((b) => (
        <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {b.kind === "valuations"
                ? `Values · ${b.holding?.name ?? "holding"}`
                : b.source === "bank_csv"
                  ? "Bank statement"
                  : "Money Manager"}{" "}
              · {b.files.join(", ")}
            </p>
            <p className="text-xs text-muted-foreground">
              {format(parseISO(b.createdAt), "d MMM yyyy, HH:mm")} · {b.summary}
            </p>
          </div>
          <Badge variant={b.status === "imported" ? "default" : "secondary"}>
            {STATUS[b.status]}
          </Badge>
          {(b.kind === "valuations" || b.source === "bank_csv") && b.status === "imported" ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline">
                  Undo
                </Button>
              }
              title="Undo this import?"
              description={
                b.source === "bank_csv"
                  ? "Voids the transactions this file posted and restores the account balance. The same file can be imported again."
                  : "Removes its imported values and voids its deposits and withdrawals, then recalculates the holding and the funding account."
              }
              confirmLabel="Undo import"
              destructive
              onConfirm={async () => {
                const res =
                  b.source === "bank_csv"
                    ? await undoBankImportAction(b.id)
                    : await undoValuationImportAction(b.id);
                if (!res.ok) {
                  toast.error(res.error.message);
                  return false;
                }
                toast.success("Import undone");
                router.refresh();
              }}
            />
          ) : b.kind === "transactions" && b.status === "imported" ? (
            <Link
              href={`/transactions/import/money-manager/${b.id}`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              View
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
