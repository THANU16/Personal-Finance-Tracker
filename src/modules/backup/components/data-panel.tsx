"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Database, Download, RefreshCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rebuildSnapshotsAction, recomputeCachesAction } from "@/modules/backup/actions";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-xl rounded-lg border p-4">
      <h2 className="font-medium">{title}</h2>
      <div className="mt-1 space-y-3 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

/** Settings → Data (docs/05 §17): backup, restore, CSV export, maintenance. */
export function DataPanel({ accountEmpty }: { accountEmpty: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  async function restore(): Promise<boolean> {
    if (!file) return false;
    setRestoring(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await file.text(),
      });
      const body = (await res.json()) as
        | { ok: true; data: { documents: number; exportedAt: string } }
        | { ok: false; error: { message: string } };
      if (!body.ok) {
        toast.error(body.error.message);
        return false;
      }
      toast.success(`Restored ${body.data.documents} records from the backup`);
      router.push("/dashboard");
      router.refresh();
      return true;
    } catch {
      toast.error("Restore failed; check your connection");
      return false;
    } finally {
      setRestoring(false);
    }
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, done: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error?.message ?? "Something went wrong");
      else {
        toast.success(done);
        router.refresh();
      }
    });

  return (
    <>
      <Block title="Back up everything">
        <p>
          One JSON file with all your data: accounts, transactions, holdings and values, plans,
          budgets, goals, earmarks, settings and history. Attached files are not included.
        </p>
        <Button variant="outline" render={<a href="/api/export?kind=backup" download />}>
          <Download aria-hidden /> Download backup
        </Button>
      </Block>
      <Block title="Restore a backup">
        <p>
          Restoring works only into an <strong>empty</strong> account (no accounts, holdings or
          transactions) — for example a new registration. It replaces the starter categories, asset
          classes and settings with the backup&apos;s.
        </p>
        {accountEmpty ? (
          <div className="grid gap-2">
            <Label htmlFor="restore-file" className="text-foreground">
              Backup file (.json)
            </Label>
            <Input
              ref={input}
              id="restore-file"
              type="file"
              accept=".json,application/json"
              disabled={restoring}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div>
              <ConfirmDialog
                trigger={
                  <Button disabled={!file || restoring}>
                    <Upload aria-hidden /> {restoring ? "Restoring…" : "Restore"}
                  </Button>
                }
                title="Restore this backup?"
                description={`Loads everything from ${file?.name ?? "the file"} into this account and recalculates all balances.`}
                confirmLabel="Restore"
                onConfirm={restore}
              />
            </div>
          </div>
        ) : (
          <p className="rounded-md bg-muted px-3 py-2 text-foreground">
            This account already has data, so a backup can&apos;t be restored here. Register a new
            account and restore into it.
          </p>
        )}
      </Block>
      <Block title="Export transactions">
        <p>
          Every transaction as CSV (opens in Excel). The Transactions page exports its current
          filters.
        </p>
        <Button
          variant="outline"
          render={<a href="/api/export?kind=transactions&preset=all" download />}
        >
          <Download aria-hidden /> Export all transactions
        </Button>
      </Block>
      <Block title="Maintenance">
        <p>
          Both are safe to run any time: they rebuild caches from the ledger and change nothing when
          everything is already correct.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await rebuildSnapshotsAction();
                return r;
              }, "Month-end history rebuilt")
            }
          >
            <Database aria-hidden /> Rebuild snapshots
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(recomputeCachesAction, "Balances and holding values recomputed")}
          >
            <RefreshCcw aria-hidden /> Recompute caches
          </Button>
        </div>
      </Block>
    </>
  );
}
