"use client";

/**
 * A building picker (DESIGN.md section 3.8): Popover + Command combobox, keyboard-first (type to
 * filter, arrows to move, Enter to pick). Used by "Mark as covered" and "Register a sale". It lists at
 * most the first 100 matches, so thousands of DLD buildings stay quick to search.
 */
import { ChevronsUpDownIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COPY, t } from "@/lib/copy";
import { cn } from "@/lib/utils";

export interface BuildingOption {
  id: number;
  name: string;
  area: string;
}

/** Options rendered at once: thousands of DLD buildings would make the list slow (REAL_DATA.md section 11). */
export const COMBOBOX_MAX = 100;

/** The buildings whose "name area" contains the search (case-insensitive), at most `max`. */
export function matchBuildings<T extends BuildingOption>(list: readonly T[], search: string, max = COMBOBOX_MAX): { shown: T[]; more: boolean } {
  const needle = search.trim().toLowerCase();
  const shown: T[] = [];
  for (const b of list) {
    if (needle && !`${b.name} ${b.area}`.toLowerCase().includes(needle)) continue;
    if (shown.length === max) return { shown, more: true };
    shown.push(b);
  }
  return { shown, more: false };
}

/** Just the Command list, for use inside an existing Popover. */
export function BuildingCommand({
  buildings,
  value,
  onPick,
}: {
  buildings: readonly BuildingOption[];
  value: number | null;
  onPick: (b: BuildingOption) => void;
}) {
  const [search, setSearch] = useState("");
  const { shown, more } = useMemo(() => matchBuildings(buildings, search), [buildings, search]);
  return (
    // Filtered here (and capped), not by cmdk: cmdk would render every building.
    <Command shouldFilter={false}>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={COPY["adminUi.searchBuildings"]}
        aria-label={COPY["adminUi.searchBuildings"]}
      />
      <CommandList>
        <CommandEmpty>{COPY["adminUi.noBuildingMatch"]}</CommandEmpty>
        <CommandGroup>
          {shown.map((b) => (
            <CommandItem
              key={b.id}
              value={`${b.name} ${b.area} #${b.id}`}
              data-checked={value === b.id ? "true" : undefined}
              onSelect={() => onPick(b)}
              className="min-h-10"
            >
              <span className="flex flex-col">
                <span>{b.name}</span>
                <span className="text-muted-foreground">{b.area}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        {more ? (
          <p className="px-3 py-2 text-sm text-muted-foreground" data-slot="combobox-more">
            {t("adminUi.matchesShown", { n: COMBOBOX_MAX })}
          </p>
        ) : null}
      </CommandList>
    </Command>
  );
}

export function BuildingCombobox({
  id,
  buildings,
  value,
  onChange,
  invalid,
  describedBy,
  placeholder = COPY["adminUi.chooseBuilding"],
  className,
  trigger,
}: {
  id?: string;
  buildings: readonly BuildingOption[];
  value: number | null;
  onChange: (id: number) => void;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  className?: string;
  /** Custom trigger content (default: the chosen name or the placeholder). */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const chosen = buildings.find((b) => b.id === value) ?? null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            // A form field is a combobox named by its label; a custom trigger (e.g. "Mark as covered")
            // is a plain button named by its text.
            role={trigger ? undefined : "combobox"}
            aria-haspopup={trigger ? "dialog" : undefined}
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn("w-full justify-between font-normal", !chosen && !trigger && "text-muted-foreground", className)}
          />
        }
      >
        {/* With its area: DLD names repeat across areas. */}
        {trigger ?? (
          <span className="truncate">{chosen ? t("adminUi.buildingWithArea", { name: chosen.name, area: chosen.area }) : placeholder}</span>
        )}
        {trigger ? null : <ChevronsUpDownIcon aria-hidden="true" className="opacity-60" />}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-0">
        <BuildingCommand
          buildings={buildings}
          value={value}
          onPick={(b) => {
            onChange(b.id);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
