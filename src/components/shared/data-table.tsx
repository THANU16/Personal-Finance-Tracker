"use client";

import * as React from "react";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type CellData,
  type ColumnDef,
  type RowData,
  type SortingState,
  type TableFeatures,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Where a column goes in the phone card row (docs/07 §3: table → card list). */
export type MobileSlot = "title" | "subtitle" | "amount" | "meta" | "actions" | "hidden";

declare module "@tanstack/table-core" {
  // Declaration merging must repeat the original type parameters, used or not.
  /* eslint-disable @typescript-eslint/no-unused-vars */
  interface ColumnMeta<
    in out TFeatures extends TableFeatures,
    in out TData extends RowData,
    TValue extends CellData = CellData,
  > {
    /** Phone card slot; when no column sets one, rows fall back to label/value cards. */
    mobile?: MobileSlot;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}

// TanStack Table v9: features are explicit and must be stable (module scope).
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, datetime: sortFn_datetime },
});

export type DataTableFeatures = typeof dataTableFeatures;

/** Column helper bound to DataTable's features: `const col = dataTableColumns<Row>()`. */
export function dataTableColumns<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

export interface DataTableProps<TData extends RowData> {
  /** Define at module scope or memoise — a new array each render rebuilds the row model. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- column value types differ per column
  columns: ColumnDef<DataTableFeatures, TData, any>[];
  data: TData[];
  /** Shown instead of the table when `data` is empty. */
  empty?: React.ReactNode;
  initialSorting?: SortingState;
  getRowId?: (row: TData) => string;
}

function headerLabel(header: unknown): string | null {
  return typeof header === "string" ? header : null;
}

/**
 * Sortable table; below md rows become cards (min-w-0 so a long title truncates instead of
 * widening a grid/flex parent). Columns with `meta.mobile` slots render a compact
 * row (title/subtitle/meta left, amount right, actions); otherwise label/value cards.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  empty,
  initialSorting = [],
  getRowId,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    state: { sorting },
    onSortingChange: setSorting,
  });

  if (data.length === 0 && empty) return <>{empty}</>;

  const rows = table.getRowModel().rows;
  const slotted = columns.some((c) => c.meta?.mobile && c.meta.mobile !== "hidden");

  return (
    <>
      <div className="hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const content = header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  );
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {content}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3.5" aria-hidden />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3.5" aria-hidden />
                          ) : (
                            <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />
                          )}
                        </button>
                      ) : (
                        content
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {slotted ? (
        <ul className="min-w-0 divide-y rounded-xl border md:hidden">
          {rows.map((row) => {
            const cells = row.getAllCells();
            const inSlot = (slot: MobileSlot) =>
              cells.filter((c) => c.column.columnDef.meta?.mobile === slot);
            const meta = inSlot("meta");
            return (
              <li key={row.id} className="flex min-h-14 items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  {inSlot("title").map((c) => (
                    <div key={c.id} className="truncate font-medium">
                      <table.FlexRender cell={c} />
                    </div>
                  ))}
                  {inSlot("subtitle").map((c) => (
                    <div key={c.id} className="truncate text-sm text-muted-foreground">
                      <table.FlexRender cell={c} />
                    </div>
                  ))}
                  {meta.length ? (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {meta.map((c) => (
                        <span key={c.id}>
                          <table.FlexRender cell={c} />
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {inSlot("amount").map((c) => (
                  <div key={c.id} className="shrink-0 text-right font-medium tabular-nums">
                    <table.FlexRender cell={c} />
                  </div>
                ))}
                {inSlot("actions").map((c) => (
                  <div key={c.id} className="-mr-2 shrink-0">
                    <table.FlexRender cell={c} />
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="min-w-0 space-y-3 md:hidden">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border p-4">
              <dl className="space-y-1.5">
                {row.getAllCells().map((cell) => {
                  const label = headerLabel(cell.column.columnDef.header);
                  return (
                    <div key={cell.id} className="flex justify-between gap-4 text-sm">
                      {label ? <dt className="text-muted-foreground">{label}</dt> : null}
                      <dd className="text-right">
                        <table.FlexRender cell={cell} />
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
