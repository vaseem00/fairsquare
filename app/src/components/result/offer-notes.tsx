"use client";

/**
 * "Before you make an offer" (RESULT_SPEC section 5, v1 static copy built from the data): a
 * disclosure row (a `<button aria-expanded>` in an h3, 56px, type-title) over the spread sentence
 * (with the premium count when 3 or more sales sit at 1.15 times the median or more) and the plain list
 * of what to ask the agent. Closed on phones except in the Above state; open from 1024px. The parent
 * owns `open`, so "Ask what explains the premium" can open it and scroll to it. No offer figure, ever.
 */
import { ChevronDownIcon } from "lucide-react";
import { useId } from "react";
import { COPY } from "@/lib/copy";
import type { ScaleModel } from "@/lib/result/scale-model";
import { offerItems, offerText } from "@/lib/result/words";
import { keepFiguresTogether } from "@/lib/format";
import { cn } from "@/lib/utils";

export const OFFER_ID = "offer";

export function OfferNotes({
  model,
  open,
  onOpenChange,
  className,
}: {
  model: ScaleModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const panelId = useId();
  return (
    <section id={OFFER_ID} className={cn("scroll-mt-(--header-h) border-t border-border", className)} data-slot="offer-notes">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onOpenChange(!open)}
          className="flex min-h-14 w-full items-center justify-between gap-3 rounded-sm text-left type-title text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          data-slot="offer-toggle"
        >
          <span>{COPY["offer.h"]}</span>
          <ChevronDownIcon aria-hidden="true" strokeWidth={1.75} className={cn("size-5 shrink-0 transition-transform duration-(--dur-base)", open && "rotate-180")} />
        </button>
      </h3>
      <div id={panelId} hidden={!open} data-slot="offer-panel">
        <p className="max-w-[62ch] text-base leading-6 text-foreground num">{keepFiguresTogether(offerText(model))}</p>
        <p className="mt-4 text-[14px] leading-5 font-medium text-foreground">{COPY["offer.ask"]}</p>
        <ul className="mt-2 text-base leading-6 text-foreground">
          {offerItems().map((item) => (
            <li key={item} className="min-h-12 border-t border-border py-3">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
