"use client";

/**
 * The monthly cost row on every result (DESIGN.md section 3.4): a full-width 56px row button,
 * "About AED 10,618 a month with 20% down" plus "Adjust", that opens the CostPanel.
 * It works for every result type, including too few sales and not covered (price only). No icon:
 * the words and the underlined "Adjust" say what it does (docs/REDESIGN.md section 8.5).
 * Only a top rule: the sales accordion below draws its own, so the two never double up (D§3.4).
 */
import { estimateFor, useMortgageChoice } from "@/components/money/cost-store";
import { COPY, costRow } from "@/lib/copy";
import type { CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CostRow({ check, onOpen, className }: { check: CheckView; onOpen(): void; className?: string }) {
  const choice = useMortgageChoice(check.code, check.priceAed);
  const est = estimateFor(check.priceAed, choice);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-slot="cost-row"
      className={cn(
        "flex min-h-14 w-full items-center gap-3 border-t border-border py-2 text-left text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <span className="flex-1 num">{costRow(est.monthlyAed, choice.downPct)}</span>
      <span className="shrink-0 font-medium text-foreground underline decoration-1 underline-offset-4">{COPY["cost.adjust"]}</span>
    </button>
  );
}
