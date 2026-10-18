"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowDown, ArrowUp, Lock, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField, fieldAria } from "@/components/shared/form-field";
import type { ActionResult } from "@/server/action-result";
import {
  archiveAssetClassAction,
  createAssetClassAction,
  updateAssetClassAction,
} from "@/modules/asset-classes/actions";
import type { AssetClassDTO } from "@/modules/asset-classes/schemas";

/** Settings → Asset classes: colour (used in every chart), order, custom classes. */
export function AssetClassesManager({ classes }: { classes: AssetClassDTO[] }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState("#64748b");
  const [error, setError] = React.useState<string>();
  const [pending, setPending] = React.useState(false);

  function run(fn: () => Promise<ActionResult<unknown>>, success?: string) {
    void fn().then((result) => {
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });
  }

  /** Swap sort order with the neighbour. */
  function move(index: number, dir: -1 | 1) {
    const a = classes[index]!;
    const b = classes[index + dir];
    if (!b) return;
    run(async () => {
      const first = await updateAssetClassAction(a.id, { sortOrder: b.sortOrder });
      if (!first.ok) return first;
      return updateAssetClassAction(b.id, {
        sortOrder: a.sortOrder === b.sortOrder ? a.sortOrder + dir : a.sortOrder,
      });
    });
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await createAssetClassAction({ name, color });
    setPending(false);
    if (!result.ok) {
      setError(result.error.fieldErrors?.name?.[0] ?? result.error.message);
      return;
    }
    setName("");
    setError(undefined);
    toast.success(`${result.data.name} added`);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Asset classes</CardTitle>
        <CardDescription>
          Group holdings for allocation and rebalancing. Colours are used in every chart.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="divide-y">
          {classes.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <input
                type="color"
                aria-label={`Colour for ${c.name}`}
                defaultValue={c.color}
                className="size-7 cursor-pointer rounded border bg-transparent p-0.5"
                onChange={(e) => {
                  const value = e.target.value;
                  run(() => updateAssetClassAction(c.id, { color: value }));
                }}
              />
              <span className="flex-1 font-medium">{c.name}</span>
              {c.isSystem ? (
                <Badge variant="outline">
                  <Lock aria-hidden /> System
                </Badge>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${c.name} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${c.name} down`}
                disabled={i === classes.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown aria-hidden />
              </Button>
              {!c.isSystem ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Archive ${c.name}`}
                  onClick={() => run(() => archiveAssetClassAction(c.id), `${c.name} archived`)}
                >
                  <Archive aria-hidden />
                </Button>
              ) : (
                <span className="w-7" />
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={add} noValidate className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <FormField id="new-asset-class" label="New asset class" error={error}>
              <Input
                id="new-asset-class"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Private equity"
                {...fieldAria("new-asset-class", error)}
              />
            </FormField>
          </div>
          <input
            type="color"
            aria-label="Colour for the new asset class"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="size-8 cursor-pointer rounded border bg-transparent p-0.5"
          />
          <Button type="submit" disabled={pending || !name.trim()}>
            <Plus aria-hidden /> Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
