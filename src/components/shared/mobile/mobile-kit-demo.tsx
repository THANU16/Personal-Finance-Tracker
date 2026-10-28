"use client";

import * as React from "react";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, dataTableColumns } from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { StatStrip } from "@/components/shared/stat-strip";
import { ActionSheet } from "@/components/shared/mobile/action-sheet";
import { FilterChips, FilterSheet } from "@/components/shared/mobile/filter-sheet";
import { InfoTip } from "@/components/shared/mobile/info-tip";
import { KeyboardSafeForm } from "@/components/shared/mobile/keyboard-safe-form";
import { ResponsiveSelect, type PickerOption } from "@/components/shared/mobile/responsive-select";
import { SegmentedControl } from "@/components/shared/mobile/segmented-control";
import { StickyActionBar } from "@/components/shared/mobile/sticky-action-bar";

// Sample data only — nothing here reads or writes the ledger.

const ACCOUNTS: PickerOption[] = [
  ...["Cash wallet", "Commercial Bank Savings", "Sampath Current", "NSB Emergency"].map(
    (label) => ({
      value: label,
      label,
      group: "Cash & bank",
      description: "LKR",
    }),
  ),
  ...["HNB Visa", "Amex Gold"].map((label) => ({ value: label, label, group: "Cards" })),
  ...["CAL broker cash", "Interactive Brokers USD"].map((label) => ({
    value: label,
    label,
    group: "Investment cash",
  })),
  ...Array.from({ length: 12 }, (_, i) => ({
    value: `extra-${i}`,
    label: `Savings pot ${i + 1}`,
    group: "Other",
  })),
];

const REPORT_TABS = [
  "Monthly summary",
  "Income vs expense",
  "Categories",
  "Investment performance",
  "Realised gains",
  "Investment income & tax",
  "Net worth history",
].map((label) => ({ value: label, label }));

interface Row {
  id: string;
  name: string;
  institution: string;
  balanceMinor: number;
  updated: string;
}

const ROWS: Row[] = [
  {
    id: "1",
    name: "Commercial Bank Savings",
    institution: "Commercial Bank",
    balanceMinor: 294595915,
    updated: "28 Oct",
  },
  { id: "2", name: "Cash wallet", institution: "Cash", balanceMinor: 16863131, updated: "27 Oct" },
  { id: "3", name: "HNB Visa", institution: "HNB", balanceMinor: -5286234, updated: "25 Oct" },
];

const col = dataTableColumns<Row>();
const COLUMNS = [
  col.accessor("name", { header: "Account", meta: { mobile: "title" } }),
  col.accessor("institution", { header: "Institution", meta: { mobile: "subtitle" } }),
  col.accessor("updated", { header: "Updated", meta: { mobile: "meta" } }),
  col.accessor("balanceMinor", {
    header: "Balance",
    meta: { mobile: "amount" },
    cell: (info) => <Money valueMinor={info.getValue()} currency="LKR" />,
  }),
  col.display({
    id: "actions",
    header: "",
    meta: { mobile: "actions" },
    cell: (info) => <RowActions name={info.row.original.name} />,
  }),
];

