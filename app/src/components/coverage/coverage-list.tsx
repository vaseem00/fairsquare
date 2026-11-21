"use client";

/**
 * Covered buildings at real scale (DESIGN.md section 3.7, REAL_DATA.md section 11): thousands of
 * buildings, searched and paged on the server (GET /api/buildings?q=&page=, 50 per page, most sales
 * in the window first).
 * - The first page comes from the server render (`initial`, from `?q=&page=`). Typing searches by
 *   name or area after a 150ms pause once there are 2 or more letters (fewer shows the whole list)
 *   and announces "{n} buildings match". "Showing x to y of z" sits above the list; Previous and
 *   Next are real links (`?q=&page=`) below it that load the page in place, then focus that line and
 *   scroll it to the top, so the new page starts at its first building. The URL follows, so a reload
 *   or a shared link shows the same page.
 * - Each building shows its area (with the DLD area name when it differs), its ready and off-plan
 *   sales in the window, its latest sale and one line per bedroom count with the two bases apart
 *   ("2-bed: 0 ready, 7 off-plan") and the status as plain text naming the basis that can be
 *   compared: ink 500 when there are enough sales, pencil when too few. No pills, no icons, never
 *   verdict colours (docs/REDESIGN.md section 8.8). Phones: rows between hairlines. From 768px: a table.
 * - No match: `coverage.noMatch` with a button that requests the typed name straight away. No data
 *   loaded yet: the "being loaded" line (REAL_DATA.md section 7).
 */
import { SearchIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useAnnounce } from "@/components/a11y/live-region";
import { Button, buttonVariants } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { areaLabel, COPY, t, tPlural } from "@/lib/copy";
import { bedsLabel, formatDate, formatInt } from "@/lib/format";
import { scrollIntoViewSafe } from "@/lib/motion";
import type { CoverageBuilding, CoverageResponse, CoverageType } from "@/lib/types";
import { cn } from "@/lib/utils";

export const SEARCH_DEBOUNCE_MS = 150;
/** Shorter searches show the whole list (the server ignores them too). */
export const SEARCH_MIN = 2;

/** The search the server applies: trimmed, and empty under 2 characters. */
export function effectiveQuery(q: string): string {
  const s = q.trim();
  return s.length >= SEARCH_MIN ? s : "";
}

