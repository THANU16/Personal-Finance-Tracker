"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import {
  ChartFrame,
  NoData,
  TooltipRow,
  TooltipShell,
  useChartAxes,
} from "@/components/charts/chart-kit";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DatePicker } from "@/components/shared/date-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HealthPart, ProgressTone } from "@/domain/essentials";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  deletePolicyAction,
  savePolicyAction,
  setPolicyStatusAction,
  spendEmergencyAction,
} from "@/modules/essentials/actions";
import type { PolicyType, PremiumFrequency } from "@/modules/essentials/model";
import type { EssentialsDTO, PolicyDTO } from "@/modules/essentials/service";

type Option = { id: string; label: string };
type AccountOption = { id: string; name: string; currency: string };

const PART_LABEL: Record<HealthPart, string> = {
  emergency: "Emergency fund",
  insurance: "Insurance",
  debt: "Debt to income",
  savings: "Savings rate",
};
const TONE_BAR: Record<ProgressTone, string> = {
  red: "bg-destructive",
  amber: "bg-amber-500",
  green: "bg-emerald-600",
};
const TONE_TEXT: Record<ProgressTone, string> = {
  red: "Below half",
  amber: "Building",
  green: "Fully funded",
};
const POLICY_LABEL: Record<PolicyType, string> = {
  life: "Life",
  health: "Health",
  critical_illness: "Critical illness",
  vehicle: "Vehicle",
  home: "Home",
  other: "Other",
};
const FREQ_LABEL: Record<PremiumFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};
const fmtDate = (d: string) => format(parseISO(d), "d MMM yyyy");
const months = (tenths: number | null) =>
  tenths === null ? "—" : `${(tenths / 10).toFixed(1)} months`;

function scoreBand(score: number): { label: string; tone: ProgressTone } {
  if (score >= 75) return { label: "Good", tone: "green" };
  if (score >= 50) return { label: "Fair", tone: "amber" };
  return { label: "Needs work", tone: "red" };
}

