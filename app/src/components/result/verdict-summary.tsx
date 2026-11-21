/**
 * The verdict's words (docs/REDESIGN.md sections 3.4 and 8.5).
 * - `VerdictHeadline`: "14.3% above registered sales" in `type-display-lg`; only the figure and
 *   direction words take the verdict colour, the rest is ink. Too few ("Too few sales to compare yet")
 *   and not covered ("Not covered yet") are plain ink. It never holds a building name.
 * - `TallyDots`: "2 of the 5 sales needed" as dots with progress semantics and the visible text.
 * - `SizeNote`: the size check, a left-ruled notice.
 * - `todayLine`: the /c page's "Today: ..." when today's count or median moved.
 * No hooks: renders on the server (the /c page) and in client trees (the compare flow).
 */
import type { Ref } from "react";
import { Notice } from "@/components/data/data-notice";
import { acsHead, acsLead, acsTone, nearbyHead, nearbyShown, sizeNote, t, verdictHead } from "@/lib/copy";
import { formatPct } from "@/lib/format";
import type { AnalysisView, CheckBand, CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

export { verdictHead };

const BAND_TEXT: Record<CheckBand, string> = {
  above: "text-verdict-above",
  inline: "text-verdict-inline",
  below: "text-verdict-below",
  thin: "text-foreground",
  none: "text-foreground",
};

/** The outcome of a leading range of adjusted registered sales, when it replaces the same-building verdict's words. */
export type AcsOutcome = "above" | "within" | "below";

/** The leading range's outcome for a comparison, or null (the headline is then the same-building verdict's). */
export function acsOutcome(check: Pick<CheckView, "analysis" | "acs" | "building">): AcsOutcome | null {
  return acsLead(check)?.verdict ?? null;
}

/** The outcome of a shown range of nearby registered sales (the last resort, DESIGN.md section 6.18), or null. */
export function nearbyOutcome(check: Pick<CheckView, "analysis"> & Partial<Pick<CheckView, "acs" | "building" | "similar" | "nearby">>): AcsOutcome | null {
  return nearbyShown(check)?.verdict ?? null;
}

/**
 * The verdict words inline: the coloured figure span, then the rest in ink (headlines, Saved, /c).
 * With `acs` (a leading range of adjusted registered sales, DESIGN.md section 6.17) the words are
 * "Within the range" + "of adjusted sales" and the hue is the outcome's; no percentage. With `nearby`
 * (the last resort) they are "Above the range" + "of nearby sales", in place of the too-few or
 * not-covered heading.
 */
export function VerdictWords({ band, diff, acs = null, nearby = null, className }: { band: CheckBand; diff: number | null; acs?: AcsOutcome | null; nearby?: AcsOutcome | null; className?: string }) {
  const { figure, rest } = nearby ? nearbyHead(nearby) : acs ? acsHead(acs) : verdictHead(band, diff);
  const tone = nearby ? acsTone(nearby) : acs ? acsTone(acs) : band;
  return (
    <span data-slot="verdict-words" data-band={band} data-acs={acs ?? undefined} data-nearby={nearby ?? undefined} className={className}>
      {figure ? (
        <>
          <span className={BAND_TEXT[tone]} data-slot="verdict-figure">
            {figure}
          </span>{" "}
        </>
      ) : null}
      {rest}
    </span>
  );
}

/** The verdict headline in `type-display-lg`: the coloured figure words plus the rest. Never a building name. */
export function VerdictHeadline({
  check,
  as: Tag = "h2",
  headingRef,
  className,
}: {
  check: CheckView;
  as?: "h1" | "h2" | "p" | "span";
  headingRef?: Ref<HTMLHeadingElement>;
  className?: string;
}) {
  const heading = Tag === "h1" || Tag === "h2";
  return (
    <Tag
      ref={heading ? headingRef : undefined}
      tabIndex={heading ? -1 : undefined}
      data-slot="verdict-headline"
      data-verdict=""
      className={cn("type-display-lg max-w-[14ch] text-foreground outline-none", className)}
    >
      <VerdictWords band={check.analysis.band} diff={check.analysis.diff} acs={acsOutcome(check)} nearby={nearbyOutcome(check)} />
    </Tag>
  );
}

/**
 * "2 of the 5 sales needed" as a tally (REDESIGN.md section 8.5): `min` dots of 10px, `count` filled
 * ink and the rest hollow (1.5px --input), with progress semantics and the visible text.
 */
export function TallyDots({ count, min }: { count: number; min: number }) {
  const text = t("thin.progress", { count, minSales: min });
  return (
    <div className="flex items-center gap-3" data-slot="tally">
      <div
        role="progressbar"
        aria-label={text}
        aria-valuemin={0}
        aria-valuemax={min}
        aria-valuenow={Math.min(count, min)}
        aria-valuetext={text}
        className="flex gap-1.5"
      >
        {Array.from({ length: min }, (_, i) => (
          <span
            key={i}
            className={cn("size-2.5 rounded-full", i < count ? "bg-foreground" : "border-[1.5px] border-input bg-transparent")}
          />
        ))}
      </div>
      <span className="text-caption font-medium text-foreground num" aria-hidden="true">
        {text}
      </span>
    </div>
  );
}

/** "Today: +12.1% vs 12 sales." when the count or median moved since the comparison; else null. */
export function todayLine(check: CheckView, current: AnalysisView | undefined): string | null {
  if (!current || check.analysis.band === "none" || current.band === "none") return null;
  // A leading range of adjusted registered sales is a dated statement and is never recomputed: a
  // "Today" figure against the median would read as a second verdict beside it.
  if (acsLead(check)) return null;
  const stored = check.analysis;
  const sameMedian =
    stored.medianPsf === current.medianPsf ||
    (stored.medianPsf !== null && current.medianPsf !== null && Math.abs(stored.medianPsf - current.medianPsf) < 0.005);
  if (stored.count === current.count && sameMedian) return null;
  if (current.diff !== null && current.band !== "thin") {
    return t("c.today", { figure: formatPct(current.diff), count: current.count });
  }
  return t("c.todayThin", { count: current.count, "sale/sales": current.count === 1 ? "sale" : "sales" });
}

/**
 * The size check (REAL_DATA.md section 7): "This listing is 24% larger than the typical sale here…"
 * when a comparison's listing size differs from the median size of its sales by more than 20%.
 * Only with a verdict: without one, no sales were compared.
 */
export function SizeNote({ check }: { check: CheckView }) {
  const band = check.analysis.band;
  if (band !== "above" && band !== "inline" && band !== "below") return null;
  // A leading range of adjusted registered sales has its own size note (AcsSizeNote).
  if (acsLead(check)) return null;
  const note = sizeNote(check);
  return note ? <Notice slot="size-note">{note}</Notice> : null;
}
