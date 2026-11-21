"use client";

/**
 * One saved listing on /saved (docs/REDESIGN.md section 8.10): the building in `type-title` with
 * "1 new sale" as plain ink text (sales since saving; it does not clear), the listing line, the saved
 * line with its figure in the verdict colour (the direction is also in the sign), today's line in
 * pencil, "Open" and an overflow menu holding Remove. Rows sit between hairlines; no card, no pill.
 * Removal never happens from the result page.
 */
import { EllipsisVerticalIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useId, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { buildingLabel, COPY, t, tPlural } from "@/lib/copy";
import { bedsLabel, formatInt, formatPct, formatTimestampDate } from "@/lib/format";
import type { SavedItemView } from "@/lib/types";
import { cn } from "@/lib/utils";

type Snapshot = SavedItemView["atSave"];

function hasFigure(s: Snapshot): s is Snapshot & { diff: number } {
  return s.diff !== null && (s.band === "above" || s.band === "below" || s.band === "inline");
}

/** "Saved 3 Nov 2026: +15.2% vs 10 sales." or "Saved 3 Nov 2026: too few sales to compare." */
export function thenLine(item: SavedItemView): string {
  const date = formatTimestampDate(item.savedAt);
  // A leading range of adjusted registered sales: the outcome against it, as the comparison's page says.
  if (item.acs) return t("acs.saved", { date, position: acsPosition(item.acs.verdict) });
  // The last resort: the outcome against the range of nearby registered sales.
  if (item.nearby) return t("nearby.saved", { date, position: acsPosition(item.nearby.verdict) });
  return hasFigure(item.atSave)
    ? t("saved.then", { date, figure: formatPct(item.atSave.diff), count: item.atSave.count })
    : t("saved.thenThin", { date });
}

/** "Today: +14.0% vs 11 sales." or null when there is no verdict today. */
export function nowLine(item: SavedItemView): string | null {
  // The stored range is a dated statement and is never recomputed: no "Today" figure beside it.
  if (item.acs) return null;
  return hasFigure(item.now) ? t("saved.now", { figure: formatPct(item.now.diff), count: item.now.count }) : null;
}

const ACS_POSITION = { within: "acs.posWithin", above: "acs.posAbove", below: "acs.posBelow" } as const;
function acsPosition(verdict: NonNullable<SavedItemView["acs"]>["verdict"]): string {
  return COPY[ACS_POSITION[verdict]];
}

const TONE: Partial<Record<Snapshot["band"], string>> = {
  above: "text-verdict-above",
  inline: "text-verdict-inline",
  below: "text-verdict-below",
};

/** A then or now line with its figure in the verdict colour; plain text when there is no figure. */
function FigureLine({ line, snapshot, acs = null, className }: { line: string; snapshot: Snapshot; acs?: SavedItemView["acs"]; className?: string }) {
  if (acs) {
    // "within", "above" or "below" takes the outcome's colour; the word itself carries the meaning.
    const word = acsPosition(acs.verdict);
    const at = line.indexOf(` ${word} `);
    if (at < 0) return <p className={className}>{line}</p>;
    return (
      <p className={className} data-slot="saved-acs">
        {line.slice(0, at + 1)}
        <span className={cn("font-medium", TONE[acs.verdict === "within" ? "inline" : acs.verdict])}>{word}</span>
        {line.slice(at + 1 + word.length)}
      </p>
    );
  }
  if (!hasFigure(snapshot)) return <p className={className}>{line}</p>;
  const figure = formatPct(snapshot.diff);
  const at = line.indexOf(figure);
  if (at < 0) return <p className={className}>{line}</p>;
  return (
    <p className={className}>
      {line.slice(0, at)}
      <span className={cn("font-medium", TONE[snapshot.band])}>{figure}</span>
      {line.slice(at + figure.length)}
    </p>
  );
}

export function SavedItem({
  item,
  opening,
  onOpen,
  onRemove,
  openRef,
  error,
}: {
  item: SavedItemView;
  opening?: boolean;
  onOpen(item: SavedItemView): void;
  onRemove(item: SavedItemView): void;
  openRef?: Ref<HTMLButtonElement>;
  /** A failed Remove, shown here until the next try (never only in a toast, D§7.1). */
  error?: string | null;
}) {
  const building = buildingLabel(item);
  const now = nowLine(item);
  const errorId = useId();
  return (
    <article className="flex flex-col gap-1.5 py-6" data-slot="saved-item" data-code={item.code}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="type-title text-foreground">{building}</h3>
        {item.newSalesSinceSave > 0 ? (
          <span className="text-[15px] font-medium text-foreground num" data-slot="new-sales">
            {tPlural("saved.newSales", item.newSalesSinceSave)}
          </span>
        ) : null}
      </div>
      <p className="text-[15px] text-foreground num">
        {t("saved.itemDetail", { bedType: bedsLabel(item.bedrooms), price: formatInt(item.priceAed) })}
      </p>
      <div className="flex flex-col gap-0.5 num">
        <FigureLine line={thenLine(item)} snapshot={item.atSave} acs={item.acs ?? item.nearby} className="text-[15px] text-foreground" />
        {now ? <FigureLine line={now} snapshot={item.now} className="text-caption text-muted-foreground" /> : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Button
          ref={openRef}
          type="button"
          variant="outline"
          onClick={() => onOpen(item)}
          aria-disabled={opening || undefined}
          // "Open Test Tower A": each item's button has its own name; it starts with the visible
          // "Open", so voice control still finds it (label in name).
          aria-label={`${COPY["saved.open"]} ${building}`}
          className="min-w-24"
        >
          {opening ? <Spinner /> : null}
          {COPY["saved.open"]}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="ghost" size="icon" aria-label={t("saved.more", { building })} />
            }
          >
            <EllipsisVerticalIcon aria-hidden="true" strokeWidth={1.75} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem variant="destructive" onClick={() => onRemove(item)} className="min-h-11">
              <Trash2Icon aria-hidden="true" strokeWidth={1.75} />
              {COPY["saved.remove"]}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-caption text-destructive" data-slot="saved-item-error">
          <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </article>
  );
}
