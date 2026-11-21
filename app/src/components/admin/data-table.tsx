"use client";

/**
 * The admin data table (DESIGN.md section 3.8): shadcn Table driven by TanStack Table v9 with
 * sortable headers (`aria-sort` on the th, a real button inside). Dense and legible from 768px;
 * below that each row becomes a stacked block with the column name before each value.
 * Columns declare `meta.label` (used for the stacked label and the sort button's name) and
 * optionally `meta.numeric` (right-aligned, tabular figures).
 * With `pageSize`, only the first rows (in the current sort order) show, with "Show N more" and a
 * "Showing x of y" count below, so a long list stays usable on a phone.
 */
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/copy";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";

export const adminTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, datetime: sortFn_datetime, text: sortFn_text },
  columnMeta: {} as { label: string; numeric?: boolean; className?: string },
});

export type AdminFeatures = typeof adminTableFeatures;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- columns mix value types
export type AdminColumn<T extends RowData> = ColumnDef<AdminFeatures, T, any>;

/** Shared cell classes: stacked label below 768px, a table cell above. */
export const stackedCell =
  "max-md:grid max-md:grid-cols-[minmax(7rem,38%)_1fr] max-md:gap-x-3 max-md:px-0 max-md:py-1 max-md:whitespace-normal max-md:before:font-medium max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]";

export function AdminDataTable<T extends RowData>({
  columns,
  data,
  caption,
  initialSorting = [],
  getRowId,
  rowClassName,
  empty,
  pageSize,
}: {
  columns: AdminColumn<T>[];
  data: T[];
  /** Accessible table name (visually hidden). */
  caption: string;
  initialSorting?: SortingState;
  getRowId?: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
  /** Rows shown at first and added by each "Show more" (default: all). */
  pageSize?: number;
}) {
  const table = useTable({
    features: adminTableFeatures,
    columns,
    data,
    getRowId: getRowId ? (row: T) => getRowId(row) : undefined,
    initialState: { sorting: initialSorting },
  });

  // The limit resets to one page whenever the rows change (a filter, a delete).
  const [shownFor, setShownFor] = useState<{ data: T[]; n: number }>({ data, n: pageSize ?? Infinity });
  const limit = shownFor.data === data ? shownFor.n : (pageSize ?? Infinity);

  if (data.length === 0 && empty) return <>{empty}</>;

  const allRows = table.getRowModel().rows;
  const rows = allRows.slice(0, limit);
  const more = Math.min(pageSize ?? 0, allRows.length - rows.length);

  return (
    <div className="flex flex-col gap-3">
    <Table className="text-body max-md:block md:text-sm">
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader className="max-md:sr-only">
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const meta = header.column.columnDef.meta;
              const label = meta?.label ?? header.column.id;
              const sorted = header.column.getIsSorted();
              const canSort = header.column.getCanSort();
              const toggle = header.column.getToggleSortingHandler();
              return (
                <TableHead
                  key={header.id}
                  aria-sort={canSort ? (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none") : undefined}
                  className={cn("text-muted-foreground", meta?.numeric && "text-right", meta?.className)}
                >
                  {header.isPlaceholder ? null : canSort ? (
                    <button
                      type="button"
                      onClick={toggle}
                      aria-label={t("adminUi.sortBy", { column: label })}
                      className={cn(
                        "-mx-1.5 inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring",
                        meta?.numeric && "flex-row-reverse",
                      )}
                    >
                      <table.FlexRender header={header} />
                      {sorted === "asc" ? (
                        <ArrowUpIcon aria-hidden="true" className="size-3.5" />
                      ) : sorted === "desc" ? (
                        <ArrowDownIcon aria-hidden="true" className="size-3.5" />
                      ) : (
                        <ArrowUpDownIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                      )}
                    </button>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody className="max-md:block">
        {rows.map((row) => (
          <TableRow
            key={row.id}
            className={cn("max-md:block max-md:border-b max-md:py-3", rowClassName?.(row.original))}
          >
            {row.getAllCells().map((cell) => {
              const meta = cell.column.columnDef.meta;
              return (
                <TableCell
                  key={cell.id}
                  data-label={meta?.label ?? ""}
                  className={cn(
                    "align-top md:py-2.5",
                    meta?.numeric && "num md:text-right",
                    stackedCell,
                    meta?.className,
                  )}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
      {pageSize !== undefined && allRows.length > pageSize ? (
        <div className="flex flex-wrap items-center gap-3" data-slot="table-more">
          <p className="text-caption text-muted-foreground num" aria-live="polite">
            {t("adminUi.showingOf", { shown: formatInt(rows.length), total: formatInt(allRows.length) })}
          </p>
          {more > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setShownFor({ data, n: limit + (pageSize ?? 0) })}>
              {t("adminUi.showMore", { n: formatInt(more) })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A plain (non-sortable) responsive table for small summaries: header labels + rows of cells. Below
 * 768px each row stacks into label / value pairs, unless `stacked` is false (a short two-column list
 * that fits a phone as a table, with no hover fill spilling over its panel).
 */
export function SimpleTable({
  caption,
  columns,
  rows,
  numeric = [],
  className,
  captionVisible = false,
  stacked = true,
}: {
  caption: string;
  columns: string[];
  rows: ReactNode[][];
  /** Column indexes that hold numbers (right-aligned, tabular). */
  numeric?: number[];
  className?: string;
  captionVisible?: boolean;
  stacked?: boolean;
}) {
  return (
    <Table className={cn("text-body md:text-sm", stacked ? "max-md:block" : "text-sm", className)}>
      <TableCaption
        className={cn(captionVisible ? "mt-0 mb-2 caption-top text-left text-body font-semibold text-foreground" : "sr-only")}
      >
        {caption}
      </TableCaption>
      <TableHeader className={cn(stacked && "max-md:sr-only")}>
        <TableRow className="hover:bg-transparent">
          {columns.map((c, i) => (
            <TableHead key={c} className={cn("text-muted-foreground", numeric.includes(i) && "text-right", !stacked && "first:pl-0 last:pr-0")}>
              {c}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody className={cn(stacked && "max-md:block")}>
        {rows.map((r, ri) => (
          <TableRow key={ri} className={stacked ? "max-md:block max-md:border-b max-md:py-2" : "hover:bg-transparent"}>
            {r.map((cell, ci) => (
              <TableCell
                key={ci}
                data-label={columns[ci]}
                className={cn(
                  "align-top",
                  numeric.includes(ci) && (stacked ? "num md:text-right" : "num text-right"),
                  stacked ? stackedCell : "whitespace-normal first:pl-0 last:pr-0",
                )}
              >
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
