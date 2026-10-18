"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, PiggyBank, Scale } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/format";
import { archiveAccountAction, unarchiveAccountAction } from "@/modules/accounts/actions";
import { AccountFormDialog } from "@/modules/accounts/components/account-form-dialog";
import { ReconcileDialog } from "@/modules/accounts/components/reconcile-dialog";
import type { AccountDTO } from "@/modules/accounts/schemas";
import { EarmarkDialog } from "@/modules/earmarks/components/earmark-dialog";
import type { AccountBucketsDTO } from "@/modules/earmarks/schemas";

/** Row / header menu: Edit · Reconcile · Archive (with a confirm stating the effect) · Restore. */
export function AccountActions({
  account,
  buckets,
  todayKey,
  baseCurrency,
  variant = "icon",
}: {
  account: AccountDTO;
  /** Earmark / move is offered for earmarkable accounts (docs/05 §3). */
  buckets?: AccountBucketsDTO;
  todayKey: string;
  baseCurrency: string;
  variant?: "icon" | "buttons";
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [reconcileOpen, setReconcileOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [earmarkOpen, setEarmarkOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function archive() {
    setPending(true);
    const result = await archiveAccountAction(account.id, { force: true });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setArchiveOpen(false);
    toast.success(`${account.name} archived`);
    router.refresh();
  }

  async function restore() {
    const result = await unarchiveAccountAction(account.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`${account.name} restored`);
    router.refresh();
  }

  const archiveEffect =
    account.balanceMinor === 0
      ? `${account.name} will be hidden from lists and pickers. Its transactions stay in the ledger.`
      : `${account.name} still has a balance of ${formatMoney(account.balanceMinor, account.currency)}. Archiving hides it from lists and pickers; the balance and its transactions stay in the ledger and still count in net worth.`;

  return (
    <>
      {variant === "buttons" ? (
        <div className="flex flex-wrap gap-2">
          {!account.archived ? (
            <>
              <Button variant="outline" onClick={() => setReconcileOpen(true)}>
                <Scale aria-hidden /> Reconcile
              </Button>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden /> Edit
              </Button>
              <Button variant="outline" onClick={() => setArchiveOpen(true)}>
                <Archive aria-hidden /> Archive
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => void restore()}>
              <ArchiveRestore aria-hidden /> Restore
            </Button>
          )}
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label={`Actions for ${account.name}`} />
            }
          >
            <MoreHorizontal aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!account.archived ? (
              <>
                {buckets?.earmarkable ? (
                  <DropdownMenuItem onClick={() => setEarmarkOpen(true)}>
                    <PiggyBank aria-hidden /> Earmark / move
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => setReconcileOpen(true)}>
                  <Scale aria-hidden /> Reconcile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil aria-hidden /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setArchiveOpen(true)}>
                  <Archive aria-hidden /> Archive
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={() => void restore()}>
                <ArchiveRestore aria-hidden /> Restore
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <AccountFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        account={account}
        todayKey={todayKey}
        baseCurrency={baseCurrency}
      />
      <ReconcileDialog
        account={account}
        open={reconcileOpen}
        onOpenChange={setReconcileOpen}
        todayKey={todayKey}
      />
      {buckets?.earmarkable && earmarkOpen ? (
        <EarmarkDialog
          open
          onOpenChange={setEarmarkOpen}
          accountName={account.name}
          buckets={buckets}
        />
      ) : null}
      <AlertDialog open={archiveOpen} onOpenChange={(o) => !pending && setArchiveOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {account.name}?</AlertDialogTitle>
            <AlertDialogDescription>{archiveEffect}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void archive();
              }}
            >
              {pending ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** "Add account" button + dialog. */
export function AddAccountButton({
  todayKey,
  baseCurrency,
}: {
  todayKey: string;
  baseCurrency: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add account</Button>
      <AccountFormDialog
        open={open}
        onOpenChange={setOpen}
        todayKey={todayKey}
        baseCurrency={baseCurrency}
      />
    </>
  );
}
