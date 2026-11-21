"use client";

/**
 * Leads (`/admin/leads`, DESIGN.md section 3.8): a sortable data table with masked phones.
 * - Reveal is a separate request ("Reveal mobile for {name}") and is logged on the server.
 * - "Mark sent to partner" records `sent_at`; a withdrawn lead shows "Withdrawn on {date}. Tell the
 *   partner." with [Partner told] until the partner was told. Withdrawn rows are muted, plus the words.
 * - Filters: status and date range. [Export CSV] downloads the full list
 *   (with full phones) for the same filters.
 */
import { FileDownIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { AdminDataTable, adminTableFeatures, type AdminColumn } from "@/components/admin/data-table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createColumnHelper } from "@tanstack/react-table";
import { adminApi, leadsExportUrl } from "@/lib/api/admin-client";
import { COPY, t } from "@/lib/copy";
import { bedsLabel, formatInt, formatTime, formatTimestampDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AdminLeadRow, LeadsQuery } from "@/lib/validation/admin";

const col = createColumnHelper<typeof adminTableFeatures, AdminLeadRow>();

export function receivedLabel(iso: string): string {
  return t("adminUi.receivedAt", { date: formatTimestampDate(iso), time: formatTime(iso) });
}

export function leadStatusText(l: Pick<AdminLeadRow, "status" | "sentAt" | "withdrawnAt" | "withdrawalNotifiedAt">): string {
  if (l.status === "withdrawn" && l.withdrawnAt) {
    const date = formatTimestampDate(l.withdrawnAt);
    return l.withdrawalNotifiedAt ? t("admin.leadStatus.notified", { date }) : t("admin.leadStatus.withdrawn", { date });
  }
  if (l.status === "sent" && l.sentAt) return t("admin.leadStatus.sent", { date: formatTimestampDate(l.sentAt) });
  return COPY["admin.leadStatus.new"];
}

function MobileCell({ lead }: { lead: AdminLeadRow }) {
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!lead.phoneMasked) return <span className="text-muted-foreground">{COPY["adminUi.none"]}</span>;
  const canReveal = lead.status !== "withdrawn";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="num" aria-live="polite">
        {full ?? lead.phoneMasked}
      </span>
      {canReveal && !full ? (
        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          aria-label={t("admin.reveal", { name: lead.name ?? COPY["adminUi.nameRemoved"] })}
          onClick={async () => {
            setBusy(true);
            const res = await adminApi.leads.reveal(lead.id);
            setBusy(false);
            if (!res.ok) return void toast.error(res.error.message);
            setFull(res.data.phoneE164 ?? lead.phoneMasked);
          }}
        >
          {COPY["adminUi.revealCta"]}
        </Button>
      ) : null}
    </span>
  );
}

function StatusCell({ lead, onChange }: { lead: AdminLeadRow; onChange: (l: AdminLeadRow) => void }) {
  const [busy, setBusy] = useState(false);
  const needsTelling = lead.status === "withdrawn" && !lead.withdrawalNotifiedAt;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 whitespace-normal">
      <span>{leadStatusText(lead)}</span>
      {needsTelling ? (
        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await adminApi.leads.update(lead.id, { withdrawalNotified: true });
            setBusy(false);
            if (!res.ok) return void toast.error(res.error.message);
            onChange(res.data.lead);
            toast.success(COPY["adminUi.markedTold"]);
          }}
        >
          {COPY["admin.partnerTold"]}
        </Button>
      ) : null}
    </span>
  );
}

function ActionsCell({ lead, onChange }: { lead: AdminLeadRow; onChange: (l: AdminLeadRow) => void }) {
  const [busy, setBusy] = useState(false);
  if (lead.status !== "new") return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await adminApi.leads.update(lead.id, { status: "sent" });
        setBusy(false);
        if (!res.ok) return void toast.error(res.error.message);
        onChange(res.data.lead);
        toast.success(COPY["adminUi.markedSent"]);
      }}
    >
      {COPY["admin.markSent"]}
    </Button>
  );
}

const STATUS_OPTIONS = [
  { value: "all", label: COPY["adminUi.statusAll"] },
  { value: "new", label: COPY["admin.leadStatus.new"] },
  { value: "sent", label: COPY["adminUi.statusSent"] },
  { value: "withdrawn", label: COPY["adminUi.statusWithdrawn"] },
];

