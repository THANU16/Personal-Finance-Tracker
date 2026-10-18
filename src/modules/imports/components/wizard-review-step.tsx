"use client";

import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { WizardData, WizardRowRef, WizardState } from "@/modules/imports/schemas";

type SetState = React.Dispatch<React.SetStateAction<WizardState>>;

function Panel({
  title,
  count,
  children,
  open,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="rounded-lg border" open={open}>
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 font-medium">
        {title}
        <Badge variant="outline">{count}</Badge>
      </summary>
      <div className="overflow-x-auto border-t px-4 py-3">{children}</div>
    </details>
  );
}

function RowCells({ r, ccy }: { r: WizardRowRef; ccy: string }) {
  return (
    <>
      <td className="py-1 pr-3 whitespace-nowrap tabular-nums">{r.date}</td>
      <td className="py-1 pr-3">{r.account}</td>
      <td className="py-1 pr-3">{r.category}</td>
      <td className="py-1 pr-3 text-right">
        <Money valueMinor={r.amountMinor} currency={ccy} />
      </td>
      <td className="py-1 pr-3 text-muted-foreground">
        {[r.note, r.description].filter(Boolean).join(" · ")}
      </td>
    </>
  );
}

/** Step 5 — transfers, fees, Difference rows and problem rows. */
export function ReviewStep({
  data,
  state,
  setState,
}: {
  data: WizardData;
  state: WizardState;
  setState: SetState;
}) {
  const ccy = data.baseCurrency;
  const detached = new Set(state.detachFeeIds);
  const attached = data.transfers.filter((t) => t.fee);
  const targetKind = (account: string) => {
    const key = account.trim().toLowerCase().replace(/\s+/g, " ");
    let c = state.accounts[key];
    const seen = new Set<string>();
    while (c?.treatAs === "merge" && !seen.has(c.into)) {
      seen.add(c.into);
      c = state.accounts[c.into];
    }
    return c?.treatAs ?? "ignore";
  };
  const toggleDetach = (id: string, on: boolean) =>
    setState((s) => ({
      ...s,
      detachFeeIds: on
        ? [...new Set([...s.detachFeeIds, id])]
        : s.detachFeeIds.filter((x) => x !== id),
    }));

  return (
    <section aria-labelledby="review-title" className="space-y-4">
      <div>
        <h2 id="review-title" className="text-lg font-semibold">
          Review special rows
        </h2>
        <p className="text-sm text-muted-foreground">
          Money Manager stores a transfer as two rows and its fee as a third. Check how they were
          matched.
        </p>
      </div>

      <Panel title="Transfers" count={data.transfers.length}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">When</th>
              <th className="py-1 pr-3 font-medium">From</th>
              <th className="py-1 pr-3 font-medium">To</th>
              <th className="py-1 pr-3 text-right font-medium">Amount</th>
              <th className="py-1 pr-3 text-right font-medium">Fee</th>
            </tr>
          </thead>
          <tbody>
            {data.transfers.map((t) => (
              <tr key={t.out.id} className="border-t">
                <td className="py-1 pr-3 whitespace-nowrap tabular-nums">{t.out.date}</td>
                <td className="py-1 pr-3">{t.out.account}</td>
                <td className="py-1 pr-3">{t.in.account}</td>
                <td className="py-1 pr-3 text-right">
                  <Money valueMinor={t.out.amountMinor} currency={ccy} />
                </td>
                <td className="py-1 pr-3 text-right">
                  {t.fee && !detached.has(t.fee.id) ? (
                    <Money valueMinor={t.fee.amountMinor} currency={ccy} />
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.problems.some((p) => p.reason.includes("other half")) ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Unpaired halves are listed under Problem rows and skipped.
          </p>
        ) : null}
      </Panel>

      <Panel title="Fees" count={attached.length + data.standaloneFees.length}>
        <p className="mb-2 text-sm text-muted-foreground">
          An attached fee is added to its transfer; a standalone fee becomes a “Bank fees” expense.
        </p>
        <table className="w-full text-sm">
          <tbody>
            {attached.map((t) => (
              <tr key={t.fee!.id} className="border-t">
                <RowCells r={t.fee!} ccy={ccy} />
                <td className="py-1">
                  <label className="flex items-center gap-2 whitespace-nowrap">
                    <Checkbox
                      checked={!detached.has(t.fee!.id)}
                      onCheckedChange={(v) => toggleDetach(t.fee!.id, v !== true)}
                    />
                    On transfer to {t.in.account}
                  </label>
                </td>
              </tr>
            ))}
            {data.standaloneFees.map((f) => (
              <tr key={f.id} className="border-t">
                <RowCells r={f} ccy={ccy} />
                <td className="py-1 whitespace-nowrap">
                  {data.ambiguousFeeIds.includes(f.id)
                    ? "Several matches → Bank fees"
                    : "Standalone → Bank fees"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Difference rows" count={data.differences.length}>
        <p className="mb-2 text-sm text-muted-foreground">
          Money Manager’s balance corrections. On an account they become an adjustment; on a holding
          they update its value (an empty holding gets an opening value).
        </p>
        <table className="w-full text-sm">
          <tbody>
            {data.differences.map((d) => {
              const kind = targetKind(d.account);
              return (
                <tr key={d.id} className="border-t">
                  <RowCells r={d} ccy={ccy} />
                  <td className="py-1 whitespace-nowrap">
                    {kind === "holding"
                      ? "Valuation"
                      : kind === "account"
                        ? d.type === "Income"
                          ? "Adjustment (in)"
                          : "Adjustment (out)"
                        : "Skipped (ignored account)"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title="Problem rows" count={data.problems.length} open={data.problems.length > 0}>
        {data.problems.length ? (
          <>
            <p className="mb-2 text-sm text-muted-foreground">
              These rows are skipped. Fix them in Money Manager and upload the file again if you
              need them.
            </p>
            <table className="w-full text-sm">
              <tbody>
                {data.problems.map((p) => (
                  <tr key={p.row.id} className="border-t">
                    <RowCells r={p.row} ccy={ccy} />
                    <td className="py-1 text-destructive">{p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No problems found.</p>
        )}
      </Panel>
      {state.detachFeeIds.length ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setState((s) => ({ ...s, detachFeeIds: [] }))}
        >
          Re-attach all fees
        </Button>
      ) : null}
    </section>
  );
}
