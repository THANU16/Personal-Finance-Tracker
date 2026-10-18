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
  type ColumnDef,
  type RowData,
  type SortingState,
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

/** Sortable table; below 640px rows become stacked cards labelled by column header. */
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

  return (
    <>
      <div className="hidden rounded-xl border sm:block">
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

      <ul className="space-y-3 sm:hidden">
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
    </>
  );
}