function Filters({ query }: { query: LeadsQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string>(query.status ?? "all");
  const [from, setFrom] = useState(query.from ?? "");
  const [to, setTo] = useState(query.to ?? "");

  function apply(e?: FormEvent, override?: { status: string; from: string; to: string }) {
    e?.preventDefault();
    const v = override ?? { status, from, to };
    const qs = new URLSearchParams();
    if (v.status !== "all") qs.set("status", v.status);
    if (v.from) qs.set("from", v.from);
    if (v.to) qs.set("to", v.to);
    const s = qs.toString();
    startTransition(() => router.push(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  }

  return (
    <form onSubmit={apply} className="flex flex-wrap items-end gap-3" aria-busy={pending || undefined}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-status`}>{COPY["adminUi.filterStatus"]}</Label>
        <Select value={status} onValueChange={(v) => setStatus(typeof v === "string" ? v : "all")} items={STATUS_OPTIONS}>
          <SelectTrigger id={`${id}-status`} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-from`}>{COPY["adminUi.filterFrom"]}</Label>
        <Input id={`${id}-from`} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-44" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-to`}>{COPY["adminUi.filterTo"]}</Label>
        <Input id={`${id}-to`} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-44" />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {COPY["adminUi.filterApply"]}
      </Button>
      {query.status || query.from || query.to ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setStatus("all");
            setFrom("");
            setTo("");
            apply(undefined, { status: "all", from: "", to: "" });
          }}
        >
          {COPY["adminUi.filterClear"]}
        </Button>
      ) : null}
    </form>
  );
}

export function LeadsView({ leads: initial, query }: { leads: AdminLeadRow[]; query: LeadsQuery }) {
  const [rows, setRows] = useState(initial);
  const update = (l: AdminLeadRow) => setRows((prev) => prev.map((r) => (r.id === l.id ? l : r)));

  const columns: AdminColumn<AdminLeadRow>[] = [
    col.accessor("createdAt", {
      header: COPY["adminUi.colReceived"],
      meta: { label: COPY["adminUi.colReceived"] },
      sortFn: "basic",
      cell: (c) => <span className="num">{receivedLabel(c.getValue())}</span>,
    }),
    col.accessor((l) => l.name ?? "", {
      id: "name",
      header: COPY["adminUi.colName"],
      meta: { label: COPY["adminUi.colName"] },
      sortFn: "text",
      cell: (c) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {c.row.original.name ?? <span className="text-muted-foreground">{COPY["adminUi.nameRemoved"]}</span>}
        </span>
      ),
    }),
    col.display({
      id: "mobile",
      header: COPY["adminUi.colMobile"],
      meta: { label: COPY["adminUi.colMobile"] },
      cell: (c) => <MobileCell lead={c.row.original} />,
    }),
    col.accessor("buildingName", {
      header: COPY["adminUi.colListing"],
      meta: { label: COPY["adminUi.colListing"], className: "md:whitespace-normal" },
      sortFn: "text",
      cell: (c) =>
        t("adminUi.listing", {
          building: c.row.original.buildingName,
          bedType: bedsLabel(c.row.original.bedrooms),
          price: formatInt(c.row.original.priceAed),
        }),
    }),
    col.accessor("consentVersion", {
      header: COPY["adminUi.colConsent"],
      meta: { label: COPY["adminUi.colConsent"] },
      sortFn: "text",
      cell: (c) => <code className="font-mono text-sm">{c.getValue()}</code>,
    }),
    col.accessor("status", {
      header: COPY["adminUi.colStatus"],
      meta: { label: COPY["adminUi.colStatus"] },
      sortFn: "text",
      cell: (c) => <StatusCell lead={c.row.original} onChange={update} />,
    }),
    col.display({
      id: "actions",
      header: COPY["adminUi.colActions"],
      meta: { label: COPY["adminUi.colActions"] },
      cell: (c) => <ActionsCell lead={c.row.original} onChange={update} />,
    }),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-display-sm font-[720] wdth-heading">{COPY["adminUi.leadsH1"]}</h1>
        <a href={leadsExportUrl(query)} download className={cn(buttonVariants({ variant: "outline" }))}>
          <FileDownIcon aria-hidden="true" />
          {COPY["admin.export"]}
        </a>
      </div>
      <Filters query={query} />
      <AdminDataTable
        columns={columns}
        data={rows}
        caption={COPY["adminUi.leadsH1"]}
        initialSorting={[{ id: "createdAt", desc: true }]}
        getRowId={(l) => String(l.id)}
        rowClassName={(l) => (l.status === "withdrawn" ? "text-muted-foreground" : undefined)}
        empty={<p className="py-6 text-body text-muted-foreground">{COPY["adminUi.leadsEmpty"]}</p>}
      />
    </div>
  );
}
