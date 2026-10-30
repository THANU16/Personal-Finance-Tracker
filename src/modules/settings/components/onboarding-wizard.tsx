"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Database, Plus } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AccountFormDialog } from "@/modules/accounts/components/account-form-dialog";
import {
  AddHoldingDialog,
  type AddHoldingOptions,
} from "@/modules/holdings/components/add-holding-dialog";
import { updateSettingsAction } from "@/modules/settings/actions";
import {
  completeOnboardingAction,
  loadDemoDataAction,
} from "@/modules/settings/onboarding-actions";

const STEPS = ["Preferences", "Accounts", "Holdings", "SIP", "Done"] as const;

interface Props {
  settings: { baseCurrency: string; timezone: string; emergencyMonths: number };
  timezones: string[];
  todayKey: string;
  accounts: { id: string; name: string; type: string; currency: string; balanceMinor: number }[];
  holdings: { id: string; name: string; currency: string; valueMinor: number }[];
  holdingOptions: AddHoldingOptions;
  demoAllowed: boolean;
}

/** docs/05 §18 — preferences → accounts → holdings → (optional) SIP → done; skippable. */
export function OnboardingWizard(p: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState(p.settings.baseCurrency);
  const [timezone, setTimezone] = useState(p.settings.timezone);
  const [months, setMonths] = useState(String(p.settings.emergencyMonths));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [accountOpen, setAccountOpen] = useState(false);
  const [pending, start] = useTransition();
  const err = (k: string) => errors[k]?.[0];

  const finish = () =>
    start(async () => {
      const res = await completeOnboardingAction();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      router.push("/dashboard");
    });

  const savePreferences = () =>
    start(async () => {
      const res = await updateSettingsAction({
        baseCurrency: currency.trim().toUpperCase(),
        timezone,
        emergencyMonths: Number(months),
      });
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
        return;
      }
      setErrors({});
      setStep(1);
      router.refresh();
    });

  const loadDemo = () =>
    start(async () => {
      toast.info("Loading 18 months of demo data… this takes a little while.");
      const res = await loadDemoDataAction();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Demo data loaded (${res.data.transactions} transactions)`);
      router.push("/dashboard");
    });

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1",
              i === step && "border-primary bg-primary text-primary-foreground",
              i < step && "text-muted-foreground",
            )}
          >
            {i < step ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <span aria-hidden>{i + 1}.</span>
            )}
            {s}
            {i < step ? <span className="sr-only"> (done)</span> : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Your preferences</CardTitle>
            <CardDescription>
              Totals, reports and net worth use your base currency. Dates and months follow your
              timezone.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField id="ob-currency" label="Base currency" error={err("baseCurrency")}>
                <Input
                  id="ob-currency"
                  value={currency}
                  maxLength={3}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  aria-invalid={Boolean(err("baseCurrency"))}
                />
              </FormField>
              <FormField id="ob-timezone" label="Timezone" error={err("timezone")}>
                <select
                  id="ob-timezone"
                  className="h-11 w-full rounded-md border bg-background px-2 text-base md:h-9 md:text-sm"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {p.timezones.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                id="ob-months"
                label="Emergency fund (months)"
                error={err("emergencyMonths")}
              >
                <Input
                  id="ob-months"
                  inputMode="numeric"
                  value={months}
                  onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))}
                />
              </FormField>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={savePreferences} disabled={pending}>
                Save and continue
              </Button>
              {p.demoAllowed && p.accounts.length === 0 ? (
                <Button variant="outline" onClick={loadDemo} disabled={pending}>
                  <Database aria-hidden /> Load demo data
                </Button>
              ) : null}
            </div>
            {p.demoAllowed ? (
              <p className="text-xs text-muted-foreground">
                Demo data (development only) fills this empty account with 18 months of sample money
                and investments.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Add your accounts</CardTitle>
            <CardDescription>
              Bank accounts, cash, cards and loans with their balance on the day you start. Add as
              many as you like; you can add more later.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {p.accounts.length ? (
              <ul className="divide-y rounded-lg border text-sm">
                {p.accounts.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2 px-3 py-2">
                    <span>{a.name}</span>
                    <Money valueMinor={a.balanceMinor} currency={a.currency} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No accounts yet.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setAccountOpen(true)}>
                <Plus aria-hidden /> Add account
              </Button>
              <Button onClick={() => setStep(2)}>Continue</Button>
            </div>
            <AccountFormDialog
              open={accountOpen}
              onOpenChange={setAccountOpen}
              todayKey={p.todayKey}
              baseCurrency={currency}
              onSaved={() => router.refresh()}
            />
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Add your investments</CardTitle>
            <CardDescription>
              Unit trusts, shares, fixed deposits, gold — with what you invested and what it is
              worth today. Optional.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {p.holdings.length ? (
              <ul className="divide-y rounded-lg border text-sm">
                {p.holdings.map((h) => (
                  <li key={h.id} className="flex justify-between gap-2 px-3 py-2">
                    <span>{h.name}</span>
                    <Money valueMinor={h.valueMinor} currency={h.currency} />
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <AddHoldingDialog options={p.holdingOptions} />
              <Button onClick={() => setStep(3)}>Continue</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>A monthly investment plan (optional)</CardTitle>
            <CardDescription>
              A SIP invests a fixed amount every month, split by your target allocation. You can set
              it up now or any time from SIP Planner.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href="/sip/plans/new" className={buttonVariants({ variant: "outline" })}>
              Create a SIP plan
            </Link>
            <Button onClick={() => setStep(4)}>Continue</Button>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <CardHeader>
            <CardTitle>All set</CardTitle>
            <CardDescription>
              Record spending with Quick add (press N anywhere). Your dashboard shows net worth,
              cashflow and what needs attention.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={finish} disabled={pending}>
              Go to the dashboard
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap justify-between gap-2 text-sm">
        {step > 0 ? (
          <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={pending}>
            Back
          </Button>
        ) : (
          <span />
        )}
        {step < 4 ? (
          <Button variant="ghost" onClick={finish} disabled={pending}>
            Skip setup
          </Button>
        ) : null}
      </div>
    </div>
  );
}
