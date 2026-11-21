"use client";

/**
 * Buildings tab (DESIGN.md section 3.8): a table of buildings (name, area with the DLD area name,
 * aliases, sales) with [Add building] (name, area, optional project names, other names) and, per row,
 * [Add alias]. Both take effect for matching at once (the server invalidates the alias cache). With
 * thousands of DLD buildings (REAL_DATA.md sections 11 and 12) the list is searched and paged on the
 * server: the filter searches name, area, DLD area and other names, and the table loads 50 rows at a
 * time ("Show 50 more").
 */
import { createColumnHelper } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AdminDataTable, adminTableFeatures, type AdminColumn } from "@/components/admin/data-table";
import { Button } from "@/components/ui/button";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { adminApi } from "@/lib/api/admin-client";
import { areaLabel, COPY, t, tList } from "@/lib/copy";
import { formatInt } from "@/lib/format";
import {
  ADMIN_BUILDINGS_PAGE,
  ADMIN_BUILDINGS_QUERY_MIN,
  AliasCreateSchema,
  BuildingCreateSchema,
  type AdminBuilding,
  type AdminBuildingsPage,
} from "@/lib/validation/admin";
import { zodFieldErrors } from "@/lib/validation/api";

const col = createColumnHelper<typeof adminTableFeatures, AdminBuilding>();

