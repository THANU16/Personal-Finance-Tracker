import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { ImportBatchListItem } from "@/modules/imports/service";

const STATUS: Record<
  ImportBatchListItem["status"],
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  draft: { label: "Draft", variant: "outline" },
  previewed: { label: "Previewed", variant: "outline" },
  imported: { label: "Imported", variant: "default" },
  reverted: { label: "Undone", variant: "secondary" },
};

/** Recent Money Manager imports with a link back into each (continue a draft or undo). */
export function ImportHistory({ batches }: { batches: ImportBatchListItem[] }) {
  if (!batches.length) return <p className="text-sm text-muted-foreground">No imports yet.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {batches.map((b) => (
        <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{b.files.join(", ")}</p>
            <p className="text-xs text-muted-foreground">
              Uploaded {format(parseISO(b.createdAt), "d MMM yyyy, HH:mm")}
              {b.transactions !== null ? ` · ${b.transactions} transactions` : ""}
            </p>
          </div>
          <Badge variant={STATUS[b.status].variant}>{STATUS[b.status].label}</Badge>
          {b.status !== "reverted" ? (
            <Link
              href={`/transactions/import/money-manager/${b.id}`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              {b.status === "imported" ? "View" : "Continue"}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
