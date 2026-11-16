"use client";

import { useState } from "react";
import { Money } from "@/components/shared/money";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ActionWarning } from "@/server/errors";

const TEXT: Record<ActionWarning["code"], string> = {
  DIPS_INTO_OPPORTUNITY: "of your opportunity money",
  DIPS_INTO_EMERGENCY: "of your emergency money",
  WITHDRAWS_FROM_OPPORTUNITY: "from an Opportunity Fund account",
  WITHDRAWS_FROM_EMERGENCY: "from an emergency fund account",
  WITHDRAWS_FROM_GOAL: "of goal money",
};

const isEmergency = (w: ActionWarning) =>
  w.code === "DIPS_INTO_EMERGENCY" || w.code === "WITHDRAWS_FROM_EMERGENCY";
const isGoal = (w: ActionWarning) => w.code === "WITHDRAWS_FROM_GOAL";

export interface DipConfirmation {
  confirmOpportunity: boolean;
  confirmEmergency: boolean;
  /** Goal savings account (owner request). */
  confirmGoal: boolean;
}

/**
 * Dip guard confirmation (docs/04 §20): lists what the transaction takes from earmarked money.
 * Emergency money needs its own tick before the confirm button is enabled.
 */
export function DipConfirmDialog({
  warnings,
  onConfirm,
  onCancel,
}: {
  warnings: ActionWarning[] | null;
  onConfirm: (flags: DipConfirmation) => Promise<void>;
  onCancel: () => void;
}) {
  const [emergencyTicked, setEmergencyTicked] = useState(false);
  const [pending, setPending] = useState(false);
  const open = warnings !== null && warnings.length > 0;
  const needsEmergency = (warnings ?? []).some(isEmergency);
  const account = warnings?.[0]?.accountName ?? "this account";
  const goalName = (warnings ?? []).find(isGoal)?.goalName ?? null;

  async function confirm() {
    setPending(true);
    try {
      await onConfirm({
        confirmOpportunity: (warnings ?? []).some((w) => !isEmergency(w) && !isGoal(w)),
        confirmEmergency: needsEmergency,
        confirmGoal: (warnings ?? []).some(isGoal),
      });
    } finally {
      setPending(false);
      setEmergencyTicked(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) {
          setEmergencyTicked(false);
          onCancel();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {goalName ? "Use goal money?" : "Use earmarked money?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {(warnings ?? []).some((w) => w.code.startsWith("DIPS_"))
              ? `This is more than the free cash in ${account}. Confirming records it and lowers the earmarks it uses.`
              : goalName
                ? `${account} is kept for ${goalName}. Confirm that you want to use that money.`
                : `${account} is money you set aside. Confirm that you want to take it out.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid gap-1.5 text-sm" aria-label="What this uses">
          {(warnings ?? []).map((w) => (
            <li key={w.code} className="rounded-md bg-muted px-3 py-2">
              Uses{" "}
              <Money valueMinor={w.amountMinor} currency={w.currency} className="font-medium" />{" "}
              {isGoal(w) && w.goalName ? `for ${w.goalName}` : TEXT[w.code]}
            </li>
          ))}
        </ul>
        {needsEmergency ? (
          <Label className="flex items-start gap-2 font-normal">
            <Checkbox
              checked={emergencyTicked}
              onCheckedChange={(v) => setEmergencyTicked(v === true)}
              className="mt-0.5"
            />
            Yes, use my emergency fund for this
          </Label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || (needsEmergency && !emergencyTicked)}
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {pending ? "Saving…" : "Confirm and save"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
