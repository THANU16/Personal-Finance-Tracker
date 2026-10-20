"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, Copy, MoreHorizontal, Paperclip, Pencil } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { formatMoney } from "@/lib/format";
import { AttachmentsDialog } from "@/modules/attachments/components/attachments-dialog";
import { voidTransactionAction } from "@/modules/transactions/actions";
import { useQuickAdd } from "@/modules/transactions/components/quick-add-context";
import type { TransactionDTO } from "@/modules/transactions/schemas";

/** Plain-language effect of voiding, for the confirm dialog (docs/05 §1). */
export function voidEffect(t: TransactionDTO): string {
  const amount = formatMoney(t.amountMinor, t.currency);
  switch (t.type) {
    case "expense":
      return `Restores ${amount} to ${t.fromAccount?.name ?? "the account"}.`;
    case "income":
      return `Removes ${amount} from ${t.toAccount?.name ?? "the account"}.`;
    case "transfer": {
      const received = t.toAmountMinor
        ? formatMoney(t.toAmountMinor, t.toAccount?.currency ?? t.currency)
        : amount;
      const sent = t.feeMinor > 0 ? formatMoney(t.amountMinor + t.feeMinor, t.currency) : amount;
      return `Returns ${sent}${t.feeMinor > 0 ? " (incl. the fee)" : ""} to ${t.fromAccount?.name} and takes ${received} back out of ${t.toAccount?.name}.`;
    }
    case "adjustment":
      return t.toAccount
        ? `Removes the ${amount} adjustment from ${t.toAccount.name}.`
        : `Restores the ${amount} adjustment to ${t.fromAccount?.name}.`;
    default:
      return `Reverses this ${amount} transaction.`;
  }
}

export function TransactionRowActions({ txn }: { txn: TransactionDTO }) {
  const router = useRouter();
  const { open } = useQuickAdd();
  const [voidOpen, setVoidOpen] = React.useState(false);
  const [reason, setReason] = React.useState("Entered by mistake");
  const [error, setError] = React.useState<string>();
  const [pending, setPending] = React.useState(false);
  const [filesOpen, setFilesOpen] = React.useState(false);

  if (txn.status === "void") return null;
  const duplicable = txn.type === "income" || txn.type === "expense" || txn.type === "transfer";

  async function confirmVoid() {
    setPending(true);
    const result = await voidTransactionAction(txn.id, { reason });
    setPending(false);
    if (!result.ok) {
      setError(result.error.fieldErrors?.reason?.[0] ?? result.error.message);
      return;
    }
    setVoidOpen(false);
    toast.success("Transaction voided");
    router.refresh();
  }

  return (
    <>
      {txn.attachmentCount > 0 ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${txn.attachmentCount} attachment${txn.attachmentCount === 1 ? "" : "s"}`}
          title="Attachments"
          onClick={() => setFilesOpen(true)}
        >
          <Paperclip aria-hidden />
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label="Transaction actions" />}
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {txn.editable ? (
            <DropdownMenuItem onClick={() => open({ mode: "edit", txn })}>
              <Pencil aria-hidden /> Edit
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setFilesOpen(true)}>
            <Paperclip aria-hidden /> Attachments
            {txn.attachmentCount ? ` (${txn.attachmentCount})` : ""}
          </DropdownMenuItem>
          {duplicable ? (
            <DropdownMenuItem onClick={() => open({ mode: "create", duplicateOf: txn })}>
              <Copy aria-hidden /> Duplicate
            </DropdownMenuItem>
          ) : null}
          {!txn.ownerManaged ? (
            <DropdownMenuItem
              onClick={() => {
                setError(undefined);
                setVoidOpen(true);
              }}
            >
              <Ban aria-hidden /> Void
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {filesOpen ? (
        <AttachmentsDialog
          transactionId={txn.id}
          title={txn.description ?? txn.category?.name ?? "This transaction"}
          onClose={() => setFilesOpen(false)}
        />
      ) : null}

      <AlertDialog open={voidOpen} onOpenChange={(o) => !pending && setVoidOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              {voidEffect(txn)} It stays in the ledger marked as void.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormField id={`void-reason-${txn.id}`} label="Reason" error={error}>
            <Input
              id={`void-reason-${txn.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </FormField>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void confirmVoid();
              }}
            >
              {pending ? "Voiding…" : "Void"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
