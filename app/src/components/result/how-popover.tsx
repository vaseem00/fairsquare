"use client";

/**
 * "How Fairsquare compares" (docs/REDESIGN.md section 8.5): an underlined text button (44px hit area, no
 * icon) that opens a Popover on tap or Enter, never on hover, with the method in one paragraph and a
 * link to /how-it-works. It sits in the same place on every result and /c page (consistent help).
 */
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COPY, howBody } from "@/lib/copy";
import type { CheckView } from "@/lib/types";

/** `check` gives the rules and the window end, so the method names the real dates (REAL_DATA.md section 7). */
export function HowPopover({ check, className }: { check: Pick<CheckView, "rules" | "analysis"> & Partial<Pick<CheckView, "acs" | "building" | "similar" | "nearby">>; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="link" className={className} />}>
        {COPY["result.howTrigger"]}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(340px,calc(100vw-2rem))] gap-3 p-4 text-body">
        <p className="type-lead text-popover-foreground">{howBody(check)}</p>
        <Link
          href="/how-it-works"
          className="inline-flex min-h-11 items-center self-start rounded-sm text-body font-medium text-foreground underline decoration-1 underline-offset-4 hover:decoration-2"
        >
          {COPY["result.howLink"]}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