/** Half-ring gauge; the number and its band label carry the meaning (never colour alone). */
function ScoreGauge({ score }: { score: number }) {
  const band = scoreBand(score);
  const r = 70;
  const c = Math.PI * r;
  const stroke =
    band.tone === "green"
      ? "var(--color-emerald-600, #059669)"
      : band.tone === "amber"
        ? "#f59e0b"
        : "var(--destructive)";
  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 180 100"
        className="w-48"
        role="img"
        aria-label={`Health score ${score} of 100, ${band.label}`}
      >
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          fill="none"
          stroke={stroke}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${(c * score) / 100} ${c}`}
        />
        <text
          x="90"
          y="78"
          textAnchor="middle"
          fontSize="32"
          fontWeight="700"
          fill="var(--foreground)"
        >
          {score}
        </text>
        <text x="90" y="96" textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
          of 100
        </text>
      </svg>
      <Badge variant={band.tone === "red" ? "destructive" : "secondary"}>{band.label}</Badge>
    </div>
  );
}

function PartBar({ points, max }: { points: number; max: number }) {
  return (
    <div className="h-2 rounded-full bg-muted" aria-hidden>
      <div
        className="h-2 rounded-full bg-[var(--viz-series-1)]"
        style={{ width: `${(points / max) * 100}%` }}
      />
    </div>
  );
}

function HealthCard({ data }: { data: EssentialsDTO }) {
  const { score } = data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Health score</CardTitle>
        <CardDescription>Emergency fund 30 · insurance 25 · debt 20 · savings 25.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
        <ScoreGauge score={score.score} />
        <div className="grid gap-3">
          {(Object.keys(score.parts) as HealthPart[]).map((part) => (
            <div key={part} className="grid gap-1">
              <div className="flex justify-between text-sm">
                <span>{PART_LABEL[part]}</span>
                <span className="text-muted-foreground tabular-nums">
                  {score.parts[part].points} / {score.parts[part].max}
                </span>
              </div>
              <PartBar {...score.parts[part]} />
            </div>
          ))}
          {score.reasons.length ? (
            <ul className="text-sm text-muted-foreground">
              {score.reasons.map((r) => (
                <li key={r.part}>• {r.text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------------------ emergency fund

function UseEmergencyDialog({
  data,
  categories,
  accounts,
  onClose,
}: {
  data: EssentialsDTO;
  categories: Option[];
  accounts: AccountOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const sources = data.emergency.sources.filter((s) => s.kind !== "holding");
  const [accountId, setAccountId] = useState(sources[0]?.id ?? "");
  const [kind, setKind] = useState<"expense" | "transfer">("expense");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(data.todayKey);
  const [categoryId, setCategoryId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const source = sources.find((s) => s.id === accountId);
  const err = (k: string) => errors[k]?.[0];

  function save() {
    start(async () => {
      const res = await spendEmergencyAction({
        accountId,
        kind,
        amountMinor: amount ?? Number.NaN,
        date: date ?? "",
        categoryId: kind === "expense" ? categoryId || null : null,
        toAccountId: kind === "transfer" ? toAccountId || null : null,
        description: description || null,
      });
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
        return;
      }
      toast.success("Emergency fund used");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use emergency fund</DialogTitle>
          <DialogDescription>
            Records an expense or transfer labelled &ldquo;Emergency fund use&rdquo;. The emergency
            earmark drops by the amount; free cash and opportunity money stay as they are.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField id="ef-account" label="From" error={err("accountId")}>
            <Select
              value={accountId}
              onValueChange={(v) => setAccountId(String(v ?? ""))}
              items={sources.map((s) => ({ value: s.id, label: s.name }))}
            >
              <SelectTrigger id="ef-account" className="w-full">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {source ? (
            <p className="-mt-1 text-xs text-muted-foreground">
              Emergency money here:{" "}
              <Money valueMinor={source.valueMinor} currency={source.currency} />
            </p>
          ) : null}
          <RadioGroup
            value={kind}
            onValueChange={(v) => setKind(v as "expense" | "transfer")}
            className="flex gap-4"
            aria-label="Kind"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="expense" /> Expense
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="transfer" /> Transfer to an account
            </label>
          </RadioGroup>
          <FormField id="ef-amount" label="Amount" error={err("amountMinor")}>
            <MoneyInput
              id="ef-amount"
              currency={source?.currency ?? data.currency}
              value={amount}
              onChange={setAmount}
              aria-invalid={Boolean(err("amountMinor"))}
            />
          </FormField>
          <FormField id="ef-date" label="Date" error={err("date")}>
            <DatePicker id="ef-date" value={date} onChange={setDate} />
          </FormField>
          {kind === "expense" ? (
            <FormField id="ef-category" label="Category" error={err("categoryId")}>
              <Select
                value={categoryId}
                onValueChange={(v) => setCategoryId(String(v ?? ""))}
                items={categories.map((c) => ({ value: c.id, label: c.label }))}
              >
                <SelectTrigger id="ef-category" className="w-full">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : (
            <FormField id="ef-to" label="To account" error={err("toAccountId")}>
              <Select
                value={toAccountId}
                onValueChange={(v) => setToAccountId(String(v ?? ""))}
                items={accounts
                  .filter((a) => a.id !== accountId)
                  .map((a) => ({ value: a.id, label: a.name }))}
              >
                <SelectTrigger id="ef-to" className="w-full">
                  <SelectValue placeholder="Choose an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
          <FormField id="ef-desc" label="Description (optional)" error={err("description")}>
            <Input
              id="ef-desc"
              value={description}
              placeholder="Emergency fund use"
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !accountId}>
            {pending ? "Saving…" : "Use emergency fund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmergencyCard({
  data,
  categories,
  accounts,
}: {
  data: EssentialsDTO;
  categories: Option[];
  accounts: AccountOption[];
}) {
  const e = data.emergency;
  const ccy = data.currency;
  const [using, setUsing] = useState(false);
  const canUse = e.sources.some((s) => s.kind !== "holding");
  const basisText =
    e.targetSource === "override"
      ? "Fixed target (Settings)"
      : `${e.months} months × ${e.basisUsed === "manual" ? "your monthly amount" : e.basisUsed === "essential" ? "essential spending" : "all spending"}`;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Emergency fund</CardTitle>
          <CardDescription>
            Target: {basisText}
            {e.basis === "essential" && e.basisUsed === "all"
              ? " (no essential spending yet, so all spending)"
              : ""}
            .
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setUsing(true)} disabled={!canUse}>
          Use emergency fund
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-2xl font-semibold">
              <Money valueMinor={e.currentMinor} currency={ccy} />
            </span>
            <span className="text-sm text-muted-foreground">
              of <Money valueMinor={e.targetMinor} currency={ccy} /> ·{" "}
              {formatPercentBp(e.progressBp)}
            </span>
          </div>
          <div
            className="h-3 rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(e.progressBp / 100)}
            aria-label="Emergency fund progress"
          >
            <div
              className={cn("h-3 rounded-full", TONE_BAR[e.tone])}
              style={{ width: `${Math.min(100, e.progressBp / 100)}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {TONE_TEXT[e.tone]} · covers {months(e.coverageTenths)} of{" "}
            <Money valueMinor={e.monthlyBasisMinor} currency={ccy} /> a month
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground">Available immediately</dt>
            <dd className="font-medium">
              <Money valueMinor={e.availableMinor} currency={ccy} />
            </dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground">Locked (less liquid holdings)</dt>
            <dd className="font-medium">
              <Money valueMinor={e.lockedMinor} currency={ccy} />
            </dd>
          </div>
        </dl>
        {e.sources.length ? (
          <div>
            <h3 className="mb-1 text-sm font-medium">What counts</h3>
            <ul className="divide-y rounded-lg border text-sm">
              {e.sources.map((s) => (
                <li
                  key={`${s.kind}-${s.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0">
                    <Link href={s.href} className="underline-offset-4 hover:underline">
                      {s.name}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">
                      {s.kind === "earmark"
                        ? "earmark"
                        : s.kind === "account"
                          ? "emergency account"
                          : s.available
                            ? "holding"
                            : "holding · locked"}
                    </span>
                  </span>
                  <Money valueMinor={s.valueMinor} currency={s.currency} />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing counts yet. Earmark money on an account, or flag an account or holding as
            emergency fund.
          </p>
        )}
        {e.fxMissing ? (
          <p className="text-xs text-muted-foreground">
            {e.fxMissing} item(s) left out: no exchange rate.
          </p>
        ) : null}
      </CardContent>
      {using ? (
        <UseEmergencyDialog
          data={data}
          categories={categories}
          accounts={accounts}
          onClose={() => setUsing(false)}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------------- insurance

function PolicyDialog({
  policy,
  currency,
  today,
  onClose,
}: {
  policy: PolicyDTO | null;
  currency: string;
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<PolicyType>(policy?.type ?? "life");
  const [provider, setProvider] = useState(policy?.provider ?? "");
  const [last4, setLast4] = useState(policy?.policyNumberLast4 ?? "");
  const [cover, setCover] = useState<number | null>(policy?.coverMinor ?? null);
  const [premium, setPremium] = useState<number | null>(policy?.premiumMinor ?? null);
  const [freq, setFreq] = useState<PremiumFrequency>(policy?.premiumFrequency ?? "yearly");
  const [startDate, setStartDate] = useState<string | null>(policy?.startDate ?? today);
  const [renewalDate, setRenewalDate] = useState<string | null>(policy?.renewalDate ?? null);
  const [nominee, setNominee] = useState(policy?.nominee ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const err = (k: string) => errors[k]?.[0];

  function save() {
    start(async () => {
      const res = await savePolicyAction(policy?.id ?? null, {
        type,
        provider,
        policyNumberLast4: last4 || null,
        coverMinor: cover ?? Number.NaN,
        premiumMinor: premium ?? Number.NaN,
        premiumFrequency: freq,
        startDate: startDate ?? "",
        renewalDate: renewalDate ?? "",
        nominee: nominee || null,
      });
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
        return;
      }
      toast.success(policy ? "Policy saved" : "Policy added");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{policy ? "Edit policy" : "Add policy"}</DialogTitle>
          <DialogDescription>
            Life and health cover count toward the health score.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="pol-type" label="Type" error={err("type")}>
            <Select
              value={type}
              onValueChange={(v) => setType(v as PolicyType)}
              items={Object.entries(POLICY_LABEL).map(([value, label]) => ({ value, label }))}
            >
              <SelectTrigger id="pol-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(POLICY_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="pol-provider" label="Provider" error={err("provider")}>
            <Input
              id="pol-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            />
          </FormField>
          <FormField id="pol-cover" label="Cover" error={err("coverMinor")}>
            <MoneyInput id="pol-cover" currency={currency} value={cover} onChange={setCover} />
          </FormField>
          <FormField
            id="pol-last4"
            label="Policy no. (last 4, optional)"
            error={err("policyNumberLast4")}
          >
            <Input
              id="pol-last4"
              value={last4}
              maxLength={4}
              onChange={(e) => setLast4(e.target.value)}
            />
          </FormField>
          <FormField id="pol-premium" label="Premium" error={err("premiumMinor")}>
            <MoneyInput
              id="pol-premium"
              currency={currency}
              value={premium}
              onChange={setPremium}
            />
          </FormField>
          <FormField id="pol-freq" label="Paid" error={err("premiumFrequency")}>
            <Select
              value={freq}
              onValueChange={(v) => setFreq(v as PremiumFrequency)}
              items={Object.entries(FREQ_LABEL).map(([value, label]) => ({ value, label }))}
            >
              <SelectTrigger id="pol-freq" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FREQ_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="pol-start" label="Start date" error={err("startDate")}>
            <DatePicker id="pol-start" value={startDate} onChange={setStartDate} />
          </FormField>
          <FormField id="pol-renewal" label="Renewal date" error={err("renewalDate")}>
            <DatePicker id="pol-renewal" value={renewalDate} onChange={setRenewalDate} />
          </FormField>
          <FormField id="pol-nominee" label="Nominee (optional)" error={err("nominee")}>
            <Input id="pol-nominee" value={nominee} onChange={(e) => setNominee(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CoverRow({
  label,
  cover,
  target,
  currency,
  hint,
}: {
  label: string;
  cover: number;
  target: number | null;
  currency: string;
  hint: React.ReactNode;
}) {
  const bp = target && target > 0 ? Math.min(10_000, Math.floor((cover * 10_000) / target)) : 0;
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          <Money valueMinor={cover} currency={currency} /> of{" "}
          {target === null ? "no target" : <Money valueMinor={target} currency={currency} />}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted" aria-hidden>
        <div
          className="h-2 rounded-full bg-[var(--viz-series-1)]"
          style={{ width: `${bp / 100}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function InsuranceCard({ data }: { data: EssentialsDTO }) {
  const router = useRouter();
  const ins = data.insurance;
  const ccy = data.currency;
  const [editing, setEditing] = useState<PolicyDTO | "new" | null>(null);
  const [, start] = useTransition();
  function toggle(p: PolicyDTO) {
    start(async () => {
      const res = await setPolicyStatusAction(p.id, p.status === "active" ? "lapsed" : "active");
      if (!res.ok) toast.error(res.error.message);
      else router.refresh();
    });
  }
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Insurance</CardTitle>
          <CardDescription>
            Premiums <Money valueMinor={ins.annualPremiumMinor} currency={ccy} /> a year.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden /> Add policy
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <CoverRow
          label="Life cover"
          cover={ins.lifeCoverMinor}
          target={ins.lifeTargetMinor}
          currency={ccy}
          hint={
            <>
              Target = income of the last 12 months (
              <Money valueMinor={ins.annualIncomeMinor} currency={ccy} />) ×{" "}
              {ins.lifeCoverIncomeMultiple}.
            </>
          }
        />
        <CoverRow
          label="Health cover"
          cover={ins.healthCoverMinor}
          target={ins.healthTargetMinor}
          currency={ccy}
          hint={
            ins.healthTargetMinor === null ? (
              <>
                Set a health cover target in{" "}
                <Link href="/settings" className="underline underline-offset-4">
                  Settings
                </Link>
                .
              </>
            ) : (
              "Target from Settings."
            )
          }
        />
        {ins.policies.length === 0 ? (
          <EmptyState
            title="No policies yet"
            description="Add life, health and other policies to track cover and renewals."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">Insurance policies</caption>
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Policy
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Cover
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Premium
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Renews
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ins.policies.map((p) => (
                  <tr
                    key={p.id}
                    className={cn("border-t", p.status === "lapsed" && "text-muted-foreground")}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{p.provider}</div>
                      <div className="text-xs text-muted-foreground">
                        {POLICY_LABEL[p.type]}
                        {p.policyNumberLast4 ? ` · …${p.policyNumberLast4}` : ""}
                        {p.status === "lapsed" ? " · lapsed" : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Money valueMinor={p.coverMinor} currency={ccy} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Money valueMinor={p.premiumMinor} currency={ccy} />
                      <div className="text-xs text-muted-foreground">
                        {FREQ_LABEL[p.premiumFrequency]}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {fmtDate(p.renewalDate)}
                      {p.status === "active" && p.daysToRenewal >= 0 && p.daysToRenewal <= 30 ? (
                        <Badge variant="outline" className="ml-2">
                          in {p.daysToRenewal}d
                        </Badge>
                      ) : null}
                      {p.status === "active" && p.daysToRenewal < 0 ? (
                        <Badge variant="destructive" className="ml-2">
                          past
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle(p)}>
                        {p.status === "active" ? "Mark lapsed" : "Reactivate"}
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button size="sm" variant="ghost">
                            Delete
                          </Button>
                        }
                        title={`Delete ${p.provider}?`}
                        description="Removes the policy and its renewal reminders. No transactions are affected."
                        confirmLabel="Delete"
                        destructive
                        onConfirm={async () => {
                          const res = await deletePolicyAction(p.id);
                          if (!res.ok) {
                            toast.error(res.error.message);
                            return false;
                          }
                          toast.success("Policy deleted");
                          router.refresh();
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {editing ? (
        <PolicyDialog
          policy={editing === "new" ? null : editing}
          currency={ccy}
          today={data.todayKey}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------------------------- debt + savings

function DebtCard({ data }: { data: EssentialsDTO }) {
  const d = data.debt;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Debt to income</CardTitle>
        <CardDescription>
          Monthly loan payments ÷ average income of the last 3 complete months.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="text-2xl font-semibold">
          {d.dtiBp === null ? "—" : formatPercentBp(d.dtiBp)}
        </div>
        <p className="text-muted-foreground">
          <Money valueMinor={d.monthlyEmiMinor} currency={data.currency} /> a month in EMIs ·{" "}
          <Money valueMinor={d.avgMonthlyIncomeMinor} currency={data.currency} /> average income
        </p>
        <p className="text-xs text-muted-foreground">
          Up to 30% scores full points; 60% or more scores none.
        </p>
        <Link href="/debts" className="text-sm underline underline-offset-4">
          Debts
        </Link>
      </CardContent>
    </Card>
  );
}

type TrendRow = EssentialsDTO["savings"]["trend"][number];

function SavingsTip({ active, payload }: TooltipContentProps) {
  const r = active
    ? (payload?.[0]?.payload as (TrendRow & { pct: number | null }) | undefined)
    : undefined;
  if (!r) return null;
  return (
    <TooltipShell title={format(parseISO(`${r.month}-01`), "MMMM yyyy")}>
      <TooltipRow
        color="var(--viz-series-1)"
        label="Savings rate"
        value={r.savingsRateBp === null ? "—" : formatPercentBp(r.savingsRateBp)}
      />
    </TooltipShell>
  );
}

function SavingsCard({ data }: { data: EssentialsDTO }) {
  const ax = useChartAxes();
  const rows = data.savings.trend.map((t) => ({
    ...t,
    pct: t.savingsRateBp === null ? null : t.savingsRateBp / 100,
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Savings rate</CardTitle>
        <CardDescription>
          Last 3 complete months:{" "}
          {data.savings.rateBp === null ? "—" : formatPercentBp(data.savings.rateBp)} (30% or more
          scores full points).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.every((r) => r.pct === null) ? (
          <NoData>Record income to see your savings rate.</NoData>
        ) : (
          <ChartFrame
            label="Savings rate by month"
            summary={`Savings rate for the last ${rows.length} complete months.`}
            rows={rows}
            height="h-48"
            columns={[
              { label: "Month", value: (r) => format(parseISO(`${r.month}-01`), "MMM yyyy") },
              {
                label: "Savings rate",
                numeric: true,
                value: (r) => (r.savingsRateBp === null ? "—" : formatPercentBp(r.savingsRateBp)),
              },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="month"
                  tickFormatter={(m: string) => format(parseISO(`${m}-01`), "MMM")}
                  {...ax.axis}
                  axisLine={{ stroke: "var(--border)" }}
                />
                <YAxis
                  tickFormatter={(v: number) => `${v}%`}
                  {...ax.axis}
                  axisLine={false}
                  width={ax.yWidth(44)}
                />
                <ReferenceLine y={0} stroke="var(--border)" />
                <ReferenceLine y={30} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                <Tooltip cursor={{ fill: "var(--muted)" }} content={(p) => <SavingsTip {...p} />} />
                <Bar
                  dataKey="pct"
                  fill="var(--viz-series-1)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        )}
      </CardContent>
    </Card>
  );
}

export function EssentialsClient({
  data,
  categories,
  accounts,
}: {
  data: EssentialsDTO;
  categories: Option[];
  accounts: AccountOption[];
}) {
  return (
    <div className="grid gap-4">
      <HealthCard data={data} />
      <div className="grid gap-4 xl:grid-cols-2">
        <EmergencyCard data={data} categories={categories} accounts={accounts} />
        <InsuranceCard data={data} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <DebtCard data={data} />
        <SavingsCard data={data} />
      </div>
    </div>
  );
}
