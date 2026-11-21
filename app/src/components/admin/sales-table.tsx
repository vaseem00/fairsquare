"use client";

/**
 * Sales tab (DESIGN.md section 3.8): a table filtered by building (a searchable combobox: thousands
 * of DLD buildings) and bedrooms, newest first, with a Delete button per row that confirms with an
 * AlertDialog ("Delete this sale?"). 20 rows show at first, with "Show 20 more" and a count below.
 * The building shows with its area (DLD names repeat across areas).
 */
import { createColumnHelper } from "@tanstack/react-table";
import { Trash2Icon } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { BuildingCombobox, type BuildingOption } from "@/components/admin/building-combobox";
import { AdminDataTable, adminTableFeatures, type AdminColumn } from "@/components/admin/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminApi } from "@/lib/api/admin-client";
import { COPY, t } from "@/lib/copy";
import { bedsOption, formatDate, formatInt } from "@/lib/format";
import { ADMIN_SALES_LIMIT, type AdminSale } from "@/lib/validation/admin";

const col = createColumnHelper<typeof adminTableFeatures, AdminSale>();
const ALL = "all";

export const BEDROOM_VALUES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** Rows per "Show more": up to 500 stacked cards would make an endless page on a phone. */
export const SALES_PAGE = 20;

function DeleteSale({ sale, onDeleted }: { sale: AdminSale; onDeleted: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function confirm() {
    if (busy) return;
    setBusy(true);
    const res = await adminApi.sales.remove(sale.id);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error.message);
    setOpen(false);
    onDeleted(sale.id);
    toast.success(COPY["adminUi.saleDeleted"]);
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("adminUi.deleteSaleLabel", { date: formatDate(sale.saleDate) })}
          />
        }
      >
        <Trash2Icon aria-hidden="true" />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{COPY["admin.deleteSale.title"]}</AlertDialogTitle>
          <AlertDialogDescription>{COPY["admin.deleteSale.body"]}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{COPY["admin.deleteSale.no"]}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm} aria-disabled={busy || undefined}>
            {COPY["admin.deleteSale.yes"]}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SalesTable({
  initialSales,
  buildings,
  refreshOnMount = false,
}: {
  initialSales: AdminSale[];
  buildings: readonly BuildingOption[];
  /** Re-read the list when shown again (the data may have changed in another tab). */
  refreshOnMount?: boolean;
}) {
  const id = useId();
  const [sales, setSales] = useState(initialSales);
  const [building, setBuilding] = useState<number | null>(null);
  const [beds, setBeds] = useState<string>(ALL);
  const [pending, startTransition] = useTransition();

  function load(nextBuilding: number | null, nextBeds: string) {
    startTransition(async () => {
      const res = await adminApi.sales.list({
        buildingId: nextBuilding ?? undefined,
        bedrooms: nextBeds === ALL ? undefined : Number(nextBeds),
      });
      if (!res.ok) return void toast.error(res.error.message);
      setSales(res.data.sales);
    });
  }

  // The tab panel remounts each time it is shown: refresh, so sales registered or imported meanwhile show.
  useEffect(() => {
    if (!refreshOnMount) return;
    load(null, ALL);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  const bedItems = [{ value: ALL, label: COPY["adminUi.allBedrooms"] }, ...BEDROOM_VALUES.map((b) => ({ value: String(b), label: bedsOption(b) }))];

  const columns: AdminColumn<AdminSale>[] = [
    col.accessor("saleDate", {
      header: COPY["result.colDate"],
      meta: { label: COPY["result.colDate"] },
      sortFn: "basic",
      cell: (c) => <span className="num">{formatDate(c.getValue())}</span>,
    }),
    // The area tells apart buildings with the same DLD name (they repeat across areas).
    col.accessor("buildingName", {
      header: COPY["adminUi.colBuilding"],
      meta: { label: COPY["adminUi.colBuilding"], className: "md:min-w-40" },
      sortFn: "text",
      cell: (c) => (
        <span className="flex flex-col">
          <span>{c.row.original.buildingName}</span>
          <span className="text-muted-foreground">{c.row.original.buildingArea}</span>
        </span>
      ),
    }),
    col.accessor("bedrooms", {
      header: COPY["adminUi.colBedrooms"],
      meta: { label: COPY["adminUi.colBedrooms"] },
      sortFn: "basic",
      cell: (c) => bedsOption(c.getValue()),
    }),
    // Ready and off-plan sales are never pooled (REAL_DATA.md section 7), so the list says which is which.
    col.accessor("completion", {
      header: COPY["adminUi.colCompletion"],
      meta: { label: COPY["adminUi.colCompletion"] },
      sortFn: "text",
      cell: (c) => COPY[`adminUi.completion.${c.row.original.completion}`],
    }),
    col.accessor("sizeSqft", {
      header: COPY["result.colSize"],
      meta: { label: COPY["result.colSize"], numeric: true },
      sortFn: "basic",
      cell: (c) => formatInt(c.getValue()),
    }),
    col.accessor("priceAed", {
      header: COPY["result.colPrice"],
      meta: { label: COPY["result.colPrice"], numeric: true },
      sortFn: "basic",
      cell: (c) => formatInt(c.getValue()),
    }),
    col.accessor("psf", {
      header: COPY["result.colPsf"],
      meta: { label: COPY["result.colPsf"], numeric: true },
      sortFn: "basic",
      cell: (c) => formatInt(c.getValue()),
    }),
    // One column for where a sale came from: DLD open data shows its reference ("dld:…", which says
    // so); a sale the admin registered or imported says that, with its reference when it has one.
    // Long references are cut with the whole one in the tooltip, so the table fits at 1280px.
    col.accessor((s) => `${s.source === "open_data" ? "" : s.source} ${s.externalRef ?? ""}`, {
      id: "ref",
      header: COPY["adminUi.colReference"],
      meta: { label: COPY["adminUi.colReference"] },
      sortFn: "text",
      cell: (c) => {
        const s = c.row.original;
        return (
          <span className="flex min-w-0 flex-col items-start gap-1">
            {s.source === "open_data" ? null : <Badge variant="outline">{COPY[`adminUi.source.${s.source}`]}</Badge>}
            {s.externalRef ? (
              <code className="block max-w-36 truncate font-mono text-sm" title={s.externalRef}>
                {s.externalRef}
              </code>
            ) : null}
          </span>
        );
      },
    }),
    // Kept in view when the table scrolls sideways.
    col.display({
      id: "delete",
      header: () => <span className="sr-only">{COPY["adminUi.colActions"]}</span>,
      meta: { label: COPY["adminUi.colActions"], className: "md:sticky md:right-0 md:bg-background" },
      cell: (c) => (
        <DeleteSale sale={c.row.original} onDeleted={(sid) => setSales((prev) => prev.filter((s) => s.id !== sid))} />
      ),
    }),
  ];

  return (
    <div className="flex flex-col gap-4" aria-busy={pending || undefined}>
      <div className="flex flex-wrap items-end gap-3">
        {/* Thousands of DLD buildings: a searchable combobox (at most 100 matches, name and area). */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-b`}>{COPY["adminUi.colBuilding"]}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <BuildingCombobox
              id={`${id}-b`}
              buildings={buildings}
              value={building}
              placeholder={COPY["adminUi.allBuildings"]}
              onChange={(next) => {
                setBuilding(next);
                load(next, beds);
              }}
              className="w-72 max-w-full"
            />
            {building !== null ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setBuilding(null);
                  load(null, beds);
                }}
              >
                {COPY["adminUi.allBuildings"]}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-r`}>{COPY["adminUi.colBedrooms"]}</Label>
          <Select
            value={beds}
            items={bedItems}
            onValueChange={(v) => {
              const next = typeof v === "string" ? v : ALL;
              setBeds(next);
              load(building, next);
            }}
          >
            <SelectTrigger id={`${id}-r`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {bedItems.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {sales.length >= ADMIN_SALES_LIMIT ? (
        <p className="text-caption text-muted-foreground">{t("adminUi.salesLimit", { n: formatInt(ADMIN_SALES_LIMIT) })}</p>
      ) : null}
      <AdminDataTable
        columns={columns}
        data={sales}
        caption={COPY["adminUi.salesH1"]}
        initialSorting={[{ id: "saleDate", desc: true }]}
        getRowId={(s) => String(s.id)}
        pageSize={SALES_PAGE}
        empty={<p className="py-6 text-body text-muted-foreground">{COPY["adminUi.salesEmpty"]}</p>}
      />
    </div>
  );
}
