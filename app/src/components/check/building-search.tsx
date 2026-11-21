"use client";

/**
 * "Search covered buildings" (DESIGN.md sections 3.3 and 4.1): a CommandDialog listing covered
 * buildings (name and area) from GET /api/buildings. Choosing one hands it to the parent, which adds
 * it as a building option and selects it. With thousands of buildings (REAL_DATA.md section 11) the
 * search runs on the server: under 2 letters the dialog lists the first page (most sales first);
 * from 2 letters it asks the server (150ms pause) and lists its first 50 matches. The first page is
 * fetched once per page and shared with the not-covered result's "Fairsquare covers {n} buildings"
 * (`total`). The number of matches is announced as they arrive; a failed request says so with
 * "Try again" (never "No covered building matches").
 */
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAnnounce } from "@/components/a11y/live-region";
import { Button } from "@/components/ui/button";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/client";
import { COPY, t, tPlural } from "@/lib/copy";
import type { CoverageBuilding, CoverageResponse } from "@/lib/types";

/** Shorter searches list the first page (the server ignores them too). */
const SEARCH_MIN = 2;
const SEARCH_DEBOUNCE_MS = 150;

/**
 * The covered buildings for the dialog's search text: the first page under 2 letters, else the
 * server's matches (undefined while loading, null when the request failed). A new `attempt` asks
 * again after a failure.
 */
export function useBuildingSearch(query: string, enabled: boolean, attempt = 0): CoverageBuilding[] | null | undefined {
  const firstPage = useCoveredBuildings(enabled, attempt);
  const q = query.trim();
  const searching = enabled && q.length >= SEARCH_MIN;
  const [found, setFound] = useState<{ q: string; attempt: number; list: CoverageBuilding[] | null } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!searching) return;
    const mine = ++seq.current;
    const id = setTimeout(() => {
      void api.buildings({ q }).then(
        (res) => {
          if (mine === seq.current) setFound({ q, attempt, list: res.ok ? res.data.buildings : null });
        },
        () => {
          if (mine === seq.current) setFound({ q, attempt, list: null });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [q, searching, attempt]);
  if (!searching) return firstPage;
  return found && found.q === q && found.attempt === attempt ? found.list : undefined;
}

let coverage: Promise<CoverageResponse | null> | null = null;

/** The first coverage page (null when the request failed; the next call tries again). */
export function loadCoverage(): Promise<CoverageResponse | null> {
  coverage ??= api.buildings().then(
    (res) => (res.ok ? res.data : null),
    () => null,
  );
  const mine = coverage;
  return mine.then((res) => {
    if (!res && coverage === mine) coverage = null;
    return res;
  });
}

/** The covered buildings of the first page (null when the request failed). */
export function loadCoveredBuildings(): Promise<CoverageBuilding[] | null> {
  return loadCoverage().then((res) => res?.buildings ?? null);
}

/** Tests: forget the cached list. */
export function __resetCoveredBuildingsForTests(): void {
  coverage = null;
}

/**
 * The first coverage page once loaded (undefined while loading, null when it failed). A new
 * `attempt` loads it again after a failure (a failed load is never cached).
 */
export function useCoverage(enabled = true, attempt = 0): CoverageResponse | null | undefined {
  const [res, setRes] = useState<{ attempt: number; value: CoverageResponse | null } | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadCoverage().then((r) => {
      if (live) setRes({ attempt, value: r });
    });
    return () => {
      live = false;
    };
  }, [enabled, attempt]);
  // A failure from an earlier attempt shows as loading while the new attempt runs.
  if (res === undefined || (res.value === null && res.attempt !== attempt)) return undefined;
  return res.value;
}

/** The covered buildings once loaded (undefined while loading, null when it failed). */
export function useCoveredBuildings(enabled = true, attempt = 0): CoverageBuilding[] | null | undefined {
  const res = useCoverage(enabled, attempt);
  return res === undefined ? undefined : (res?.buildings ?? null);
}

export interface BuildingSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (b: { buildingId: number; name: string; area: string }) => void;
}

export function BuildingSearch({ open, onOpenChange, onPick }: BuildingSearchProps) {
  const announce = useAnnounce();
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const buildings = useBuildingSearch(query, open, attempt);
  const searching = query.trim().length >= SEARCH_MIN;

  // The server's matches arrive while the person types: say how many (screen readers get no other cue).
  const count = searching && Array.isArray(buildings) ? buildings.length : null;
  useEffect(() => {
    if (count !== null) announce(tPlural("pick.announce", count));
  }, [count, query, announce]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setQuery("");
        onOpenChange(o);
      }}
      title={COPY["pick.search"]}
      description={COPY["pick.legend"]}
      showCloseButton
      className="top-[12%] w-[min(480px,calc(100vw-2rem))] max-w-none pt-12 sm:max-w-none"
    >
      {/* cmdk names its input with its own <label> (aria-labelledby): give that label the text. */}
      {/* The server searches (thousands of buildings): cmdk only lists what came back. */}
      <Command className="rounded-none! bg-popover p-2" label={COPY["pick.searchPlaceholder"]} shouldFilter={false}>
        <div className="flex h-11 items-center gap-2 rounded-lg border border-input bg-card px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring">
          <SearchIcon aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-muted-foreground" />
          <CommandPrimitive.Input
            value={query}
            onValueChange={setQuery}
            placeholder={COPY["pick.searchPlaceholder"]}
            className="h-full w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </div>
        <CommandList className="mt-2 max-h-[min(60dvh,24rem)]">
          {buildings === undefined ? (
            <CommandPrimitive.Loading>
              <div className="flex items-center justify-center py-6">
                <Spinner className="size-5" />
              </div>
            </CommandPrimitive.Loading>
          ) : buildings === null ? (
            // A failed request is not "no match": say so and offer another try.
            <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center" data-slot="search-failed">
              <p className="text-body text-destructive">{COPY["coverage.loadFailed"]}</p>
              <Button type="button" variant="outline" onClick={() => setAttempt((a) => a + 1)}>
                {COPY["alert.tryAgain"]}
              </Button>
            </div>
          ) : (
            <>
              <CommandEmpty className="py-6 text-center text-body text-muted-foreground">{COPY["pick.noMatch"]}</CommandEmpty>
              <CommandGroup>
                {buildings.map((b) => (
                  <CommandItem
                    key={b.id}
                    value={`${b.name} ${b.area} #${b.id}`}
                    onSelect={() => {
                      onPick({ buildingId: b.id, name: b.name, area: b.area });
                      setQuery("");
                      onOpenChange(false);
                      // The dialog closes and a new option is selected out of view: say what happened.
                      announce(t("pick.searchChosen", { building: b.name }));
                    }}
                    className="min-h-11 py-2 text-base md:text-sm"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium text-foreground">{b.name}</span>
                      <span className="text-caption text-muted-foreground">{b.area}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
