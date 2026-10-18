"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AllocationTreeEditor } from "@/components/shared/allocation-tree-editor";
import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AllocationTree } from "@/domain/allocation";
import type { TreeOptions } from "@/modules/allocation/schemas";
import { saveFundSettingsAction } from "@/modules/opportunity-fund/actions";
import type { OpportunityOverviewDTO } from "@/modules/opportunity-fund/schemas";

const NONE = "__none";

/** Rules editor (drawdown %, cumulative deploy %), benchmark, target size and allocation (docs/05 §8). */
export function FundSettings({
  data,
  treeOptions,
  accounts,
}: {
  data: OpportunityOverviewDTO;
  treeOptions: TreeOptions;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const s = data.settings;
  const [benchmark, setBenchmark] = useState(s.benchmarkName);
  const [target, setTarget] = useState<number | null>(s.targetSizeMinor);
  const [rules, setRules] = useState<
    { drawdownBp: number | null; deployPercentBp: number | null }[]
  >(s.rules);
  const [source, setSource] = useState(s.allocationSource);
  const [tree, setTree] = useState<AllocationTree>(
    s.allocation.length ? s.allocation : data.allocationInUse,
  );
  const [defaultSource, setDefaultSource] = useState(s.defaultSourceAccountId ?? NONE);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await saveFundSettingsAction({
        benchmarkName: benchmark,
        targetSizeMinor: target && !Number.isNaN(target) ? target : null,
        rules: rules.map((r) => ({
          drawdownBp: r.drawdownBp ?? Number.NaN,
          deployPercentBp: r.deployPercentBp ?? Number.NaN,
        })),
        allocationSource: source,
        allocation: source === "custom" ? tree : null,
        defaultSourceAccountId: defaultSource === NONE ? null : defaultSource,
      });
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
        return;
      }
      setErrors({});
      toast.success("Opportunity fund saved");
      router.refresh();
    });
  }

  const ruleError = (i: number) =>
    errors[`rules.${i}.drawdownBp`]?.[0] ?? errors[`rules.${i}.deployPercentBp`]?.[0];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="opp-benchmark" label="Benchmark" error={errors.benchmarkName?.[0]}>
          <Input
            id="opp-benchmark"
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value)}
          />
        </FormField>
        <FormField id="opp-target" label="Target fund size (optional)">
          <MoneyInput
            id="opp-target"
            currency={data.baseCurrency}
            value={target}
            onChange={setTarget}
          />
        </FormField>
        <FormField id="opp-default-source" label="Default source account">
          <Select
            value={defaultSource}
            onValueChange={(v) => setDefaultSource(String(v ?? NONE))}
            items={[
              { value: NONE, label: "None" },
              ...accounts.map((a) => ({ value: a.id, label: a.name })),
            ]}
          >
            <SelectTrigger id="opp-default-source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Rules</legend>
        <p className="text-xs text-muted-foreground">
          When the {benchmark || "benchmark"} falls this far from its high, have deployed this share
          of the fund (as it was when the cycle started). Shares are cumulative; each rule fires
          once per cycle.
        </p>
        <ul className="space-y-2">
          {rules.map((r, i) => (
            <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <FormField id={`rule-dd-${i}`} label={i === 0 ? "Drop from high" : ""}>
                <PercentInput
                  id={`rule-dd-${i}`}
                  aria-label={`Rule ${i + 1} drop`}
                  value={r.drawdownBp}
                  onChange={(v) =>
                    setRules((rs) => rs.map((x, j) => (j === i ? { ...x, drawdownBp: v } : x)))
                  }
                />
              </FormField>
              <FormField id={`rule-dp-${i}`} label={i === 0 ? "Deployed by then" : ""}>
                <PercentInput
                  id={`rule-dp-${i}`}
                  aria-label={`Rule ${i + 1} deploy`}
                  value={r.deployPercentBp}
                  onChange={(v) =>
                    setRules((rs) => rs.map((x, j) => (j === i ? { ...x, deployPercentBp: v } : x)))
                  }
                />
              </FormField>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove rule ${i + 1}`}
                disabled={rules.length === 1}
                onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden />
              </Button>
              {ruleError(i) ? (
                <p className="col-span-3 text-xs text-destructive">{ruleError(i)}</p>
              ) : null}
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rules.length >= 10}
          onClick={() => setRules((rs) => [...rs, { drawdownBp: null, deployPercentBp: null }])}
        >
          <Plus aria-hidden /> Add rule
        </Button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Allocation for deployments</legend>
        <Select
          value={source}
          onValueChange={(v) => setSource(v === "custom" ? "custom" : "target")}
          items={[
            { value: "target", label: "Target allocation (default)" },
            { value: "custom", label: "Custom for the fund" },
          ]}
        >
          <SelectTrigger aria-label="Allocation for deployments" className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="target">Target allocation (default)</SelectItem>
            <SelectItem value="custom">Custom for the fund</SelectItem>
          </SelectContent>
        </Select>
        {source === "custom" ? (
          <AllocationTreeEditor
            value={tree}
            onChange={setTree}
            options={treeOptions}
            requireAssets
            currency={data.baseCurrency}
            holdingCurrency={data.baseCurrency}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Deployments follow your target allocation (Allocation → Plan).
            {data.allocationInUse.length ? "" : " It is not set yet."}
          </p>
        )}
        {errors.allocation?.[0] ? (
          <p className="text-xs text-destructive">{errors.allocation[0]}</p>
        ) : null}
      </fieldset>

      <Button onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save fund settings"}
      </Button>
    </div>
  );
}
