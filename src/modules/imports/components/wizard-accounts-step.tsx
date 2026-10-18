"use client";

import { useMemo } from "react";
import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACCOUNT_TYPES } from "@/domain/accounts";
import { INSTRUMENT_TYPES } from "@/modules/holdings/constants";
import type { AccountChoice, WizardData, WizardState } from "@/modules/imports/schemas";
import { accountResolved } from "@/modules/imports/components/wizard-helpers";
import { Pick } from "@/modules/imports/components/wizard-pick";

const TYPE_LABEL: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  bank: "Bank",
  cash: "Cash",
  wallet: "Wallet",
  credit_card: "Credit card",
  loan: "Loan",
  broker_cash: "Broker cash",
  opportunity_fund: "Opportunity fund",
  receivable: "Receivable (owed to you)",
  payable: "Payable (you owe)",
};
const INSTRUMENT_LABEL: Partial<Record<(typeof INSTRUMENT_TYPES)[number], string>> = {
  stock: "Stock",
  mutual_fund: "Mutual fund",
  unit_trust: "Unit trust",
  crypto: "Crypto",
};
const instrumentOptions = INSTRUMENT_TYPES.filter((t) => t !== "fd").map((t) => ({
  value: t,
  label: INSTRUMENT_LABEL[t] ?? t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
}));
const TREAT_AS = [
  { value: "account", label: "Account" },
  { value: "holding", label: "Holding" },
  { value: "merge", label: "Merge into…" },
  { value: "ignore", label: "Ignore" },
];
const CREATE = "__create";

type SetState = React.Dispatch<React.SetStateAction<WizardState>>;

