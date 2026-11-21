"use client";

/**
 * The evidence line (RESULT_SPEC sections 3.1 and 6), Archivo 14/20 in pencil:
 *
 *   Strong evidence. 43 registered sales of ready 2-beds in Aykon City (2) -Tower C, 16 Nov 2025 to
 *   16 Nov 2026, the latest on 16 Nov. None set aside. Not a valuation. Wrong building?
 *
 * "Strong evidence" (ink 500, underlined) opens the definitions: a Popover from 1024px, a bottom Drawer
 * on phones. The tier starts from the count (20 Strong, 10 Moderate, 5 Limited) and drops one for fewer
 * than 3 sales in 90 days and one more for a middle half wider than 20% of the median. The DLD building
 * is named verbatim, so a wrong match shows; "Wrong building?" opens the building question.
 * Too few sales: "DLD building: {dld}. Not a valuation. Wrong building?" (`ThinEvidenceLine`).
 * Not covered: no evidence line.
 */
import { useState } from "react";
import { InfoSheet } from "@/components/result/info-sheet";
import { noBreakBeds } from "@/components/result/no-break";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COPY } from "@/lib/copy";
import { keepFiguresTogether } from "@/lib/format";
import { evidenceDefinitions, evidenceLine, thinEvidence } from "@/lib/result/words";
import type { CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

const TEXT_BUTTON =
  "relative inline rounded-sm text-foreground underline decoration-1 underline-offset-[3px] outline-none after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function Definitions({ check }: { check: CheckView }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-[22px] text-foreground num" data-slot="evidence-definitions">
      {evidenceDefinitions(check).map((line) => (
        <p key={line}>{keepFiguresTogether(line)}</p>
      ))}
    </div>
  );
}

function WrongBuilding({ onWrongBuilding }: { onWrongBuilding?: () => void }) {
  if (!onWrongBuilding) return null;
  return (
    <>
      {" "}
      <button type="button" onClick={onWrongBuilding} className={cn(TEXT_BUTTON, "whitespace-nowrap")} data-slot="wrong-building">
        {COPY["evidence.wrongBuilding"]}
      </button>
    </>
  );
}

export function EvidenceLine({ check, onWrongBuilding, className }: { check: CheckView; onWrongBuilding?: () => void; className?: string }) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [open, setOpen] = useState(false);
  const line = evidenceLine(check);
  if (!line) return null;
  const trigger = cn(TEXT_BUTTON, "font-medium");
  return (
    <>
      <p className={cn("max-w-[62ch] text-[14px] leading-5 text-muted-foreground num", className)} data-slot="evidence-line" data-tier={line.tier}>
        {desktop ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<button type="button" className={trigger} data-slot="evidence-trigger" />}>{line.label}</PopoverTrigger>
            <PopoverContent align="start" className="w-[min(380px,calc(100vw-2rem))] gap-3 p-4">
              <Definitions check={check} />
            </PopoverContent>
          </Popover>
        ) : (
          <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={trigger} data-slot="evidence-trigger">
            {line.label}
          </button>
        )}
        {noBreakBeds(keepFiguresTogether(line.rest))}
        <WrongBuilding onWrongBuilding={onWrongBuilding} />
      </p>
      {desktop ? null : (
        <InfoSheet open={open} onOpenChange={setOpen} title={line.label} slot="evidence-sheet">
          <Definitions check={check} />
        </InfoSheet>
      )}
    </>
  );
}

/** The too-few state's evidence line: the DLD building, "Not a valuation" and "Wrong building?". */
export function ThinEvidenceLine({ check, onWrongBuilding, className }: { check: CheckView; onWrongBuilding?: () => void; className?: string }) {
  const text = thinEvidence(check);
  if (!text) return null;
  return (
    <p className={cn("max-w-[62ch] text-[14px] leading-5 text-muted-foreground", className)} data-slot="evidence-line" data-tier="thin">
      {text}
      <WrongBuilding onWrongBuilding={onWrongBuilding} />
    </p>
  );
}
