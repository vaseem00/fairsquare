"use client";

/**
 * The below-market check (RESULT_SPEC section 6.4): a calm notice, never a celebration. Archivo
 * 15/22 ink behind a 2px --notice-foreground rule, with "How to check" opening a short static sheet:
 * the three steps and a link about the Madmoun QR code. It never claims the permit shows whether a
 * unit is sold (unverified, RESULT_RESEARCH section 11).
 */
import { useState } from "react";
import { InfoSheet } from "@/components/result/info-sheet";
import { COPY, tList } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * The Dubai Media Office announcement of the DLD listing barcode check, the source RESULT_RESEARCH.md
 * cites for the Madmoun QR code (the spec's "DLD's Madmoun page" has no confirmed URL yet).
 */
export const MADMOUN_INFO_URL = "https://mediaoffice.ae/en/news/2023/april/18-04/dubai-land-department-barcode-check";

export function ListingCheck({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p
        role="note"
        className={cn("max-w-[60ch] border-l-2 border-notice-foreground pl-3 text-[15px] leading-[22px] text-foreground lg:text-base lg:leading-6", className)}
        data-slot="listing-check"
      >
        {COPY["result.listingCheck"]}{" "}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="relative rounded-sm font-medium whitespace-nowrap text-foreground underline decoration-1 underline-offset-4 outline-none after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          data-slot="how-to-check"
        >
          {COPY["result.howToCheck"]}
        </button>
      </p>
      <InfoSheet open={open} onOpenChange={setOpen} title={COPY["result.howToCheck"]} slot="how-to-check-sheet">
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-[15px] leading-[22px] text-foreground">
          {tList("result.howToCheckSteps").map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <a
          href={MADMOUN_INFO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex min-h-11 items-center rounded-sm text-base font-medium text-foreground underline decoration-1 underline-offset-4 hover:decoration-2"
        >
          {COPY["result.howToCheckLink"]}
        </a>
      </InfoSheet>
    </>
  );
}
