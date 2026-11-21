"use client";

/**
 * Notes about the data (REAL_DATA.md section 7), in the redesign's notice style (docs/REDESIGN.md
 * section 4): one paragraph of Archivo 15/1.5 in ink with a 2px left rule in --notice-foreground.
 * No box, no fill, no icon.
 * - `StaleNote`: "Fairsquare's sales data currently runs to {date}. Sales registered after that aren't
 *   included yet." when the loaded data ends more than 45 days before today. Shown on every result,
 *   the home page and the /c page. Nothing when the data is fresh or not loaded.
 */
import type { ReactNode } from "react";
import { usePublicConfig } from "@/components/shell/config-provider";
import { staleNote } from "@/lib/copy";
import { cn } from "@/lib/utils";

export function Notice({ children, slot = "result-notice", className }: { children: ReactNode; slot?: string; className?: string }) {
  return (
    <p
      role="note"
      data-slot={slot}
      className={cn("max-w-[62ch] border-l-2 border-notice-foreground pl-3 text-[15px] leading-normal text-foreground", className)}
    >
      {children}
    </p>
  );
}

/** The stale-data note, or nothing when the data is fresh or not loaded. */
export function StaleNote({ className }: { className?: string }) {
  const { data } = usePublicConfig();
  const note = staleNote(data);
  if (!note) return null;
  return (
    <Notice slot="stale-note" className={className}>
      {note}
    </Notice>
  );
}