function AddAlias({ building, onAdded }: { building: AdminBuilding; onAdded: (b: AdminBuilding) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = AliasCreateSchema.safeParse({ alias });
    if (!parsed.success) {
      setError(zodFieldErrors(parsed.error).alias ?? COPY["adminUi.err.alias"]);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi.buildings.addAlias(building.id, parsed.data.alias);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.fields?.alias ?? res.error.message);
      inputRef.current?.focus();
      return;
    }
    if (res.data.created) {
      onAdded({ ...building, aliases: [...building.aliases, res.data.alias] });
      toast.success(COPY["adminUi.aliasAdded"]);
    } else toast.info(COPY["adminUi.aliasExists"]);
    setAlias("");
    setError(null);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="outline" size="sm" aria-label={t("adminUi.addAliasFor", { building: t("adminUi.buildingWithArea", { name: building.name, area: building.area }) })} />}
      >
        <PlusIcon aria-hidden="true" />
        {COPY["admin.addAlias"]}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" initialFocus={inputRef}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          <Label htmlFor={`${id}-alias`}>{t("adminUi.addAliasFor", { building: t("adminUi.buildingWithArea", { name: building.name, area: building.area }) })}</Label>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              id={`${id}-alias`}
              value={alias}
              autoComplete="off"
              onChange={(e) => {
                setAlias(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-alias-err` : undefined}
            />
            <Button type="submit" disabled={busy}>
              {busy ? COPY["adminUi.adding"] : COPY["adminUi.addAliasCta"]}
            </Button>
          </div>
          {error ? (
            <p id={`${id}-alias-err`} className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}

type BField = "name" | "area" | "project" | "masterProject" | "aliases";

function AddBuilding({ onAdded }: { onAdded: (b: AdminBuilding) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({ name: "", area: "", project: "", masterProject: "", aliases: "" });
  const [errors, setErrors] = useState<Partial<Record<BField, string>>>({});
  const refs = useRef<Partial<Record<BField, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  const body = () => ({
    name: v.name,
    area: v.area,
    project: v.project || null,
    masterProject: v.masterProject || null,
    aliases: v.aliases
      .split(/\r?\n/)
      .map((a) => a.trim())
      .filter(Boolean),
  });

  function showErrors(fields: Record<string, string>) {
    const out: Partial<Record<BField, string>> = {};
    for (const [k, msg] of Object.entries(fields)) {
      const key = k.split(".")[0] as BField;
      out[key] ??= msg;
    }
    setErrors(out);
    const first = (["name", "area", "project", "masterProject", "aliases"] as BField[]).find((f) => out[f]);
    if (first) refs.current[first]?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = BuildingCreateSchema.safeParse(body());
    if (!parsed.success) return showErrors(zodFieldErrors(parsed.error));
    setBusy(true);
    const res = await adminApi.buildings.create(body());
    setBusy(false);
    if (!res.ok) {
      if (res.error.fields) showErrors(res.error.fields);
      else toast.error(res.error.message);
      return;
    }
    onAdded(res.data.building);
    toast.success(t("adminUi.buildingAdded", { building: res.data.building.name }));
    setV({ name: "", area: "", project: "", masterProject: "", aliases: "" });
    setErrors({});
    setOpen(false);
  }

  const field = (f: Exclude<BField, "aliases">, label: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-${f}`}>{label}</Label>
      <Input
        id={`${id}-${f}`}
        ref={(el) => void (refs.current[f] = el)}
        value={v[f]}
        autoComplete="off"
        onChange={(e) => {
          setV((s) => ({ ...s, [f]: e.target.value }));
          setErrors((er) => ({ ...er, [f]: undefined }));
        }}
        aria-invalid={errors[f] ? true : undefined}
        aria-describedby={errors[f] ? `${id}-${f}-err` : undefined}
      />
      {errors[f] ? (
        <p id={`${id}-${f}-err`} className="text-sm text-destructive">
          {errors[f]}
        </p>
      ) : null}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" />}>
        <PlusIcon aria-hidden="true" />
        {COPY["admin.addBuilding"]}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{COPY["admin.addBuilding"]}</DialogTitle>
          <DialogDescription className="sr-only">{COPY["admin.addBuilding"]}</DialogDescription>
        </DialogHeader>
        <form id={`${id}-form`} onSubmit={submit} noValidate className="flex flex-col gap-4">
          {field("name", COPY["field.building"])}
          {field("area", COPY["field.area"])}
          {field("project", COPY["adminUi.project"])}
          {field("masterProject", COPY["adminUi.masterProject"])}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-aliases`}>{COPY["adminUi.aliasesField"]}</Label>
            <Textarea
              id={`${id}-aliases`}
              ref={(el) => void (refs.current.aliases = el)}
              rows={3}
              value={v.aliases}
              onChange={(e) => setV((s) => ({ ...s, aliases: e.target.value }))}
              aria-invalid={errors.aliases ? true : undefined}
              aria-describedby={errors.aliases ? `${id}-aliases-err` : undefined}
            />
            {errors.aliases ? (
              <p id={`${id}-aliases-err`} className="text-sm text-destructive">
                {errors.aliases}
              </p>
            ) : null}
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {COPY["adminUi.cancel"]}
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={busy}>
            {busy ? COPY["adminUi.adding"] : COPY["admin.addBuilding"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rows per page from the server (thousands of DLD buildings), ADMIN_BUILDINGS_PAGE. */
export const BUILDINGS_PAGE = ADMIN_BUILDINGS_PAGE;
/** Pause after typing before the server search runs. */
export const BUILDINGS_SEARCH_DEBOUNCE_MS = 150;

/** The search sent to the server: trimmed, or empty when shorter than 2 characters (the whole list). */
export function buildingsQuery(filter: string): string {
  const q = filter.trim();
  return q.length >= ADMIN_BUILDINGS_QUERY_MIN ? q : "";
}

interface Loaded {
  q: string;
  rows: AdminBuilding[];
  total: number;
  page: number;
}

/**
 * The Buildings tab: searched and paged on the server (GET /api/admin/buildings?q=&page=), by name.
 * The filter searches name, area, DLD area and other names after a short pause; "Show 50 more"
 * loads the next page below the rows already shown. A building added here goes to the top of the
 * list and, through `onAdded`, into the pickers. `reloadKey` changing (a buildings import) reloads.
 */
export function BuildingsPanel({
  initial,
  reloadKey = 0,
  onAdded,
}: {
  initial: AdminBuildingsPage;
  reloadKey?: number;
  onAdded?: (b: AdminBuilding) => void;
}) {
  const filterId = useId();
  const [filter, setFilter] = useState(initial.q ?? "");
  const [data, setData] = useState<Loaded>({ q: initial.q ?? "", rows: initial.buildings, total: initial.total, page: initial.page });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  // The search and reload key the shown rows were asked for (the server rendered the first page).
  const requested = useRef({ q: initial.q ?? "", reloadKey });

  const load = useCallback(async (q: string, page: number, append: boolean) => {
    const id = ++seq.current;
    setBusy(true);
    const res = await adminApi.buildings.list({ q: q || null, page });
    if (id !== seq.current) return; // a newer search started meanwhile
    setBusy(false);
    if (!res.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setData((d) => {
      if (!append) return { q, rows: res.data.buildings, total: res.data.total, page: res.data.page };
      const seen = new Set(d.rows.map((b) => b.id));
      return { q, rows: [...d.rows, ...res.data.buildings.filter((b) => !seen.has(b.id))], total: res.data.total, page: res.data.page };
    });
  }, []);

  // A new search (after a pause) or a reload request: back to page 1.
  const query = buildingsQuery(filter);
  useEffect(() => {
    if (requested.current.q === query && requested.current.reloadKey === reloadKey) return;
    const timer = setTimeout(() => {
      requested.current = { q: query, reloadKey };
      void load(query, 1, false);
    }, BUILDINGS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, reloadKey, load]);

  const replace = (b: AdminBuilding) => setData((d) => ({ ...d, rows: d.rows.map((x) => (x.id === b.id ? b : x)) }));
  const add = (b: AdminBuilding) => {
    setData((d) => ({ ...d, rows: [b, ...d.rows.filter((x) => x.id !== b.id)], total: d.total + 1 }));
    onAdded?.(b);
  };
  const more = Math.min(BUILDINGS_PAGE, Math.max(0, data.total - data.rows.length));

  const columns: AdminColumn<AdminBuilding>[] = [
    // Sorted by name on the server; sorting a loaded page alone would mislead, so no sort buttons.
    col.accessor("name", {
      header: COPY["adminUi.colName"],
      meta: { label: COPY["adminUi.colName"], className: "font-medium" },
      enableSorting: false,
    }),
    col.accessor("area", {
      header: COPY["adminUi.colArea"],
      meta: { label: COPY["adminUi.colArea"], className: "md:whitespace-normal md:max-w-[16rem]" },
      enableSorting: false,
      cell: (c) => areaLabel(c.row.original.area, c.row.original.areaDld),
    }),
    col.accessor((b) => b.aliases.map((a) => a.alias).join(", "), {
      id: "aliases",
      header: COPY["adminUi.colAliases"],
      meta: { label: COPY["adminUi.colAliases"], className: "md:whitespace-normal md:max-w-[22rem]" },
      enableSorting: false,
    }),
    col.accessor("salesCount", {
      header: COPY["adminUi.colSales"],
      meta: { label: COPY["adminUi.colSales"], numeric: true },
      enableSorting: false,
      cell: (c) => formatInt(c.getValue()),
    }),
    col.display({
      id: "alias",
      header: () => <span className="sr-only">{COPY["adminUi.colActions"]}</span>,
      meta: { label: COPY["adminUi.colActions"] },
      cell: (c) => <AddAlias building={c.row.original} onAdded={replace} />,
    }),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full max-w-sm flex-col gap-1.5">
          <Label htmlFor={filterId}>{COPY["adminUi.filterBuildings"]}</Label>
          <Input
            id={filterId}
            type="search"
            autoComplete="off"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-busy={busy || undefined}
            data-slot="buildings-filter"
          />
        </div>
        <AddBuilding onAdded={add} />
      </div>
      {failed ? (
        <p className="text-sm text-destructive" role="alert">
          {COPY["coverage.loadFailed"]}
        </p>
      ) : null}
      <AdminDataTable
        columns={columns}
        data={data.rows}
        caption={tList("admin.salesTabs")[2]}
        getRowId={(b) => String(b.id)}
        empty={<p className="text-sm text-muted-foreground">{COPY["adminUi.noBuildingMatch"]}</p>}
      />
      {data.rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3" data-slot="table-more">
          <p className="text-caption text-muted-foreground num" aria-live="polite">
            {t("adminUi.showingOf", { shown: formatInt(data.rows.length), total: formatInt(data.total) })}
          </p>
          {more > 0 ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load(data.q, data.page + 1, true)}>
              {t("adminUi.showMore", { n: formatInt(more) })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
