"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateDebtAction } from "@/modules/debts/actions";
import type { DebtDetailDTO } from "@/modules/debts/schemas";

const KINDS = [
  { value: "bank_loan", label: "Bank loan" },
  { value: "leasing", label: "Leasing" },
  { value: "personal", label: "Personal" },
  { value: "other", label: "Other" },
];
const NONE = "__none";

function Pick({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(String(v ?? ""))} items={options}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Edit every field of a loan (owner decision). Recorded payments keep their split; the plan is
 * rebuilt from what is owed now. Leaving the EMI empty recalculates it over the months left.
 */
export function EditLoanDialog({ d, onClose }: { d: DebtDetailDTO; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: d.name,
    kind: d.kind as string,
    lender: d.lender ?? "",
    principalMinor: d.principalMinor as number | null,
    annualRateBp: d.annualRateBp as number | null,
    tenureMonths: String(d.tenureMonths),
    startDate: d.startDate as string | null,
    paymentDay: String(d.paymentDay),
    paidBeforeTracking: String(d.paidBeforeTracking),
    emiMinor: null as number | null,
    paymentAccountId: d.paymentAccountId ?? NONE,
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const err = (k: string) => errors[k]?.[0];

  function save() {
    start(async () => {
      const res = await updateDebtAction(d.id, {
        name: f.name,
        kind: f.kind,
        lender: f.lender,
        principalMinor: f.principalMinor ?? Number.NaN,
        annualRateBp: f.annualRateBp ?? Number.NaN,
        tenureMonths: Number(f.tenureMonths || Number.NaN),
        startDate: f.startDate ?? "",
        paymentDay: Number(f.paymentDay || Number.NaN),
        paidBeforeTracking: d.disbursedInto ? 0 : Number(f.paidBeforeTracking || 0),
        emiMinor: f.emiMinor && !Number.isNaN(f.emiMinor) ? f.emiMinor : null,
        paymentAccountId: f.paymentAccountId === NONE ? null : f.paymentAccountId,
      });
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
        return;
      }
      toast.success("Loan saved");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit loan</DialogTitle>
          <DialogDescription>
            Payments already recorded keep their interest and principal. The schedule is rebuilt
            from what you owe now.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField id="edit-name" label="Name" error={err("name")}>
              <Input id="edit-name" value={f.name} onChange={(e) => set("name", e.target.value)} />
            </FormField>
          </div>
          <FormField id="edit-kind" label="Kind">
            <Pick id="edit-kind" value={f.kind} onChange={(v) => set("kind", v)} options={KINDS} />
          </FormField>
          <FormField id="edit-lender" label="Lender (optional)">
            <Input
              id="edit-lender"
              value={f.lender}
              onChange={(e) => set("lender", e.target.value)}
            />
          </FormField>
          <FormField id="edit-principal" label="Loan amount" error={err("principalMinor")}>
            <MoneyInput
              id="edit-principal"
              currency={d.currency}
              value={f.principalMinor}
              onChange={(v) => set("principalMinor", v)}
            />
          </FormField>
          <FormField id="edit-rate" label="Annual interest rate" error={err("annualRateBp")}>
            <PercentInput
              id="edit-rate"
              value={f.annualRateBp}
              onChange={(v) => set("annualRateBp", v)}
            />
          </FormField>
          <FormField id="edit-tenure" label="Tenure (months)" error={err("tenureMonths")}>
            <Input
              id="edit-tenure"
              inputMode="numeric"
              value={f.tenureMonths}
              onChange={(e) => set("tenureMonths", e.target.value)}
            />
          </FormField>
          <FormField id="edit-start" label="Start date" error={err("startDate")}>
            <DatePicker id="edit-start" value={f.startDate} onChange={(v) => set("startDate", v)} />
          </FormField>
          <FormField id="edit-day" label="Payment day (1–31)" error={err("paymentDay")}>
            <Input
              id="edit-day"
              inputMode="numeric"
              value={f.paymentDay}
              onChange={(e) => set("paymentDay", e.target.value)}
            />
          </FormField>
          {d.disbursedInto ? null : (
            <FormField
              id="edit-paid"
              label="Instalments paid before tracking"
              error={err("paidBeforeTracking")}
            >
              <Input
                id="edit-paid"
                inputMode="numeric"
                value={f.paidBeforeTracking}
                onChange={(e) => set("paidBeforeTracking", e.target.value)}
              />
            </FormField>
          )}
          <FormField
            id="edit-emi"
            label="EMI (optional)"
            error={err("emiMinor")}
            description="Leave empty to recalculate"
          >
            <MoneyInput
              id="edit-emi"
              currency={d.currency}
              value={f.emiMinor}
              onChange={(v) => set("emiMinor", v)}
            />
          </FormField>
          <FormField id="edit-pay-from" label="EMIs paid from">
            <Pick
              id="edit-pay-from"
              value={f.paymentAccountId}
              onChange={(v) => set("paymentAccountId", v)}
              options={[
                { value: NONE, label: "Not set" },
                ...d.accounts.map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save loan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
