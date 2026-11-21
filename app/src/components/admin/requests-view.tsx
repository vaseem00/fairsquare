"use client";

/**
 * Building requests (`/admin/requests`, DESIGN.md section 3.8): Building as typed, Area, Requests,
 * People, First asked, Last asked, and [Mark as covered], a Popover with a building combobox that
 * links every request with that text to a building. Requesters then see "Now covered" under Saved.
 * Each change commits on one click and offers Undo in its toast; a linked row shows the building and
 * its area, "Change building" and "Unlink".
 */
import { createColumnHelper } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";
import { BuildingCombobox, type BuildingOption } from "@/components/admin/building-combobox";
import { AdminDataTable, adminTableFeatures, type AdminColumn } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminApi } from "@/lib/api/admin-client";
import { COPY, t } from "@/lib/copy";
import { formatInt, formatTimestampDate } from "@/lib/format";
import type { AdminRequestRow } from "@/lib/validation/admin";

const col = createColumnHelper<typeof adminTableFeatures, AdminRequestRow>();

function CoverCell({
  row,
  buildings,
  onChange,
}: {
  row: AdminRequestRow;
  buildings: readonly BuildingOption[];
  onChange: (r: AdminRequestRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const covered = row.resolvedBuilding;
  const area = covered ? buildings.find((b) => b.id === covered.id)?.area : undefined;

  /** Links (or with null unlinks) every request with this text; offers Undo back to `previous`. */
  async function setTo(id: number | null, previous: number | null, undoable: boolean) {
    if (busy) return;
    setBusy(true);
    const res = await adminApi.requests.resolve(row.textNorm, id);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error.message);
    const b = res.data.resolvedBuilding;
    onChange({ ...row, resolvedBuilding: b });
    const message = b ? t("adminUi.linkedTo", { building: b.name }) : COPY["adminUi.unlinked"];
    // One click commits, so every change can be taken back from the toast.
    toast.success(message, undoable ? { action: { label: COPY["adminUi.undo"], onClick: () => void setTo(previous, id, false) } } : undefined);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 whitespace-normal">
      {covered ? (
        <Badge variant="secondary" data-slot="covered-badge">
          {t("adminUi.coveredBy", { building: area ? `${covered.name}, ${area}` : covered.name })}
        </Badge>
      ) : null}
      <BuildingCombobox
        buildings={buildings}
        value={covered?.id ?? null}
        onChange={(id) => {
          if (id !== covered?.id) void setTo(id, covered?.id ?? null, true);
        }}
        className="h-9 w-auto md:h-9"
        trigger={<span>{covered ? COPY["adminUi.changeBuilding"] : COPY["admin.markCovered"]}</span>}
      />
      {covered ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => void setTo(null, covered.id, true)}>
          {COPY["adminUi.unlink"]}
        </Button>
      ) : null}
    </span>
  );
}

export function RequestsView({
  requests: initial,
  buildings,
}: {
  requests: AdminRequestRow[];
  buildings: BuildingOption[];
}) {
  const [rows, setRows] = useState(initial);
  const update = (r: AdminRequestRow) => setRows((prev) => prev.map((x) => (x.textNorm === r.textNorm ? r : x)));

  const columns: AdminColumn<AdminRequestRow>[] = [
    col.accessor("text", {
      header: COPY["adminUi.colTyped"],
      meta: { label: COPY["adminUi.colTyped"], className: "md:whitespace-normal font-medium" },
      sortFn: "text",
    }),
    col.accessor((r) => r.area ?? "", {
      id: "area",
      header: COPY["adminUi.colArea"],
      meta: { label: COPY["adminUi.colArea"] },
      sortFn: "text",
    }),
    col.accessor("requests", {
      header: COPY["adminUi.colRequests"],
      meta: { label: COPY["adminUi.colRequests"], numeric: true },
      sortFn: "basic",
      cell: (c) => formatInt(c.getValue()),
    }),
    col.accessor("people", {
      header: COPY["adminUi.colPeople"],
      meta: { label: COPY["adminUi.colPeople"], numeric: true },
      sortFn: "basic",
      cell: (c) => formatInt(c.getValue()),
    }),
    col.accessor("firstAskedAt", {
      header: COPY["adminUi.colFirstAsked"],
      meta: { label: COPY["adminUi.colFirstAsked"] },
      sortFn: "basic",
      cell: (c) => formatTimestampDate(c.getValue()),
    }),
    col.accessor("lastAskedAt", {
      header: COPY["adminUi.colLastAsked"],
      meta: { label: COPY["adminUi.colLastAsked"] },
      sortFn: "basic",
      cell: (c) => formatTimestampDate(c.getValue()),
    }),
    col.display({
      id: "cover",
      header: COPY["adminUi.colActions"],
      meta: { label: COPY["adminUi.colActions"] },
      cell: (c) => <CoverCell row={c.row.original} buildings={buildings} onChange={update} />,
    }),
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-display-sm font-[720] wdth-heading">{COPY["adminUi.requestsH1"]}</h1>
      <AdminDataTable
        columns={columns}
        data={rows}
        caption={COPY["adminUi.requestsH1"]}
        initialSorting={[{ id: "requests", desc: true }]}
        getRowId={(r) => r.textNorm}
        empty={<p className="py-6 text-body text-muted-foreground">{COPY["adminUi.requestsEmpty"]}</p>}
      />
    </div>
  );
}