function RowActions({ name }: { name: string }) {
  return (
    <ActionSheet
      title={name}
      trigger={
        <Button variant="ghost" size="icon" aria-label={`Actions for ${name}`}>
          <MoreHorizontal />
        </Button>
      }
      actions={[
        { label: "Edit", icon: Pencil, onSelect: () => toast.info(`Edit ${name}`) },
        { label: "Duplicate", icon: Copy, onSelect: () => toast.info(`Duplicate ${name}`) },
        {
          label: "Void",
          icon: Trash2,
          destructive: true,
          onSelect: () => toast.error(`Void ${name}`),
        },
      ]}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

export function MobileKitDemo() {
  const [amount, setAmount] = React.useState<number | null>(2_500_000);
  const [bigAmount, setBigAmount] = React.useState<number | null>(null);
  const [account, setAccount] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState(REPORT_TABS[0].value);
  const [period, setPeriod] = React.useState("week");
  const [filters, setFilters] = React.useState<{ type: string | null; account: string | null }>({
    type: "Expense",
    account: "Cash wallet",
  });
  const [toggle, setToggle] = React.useState(true);

  const chips = [
    ...(filters.type
      ? [
          {
            key: "type",
            label: filters.type,
            onRemove: () => setFilters((f) => ({ ...f, type: null })),
          },
        ]
      : []),
    ...(filters.account
      ? [
          {
            key: "account",
            label: filters.account,
            onRemove: () => setFilters((f) => ({ ...f, account: null })),
          },
        ]
      : []),
  ];

  return (
    <div className="grid gap-4">
      <Section title="Stat strip">
        <StatStrip
          className="md:grid-cols-2 lg:grid-cols-4"
          stats={[
            { label: "Net worth", value: <Money valueMinor={797123456} currency="LKR" compact /> },
            { label: "Assets", value: <Money valueMinor={968000000} currency="LKR" compact /> },
            {
              label: "Liabilities",
              value: <Money valueMinor={172000000} currency="LKR" compact />,
            },
            { label: "Savings rate", value: "53.0%" },
            { label: "Runway", value: "36.8 months" },
          ]}
        />
      </Section>

      <Section title="Primitives (44px on phones)">
        <div className="flex flex-wrap gap-2">
          <Button>Default</Button>
          <Button variant="outline" size="sm">
            Small
          </Button>
          <Button variant="secondary" size="lg">
            Large
          </Button>
          <Button variant="ghost" size="icon" aria-label="More">
            <MoreHorizontal />
          </Button>
        </div>
        <FormField id="kit-name" label="Name">
          <Input id="kit-name" placeholder="Text input (16px on phones)" />
        </FormField>
        <div className="flex items-center gap-3">
          <Switch id="kit-switch" checked={toggle} onCheckedChange={setToggle} />
          <Label htmlFor="kit-switch">Include in net worth</Label>
        </div>
      </Section>

      <Section title="Money input">
        <FormField id="kit-amount" label="Amount (thousands separators while typing)">
          <MoneyInput id="kit-amount" currency="LKR" value={amount} onChange={setAmount} />
        </FormField>
        <p className="text-sm text-muted-foreground">
          Stored value:{" "}
          {amount === null ? "empty" : Number.isNaN(amount) ? "invalid" : `${amount} minor units`}
        </p>
        <FormField id="kit-big" label="Big amount (Quick add)">
          <MoneyInput
            id="kit-big"
            size="lg"
            currency="LKR"
            value={bigAmount}
            onChange={setBigAmount}
            placeholder="0.00"
          />
        </FormField>
      </Section>

      <Section title="Picker sheet">
        <FormField id="kit-account" label="Account">
          <ResponsiveSelect
            id="kit-account"
            value={account}
            onValueChange={setAccount}
            options={ACCOUNTS}
            placeholder="Choose an account"
          />
        </FormField>
      </Section>

      <Section title="Segmented control">
        <SegmentedControl
          aria-label="Report"
          items={REPORT_TABS}
          value={tab}
          onValueChange={setTab}
        />
        <SegmentedControl
          aria-label="Granularity"
          fill
          items={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
          value={period}
          onValueChange={setPeriod}
        />
      </Section>

      <Section title="Filters, info and menus">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSheet
            activeCount={chips.length}
            onClearAll={() => setFilters({ type: null, account: null })}
          >
            <FormField id="kit-filter-type" label="Type">
              <ResponsiveSelect
                id="kit-filter-type"
                value={filters.type}
                onValueChange={(type) => setFilters((f) => ({ ...f, type }))}
                options={["Expense", "Income", "Transfer"].map((v) => ({ value: v, label: v }))}
                placeholder="Any type"
              />
            </FormField>
            <FormField id="kit-filter-account" label="Account">
              <ResponsiveSelect
                id="kit-filter-account"
                value={filters.account}
                onValueChange={(acc) => setFilters((f) => ({ ...f, account: acc }))}
                options={ACCOUNTS}
                placeholder="Any account"
              />
            </FormField>
          </FilterSheet>
          <span className="flex items-center gap-1 text-sm">
            Safe to spend
            <InfoTip label="About safe to spend">
              Free cash minus bills due before your next income.
            </InfoTip>
          </span>
        </div>
        <FilterChips chips={chips} />
      </Section>

      <Section title="Card list (DataTable slots)">
        <DataTable columns={COLUMNS} data={ROWS} getRowId={(r) => r.id} />
      </Section>

      <Section title="Sheets">
        <div className="flex flex-wrap gap-2">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>Open form sheet</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add account</DialogTitle>
                <DialogDescription>
                  A bottom sheet on phones; a dialog on desktop.
                </DialogDescription>
              </DialogHeader>
              <KeyboardSafeForm
                id="kit-sheet-form"
                className="grid gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  toast.success("Submitted");
                }}
              >
                {["Name", "Institution", "Account number", "Notes"].map((label) => (
                  <FormField key={label} id={`kit-sheet-${label}`} label={label}>
                    <Input id={`kit-sheet-${label}`} />
                  </FormField>
                ))}
                <FormField id="kit-sheet-balance" label="Opening balance">
                  <MoneyInput
                    id="kit-sheet-balance"
                    currency="LKR"
                    value={null}
                    onChange={() => {}}
                  />
                </FormField>
              </KeyboardSafeForm>
              <DialogFooter>
                <Button type="submit" form="kit-sheet-form">
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <ConfirmDialog
            trigger={<Button variant="destructive">Void…</Button>}
            title="Void this transaction?"
            description="Voids 1 transaction and restores LKR 1,343.17 to Cash wallet."
            confirmLabel="Void"
            destructive
            onConfirm={() => {
              toast.success("Voided (demo)");
            }}
          />
        </div>
      </Section>

      <StickyActionBar summary="2 changed">
        <Button variant="outline">Discard</Button>
        <Button onClick={() => toast.success("Saved (demo)")}>Save all</Button>
      </StickyActionBar>
    </div>
  );
}
