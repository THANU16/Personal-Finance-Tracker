"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AllocationTreeEditor, treeIsValid } from "@/components/shared/allocation-tree-editor";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { PercentInput } from "@/components/shared/percent-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AllocationTree } from "@/domain/allocation";
import { saveTargetAction } from "@/modules/allocation/actions";
import type { TargetDTO, TreeOptions } from "@/modules/allocation/schemas";
import { PinnedOnPhone } from "@/components/shared/mobile/pinned-on-phone";

/** /rebalancing → Plan: the single planned (target) allocation (docs/04 §6). */
export function TargetEditor({ target, options }: { target: TargetDTO; options: TreeOptions }) {
  const router = useRouter();
  const [tree, setTree] = useState<AllocationTree>(target.allocation);
  const [threshold, setThreshold] = useState<number | null>(target.thresholdBp);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const valid = tree.length > 0 && treeIsValid(tree, options) && (threshold ?? 0) >= 50;

  async function save() {
    setPending(true);
    setError(null);
    const result = await saveTargetAction({
      allocation: tree,
      thresholdBp: threshold ?? 0,
      note: note || null,
    });
    setPending(false);
    if (!result.ok) {
      setError(Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message);
      toast.error(result.error.message);
      return;
    }
    toast.success("Target allocation saved");
    for (const w of result.data.warnings) toast.warning(w);
    setNote("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Target allocation</CardTitle>
        <CardDescription>
          Your one planned allocation. SIP plans and opportunity deployments follow it unless they
          use their own split. Saving re-plans SIP periods that have not been executed yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <AllocationTreeEditor value={tree} onChange={setTree} options={options} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="threshold"
            label="Drift alert threshold"
            description="Flag a class when it is this far from its target."
          >
            <PercentInput
              id="threshold"
              value={threshold}
              onChange={setThreshold}
              {...fieldAria("threshold", undefined, true)}
            />
          </FormField>
          <FormField
            id="target-note"
            label="Note (optional)"
            description="Saved with this version in the history."
          >
            <Input
              id="target-note"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              {...fieldAria("target-note", undefined, true)}
            />
          </FormField>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <PinnedOnPhone className="flex justify-end">
          <Button onClick={() => void save()} disabled={!valid || pending}>
            {pending ? "Saving…" : "Save target"}
          </Button>
        </PinnedOnPhone>
      </CardContent>
    </Card>
  );
}