/** `/coverage?q=&page=` for a search and page (page 1 and an empty search are left out). */
export function coverageHref(q: string, page: number): string {
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/coverage?${s}` : "/coverage";
}

export function pageCount(res: Pick<CoverageResponse, "total" | "pageSize">): number {
  return Math.max(1, Math.ceil(res.total / Math.max(1, res.pageSize)));
}

function latestLine(b: CoverageBuilding): string {
  const area = areaLabel(b.area, b.areaDld);
  return b.latestSaleDate ? t("coverage.latest", { area, date: formatDate(b.latestSaleDate) }) : t("coverage.latestNone", { area });
}

function countsLine(b: CoverageBuilding): string {
  return t("coverage.counts", { ready: formatInt(b.readySales), offPlan: formatInt(b.offPlanSales) });
}

/**
 * "2-bed: 0 ready, 7 off-plan" (the line starts with a capital). Ready and off-plan sales are never
 * pooled (REAL_DATA.md section 7): a listing is compared with one basis only.
 */
export function typeLine(type: Pick<CoverageType, "bedrooms" | "readySales" | "offPlanSales">): string {
  const label = bedsLabel(type.bedrooms);
  const bedType = label.charAt(0).toUpperCase() + label.slice(1);
  return t("coverage.typeLine", { bedType, ready: formatInt(type.readySales), offPlan: formatInt(type.offPlanSales) });
}

/** Which listings of this type get a verdict: ready ones, off-plan ones, both or neither. */
export function statusText(type: Pick<CoverageType, "readyComparable" | "offPlanComparable">): string {
  if (type.readyComparable && type.offPlanComparable) return COPY["coverage.enoughBoth"];
  if (type.readyComparable) return COPY["coverage.enoughReady"];
  if (type.offPlanComparable) return COPY["coverage.enoughOffPlan"];
  return COPY["coverage.thin"];
}

/** The status as plain text: ink 500 when this type can be compared, pencil when it has too few sales. */
function StatusText({ type }: { type: CoverageType }) {
  const enough = type.readyComparable || type.offPlanComparable;
  return (
    <span data-slot="coverage-status" data-enough={enough || undefined} className={enough ? "font-medium text-foreground" : "text-muted-foreground"}>
      {statusText(type)}
    </span>
  );
}

function TypeLines({ types, className }: { types: readonly CoverageType[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-1.5 text-caption", className)}>
      {types.map((type) => (
        <li key={type.bedrooms} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 md:justify-start">
          <span className="text-foreground num">{typeLine(type)}</span>
          <StatusText type={type} />
        </li>
      ))}
    </ul>
  );
}

type Load = { status: "idle" } | { status: "loading" } | { status: "error" };

export function CoverageList({
  initial,
  onRequest,
  requestBusy,
}: {
  /** The page the server rendered (from `?q=&page=`). */
  initial: CoverageResponse;
  /** Files a building request for the searched name. */
  onRequest(q: string): void;
  requestBusy?: boolean;
}) {
  const announce = useAnnounce();
  const ids = { search: useId(), help: useId(), status: useId() };
  const [q, setQ] = useState(initial.q ?? "");
  const [res, setRes] = useState<CoverageResponse>(initial);
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const seq = useRef(0);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const applied = res.q ?? "";

  async function fetchPage(nextQ: string, page: number, why: "search" | "page") {
    const mine = ++seq.current;
    setLoad({ status: "loading" });
    const r = await api.buildings({ q: nextQ || null, page }).catch(() => null);
    if (mine !== seq.current) return; // a newer search or page won
    if (!r || !r.ok) {
      setLoad({ status: "error" });
      return;
    }
    setRes(r.data);
    setLoad({ status: "idle" });
    try {
      window.history.replaceState(null, "", coverageHref(r.data.q ?? "", r.data.page));
    } catch {
      // URL sync is a convenience only
    }
    if (why === "search") {
      announce(tPlural("coverage.matches", r.data.total, { n: formatInt(r.data.total) }));
    } else {
      // A new page starts at its top: the "Showing x to y" line above the list takes focus and
      // scrolls to the top of the screen (instantly with reduced motion), not the end of the list.
      announce(showingText(r.data) ?? "");
      statusRef.current?.focus({ preventScroll: true });
      scrollIntoViewSafe(statusRef.current, { block: "start" });
    }
  }

  // Search as the person types (150ms pause); under 2 letters is the whole list.
  const wanted = effectiveQuery(q);
  useEffect(() => {
    if (wanted === applied) return;
    const id = setTimeout(() => void fetchPage(wanted, 1, "search"), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // fetchPage is recreated each render; the search text is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, applied]);

  const pages = pageCount(res);
  const go = (page: number) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab: let the link work
    e.preventDefault();
    void fetchPage(applied, page, "page");
  };

  const busy = load.status === "loading";
  const shown = res.buildings;

  return (
    <div className="flex flex-col gap-6" data-slot="coverage-list">
      <div className="flex max-w-md flex-col gap-2">
        <Label htmlFor={ids.search} className="type-label text-foreground">
          {COPY["coverage.search"]}
        </Label>
        <InputGroup>
          <InputGroupAddon className="pl-3">
            <SearchIcon aria-hidden="true" strokeWidth={1.75} className="size-5 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            id={ids.search}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={120}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-describedby={ids.help}
          />
        </InputGroup>
        <p id={ids.help} className="text-caption text-muted-foreground">
          {COPY["coverage.searchHelp"]}
        </p>
      </div>

      {load.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-2" data-slot="coverage-error">
          <p className="text-body text-destructive">{COPY["coverage.loadFailed"]}</p>
          <Button type="button" variant="outline" onClick={() => void fetchPage(effectiveQuery(q), res.page, "search")}>
            {COPY["alert.tryAgain"]}
          </Button>
        </div>
      ) : null}

      {res.window === null ? (
        <p className="type-lead text-foreground" data-slot="coverage-loading">
          {COPY["data.loading"]}
        </p>
      ) : res.total === 0 ? (
        applied ? (
          <div className="flex flex-col items-start gap-2 border-t border-border pt-6" data-slot="coverage-empty">
            <p className="type-title text-foreground">{t("coverage.noMatch", { q: applied })}</p>
            <p className="text-body text-muted-foreground">{COPY["coverage.noMatchBody"]}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => onRequest(applied)}
              aria-disabled={requestBusy || undefined}
              className="mt-2 h-auto min-h-11 text-wrap md:h-auto"
            >
              {t("coverage.requestQ", { q: applied })}
            </Button>
          </div>
        ) : null
      ) : (
        <div aria-busy={busy || undefined} className={cn("flex flex-col gap-4 transition-opacity duration-(--dur-fast)", busy && "opacity-60")}>
          {/* Where the list is, above it: after Next, focus lands here at the top of the new page. */}
          <p
            id={ids.status}
            ref={statusRef}
            tabIndex={-1}
            className="scroll-mt-20 text-caption text-muted-foreground outline-none num"
            data-slot="coverage-showing"
          >
            {showingText(res)}
          </p>
          <ul className="flex flex-col border-b border-border md:hidden" data-slot="coverage-items">
            {shown.map((b) => (
              <li key={b.id} className="border-t border-border">
                <div className="flex flex-col gap-1.5 py-5">
                  <h2 className="type-title text-foreground">{b.name}</h2>
                  <p className="text-caption text-muted-foreground num">{latestLine(b)}</p>
                  <p className="text-caption text-muted-foreground num">{countsLine(b)}</p>
                  <TypeLines types={b.types} className="mt-1.5" />
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden md:block" data-slot="coverage-table">
            <Table className="text-[15px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="type-label text-muted-foreground">{COPY["field.building"]}</TableHead>
                  <TableHead className="type-label text-muted-foreground">{COPY["field.area"]}</TableHead>
                  <TableHead className="type-label text-right text-muted-foreground">{COPY["coverage.colReady"]}</TableHead>
                  <TableHead className="type-label text-right text-muted-foreground">{COPY["coverage.colOffPlan"]}</TableHead>
                  <TableHead className="type-label text-muted-foreground">{COPY["coverage.colLatest"]}</TableHead>
                  <TableHead className="type-label text-muted-foreground">{COPY["coverage.colTypes"]}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((b) => (
                  <TableRow key={b.id} className="hover:bg-transparent [&>td]:align-top">
                    <TableCell className="py-4 whitespace-normal">
                      <span className="type-title block -mt-0.5 text-foreground">{b.name}</span>
                    </TableCell>
                    <TableCell className="max-w-56 py-4 whitespace-normal text-muted-foreground">{areaLabel(b.area, b.areaDld)}</TableCell>
                    <TableCell className="py-4 text-right num">{formatInt(b.readySales)}</TableCell>
                    <TableCell className="py-4 text-right num">{formatInt(b.offPlanSales)}</TableCell>
                    <TableCell className="py-4 num">{b.latestSaleDate ? formatDate(b.latestSaleDate) : null}</TableCell>
                    <TableCell className="py-4">
                      <TypeLines types={b.types} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {pages > 1 ? (
            <nav aria-label={COPY["coverage.pages"]} className="flex flex-wrap items-center gap-x-6" data-slot="coverage-pages">
              <PageLink href={coverageHref(applied, res.page - 1)} disabled={res.page <= 1} onClick={go(res.page - 1)}>
                {COPY["coverage.prev"]}
              </PageLink>
              <PageLink href={coverageHref(applied, res.page + 1)} disabled={res.page >= pages} onClick={go(res.page + 1)}>
                {COPY["coverage.next"]}
              </PageLink>
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** "Showing 51 to 100 of 1,234 buildings" ("of 1 building"), or null with nothing listed. */
export function showingText(res: Pick<CoverageResponse, "total" | "page" | "pageSize" | "buildings">): string | null {
  if (res.buildings.length === 0) return null;
  const first = (res.page - 1) * res.pageSize + 1;
  return tPlural("coverage.showing", res.total, {
    first: formatInt(first),
    last: formatInt(first + res.buildings.length - 1),
    total: formatInt(res.total),
  });
}

function PageLink({
  href,
  disabled,
  onClick,
  children,
}: {
  href: string;
  disabled: boolean;
  onClick: (e: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  const cls = buttonVariants({ variant: "link" });
  if (disabled) {
    // Not a link: there is no page there. Kept in the layout so Next does not jump.
    return (
      <span aria-disabled="true" className={cn(cls, "pointer-events-none no-underline text-muted-foreground")}>
        {children}
      </span>
    );
  }
  return (
    <a href={href} onClick={onClick} className={cls}>
      {children}
    </a>
  );
}