/** Step 2 — one row per Money Manager account (names trimmed and case-merged). */
export function AccountsStep({
  data,
  state,
  setState,
}: {
  data: WizardData;
  state: WizardState;
  setState: SetState;
}) {
  const initial = useMemo(() => data.state.accounts, [data.state.accounts]);
  const set = (key: string, choice: AccountChoice) =>
    setState((s) => ({ ...s, accounts: { ...s.accounts, [key]: choice } }));
  const ccy = data.baseCurrency;
  const defaultClass = data.options.assetClasses[0]?.id ?? "";

  function treatAs(key: string, name: string, value: string) {
    const current = state.accounts[key];
    if (value === "ignore") return set(key, { treatAs: "ignore" });
    if (value === "merge") return set(key, { treatAs: "merge", into: "" });
    if (value === "account") {
      const prior = initial[key];
      return set(
        key,
        prior?.treatAs === "account"
          ? prior
          : { treatAs: "account", existingId: null, create: { name, type: "bank", currency: ccy } },
      );
    }
    const prior = initial[key];
    set(
      key,
      prior?.treatAs === "holding"
        ? prior
        : current?.treatAs === "holding"
          ? current
          : {
              treatAs: "holding",
              existingId: null,
              create: {
                name,
                assetClassId: defaultClass,
                instrumentType: "unit_trust",
                liquidity: "medium",
              },
            },
    );
  }

  function createAllUnmatched() {
    setState((s) => {
      const accounts = { ...s.accounts };
      for (const a of data.accounts) {
        if (!accountResolved(accounts[a.key])) {
          accounts[a.key] = {
            treatAs: "account",
            existingId: null,
            create: { name: a.name, type: "bank", currency: ccy },
          };
        }
      }
      return { ...s, accounts };
    });
  }

  const ready = data.accounts.filter((a) => accountResolved(state.accounts[a.key])).length;

  return (
    <section aria-labelledby="accounts-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="accounts-title" className="text-lg font-semibold">
            Accounts
          </h2>
          <p className="text-sm text-muted-foreground">
            Decide where each Money Manager account goes. {ready} of {data.accounts.length} ready.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setState((s) => ({ ...s, accounts: initial }))}
          >
            Apply suggestions
          </Button>
          <Button variant="outline" size="sm" onClick={createAllUnmatched}>
            Create all unmatched as new
          </Button>
        </div>
      </div>

      <ul className="space-y-3">
        {data.accounts.map((a) => {
          const c = state.accounts[a.key];
          const ok = accountResolved(c);
          const holdingIsFd =
            c?.treatAs === "holding" && c.existingId
              ? data.options.holdings.find((h) => h.id === c.existingId)?.isFd
              : false;
          return (
            <li key={a.key} className="rounded-lg border p-4" data-testid={`mm-account-${a.key}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.rows} rows · {a.firstDate} – {a.lastDate} · in{" "}
                    <Money valueMinor={a.inMinor} currency={ccy} /> · out{" "}
                    <Money valueMinor={a.outMinor} currency={ccy} />
                    {a.hasDifference ? " · has Difference rows" : ""}
                  </p>
                </div>
                <Badge variant={ok ? "secondary" : "destructive"}>
                  {ok ? "Ready" : "Needs a choice"}
                </Badge>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-[10rem_1fr]">
                <Pick
                  label={`Treat ${a.name} as`}
                  value={c?.treatAs ?? ""}
                  options={TREAT_AS}
                  onChange={(v) => treatAs(a.key, a.name, v)}
                />
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {c?.treatAs === "account" ? (
                    <>
                      <Pick
                        label={`Target account for ${a.name}`}
                        value={c.existingId ?? CREATE}
                        options={[
                          { value: CREATE, label: "Create new account" },
                          ...data.options.accounts.map((o) => ({ value: o.id, label: o.name })),
                        ]}
                        onChange={(v) =>
                          set(
                            a.key,
                            v === CREATE
                              ? {
                                  treatAs: "account",
                                  existingId: null,
                                  create: c.create ?? { name: a.name, type: "bank", currency: ccy },
                                }
                              : { treatAs: "account", existingId: v, create: null },
                          )
                        }
                      />
                      {!c.existingId && c.create ? (
                        <>
                          <Input
                            aria-label={`New account name for ${a.name}`}
                            value={c.create.name}
                            onChange={(e) =>
                              set(a.key, { ...c, create: { ...c.create!, name: e.target.value } })
                            }
                          />
                          <Pick
                            label={`Account type for ${a.name}`}
                            value={c.create.type}
                            options={ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
                            onChange={(v) =>
                              set(a.key, {
                                ...c,
                                create: { ...c.create!, type: v as (typeof ACCOUNT_TYPES)[number] },
                              })
                            }
                          />
                          <p className="self-center text-sm text-muted-foreground">{ccy}</p>
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {c?.treatAs === "holding" ? (
                    <>
                      <Pick
                        label={`Target holding for ${a.name}`}
                        value={c.existingId ?? CREATE}
                        options={[
                          { value: CREATE, label: "Create new holding" },
                          ...data.options.holdings.map((o) => ({
                            value: o.id,
                            label: o.isFd ? `${o.name} (fixed deposit)` : o.name,
                          })),
                        ]}
                        onChange={(v) =>
                          set(
                            a.key,
                            v === CREATE
                              ? {
                                  treatAs: "holding",
                                  existingId: null,
                                  create: c.create ?? {
                                    name: a.name,
                                    assetClassId: defaultClass,
                                    instrumentType: "unit_trust",
                                    liquidity: "medium",
                                  },
                                }
                              : { treatAs: "holding", existingId: v, create: null },
                          )
                        }
                      />
                      {!c.existingId && c.create ? (
                        <>
                          <Input
                            aria-label={`New holding name for ${a.name}`}
                            value={c.create.name}
                            onChange={(e) =>
                              set(a.key, { ...c, create: { ...c.create!, name: e.target.value } })
                            }
                          />
                          <Pick
                            label={`Asset class for ${a.name}`}
                            value={c.create.assetClassId}
                            options={data.options.assetClasses.map((o) => ({
                              value: o.id,
                              label: o.name,
                            }))}
                            onChange={(v) =>
                              set(a.key, { ...c, create: { ...c.create!, assetClassId: v } })
                            }
                          />
                          <Pick
                            label={`Instrument type for ${a.name}`}
                            value={c.create.instrumentType}
                            options={instrumentOptions}
                            onChange={(v) =>
                              set(a.key, {
                                ...c,
                                create: {
                                  ...c.create!,
                                  instrumentType: v as Exclude<
                                    (typeof INSTRUMENT_TYPES)[number],
                                    "fd"
                                  >,
                                },
                              })
                            }
                          />
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {c?.treatAs === "merge" ? (
                    <Pick
                      label={`Merge ${a.name} into`}
                      value={c.into}
                      placeholder="Choose an account"
                      options={data.accounts
                        .filter((o) => o.key !== a.key)
                        .map((o) => ({ value: o.key, label: o.name }))}
                      onChange={(v) => set(a.key, { treatAs: "merge", into: v })}
                    />
                  ) : null}
                  {c?.treatAs === "ignore" ? (
                    <p className="self-center text-sm text-muted-foreground">
                      Its rows are left out (transfers with it are skipped).
                    </p>
                  ) : null}
                </div>
              </div>
              {holdingIsFd ? (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  Fixed deposits are valued from their terms, so Money Manager rows cannot be
                  imported into one. Choose another holding or create one.
                </p>
              ) : null}
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-muted-foreground">Sample rows</summary>
                <ul className="mt-1 space-y-0.5">
                  {a.samples.map((r, i) => (
                    <li key={i} className="flex flex-wrap gap-x-3 tabular-nums">
                      <span>{r.date}</span>
                      <span>{r.type}</span>
                      <span>{r.category}</span>
                      <Money valueMinor={r.amountMinor} currency={ccy} />
                      {r.note ? <span className="text-muted-foreground">{r.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
