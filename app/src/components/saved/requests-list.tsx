"use client";

/**
 * "Buildings you asked for" (docs/REDESIGN.md section 8.10): `MeView.requests`, one row per building
 * between hairlines, from the not-covered result and the Coverage form. "Not covered yet" is plain
 * ink text (no pill, no icon); "Now covered. Compare again." once an admin marks it covered. Hidden
 * when there are none.
 */
import Link from "next/link";
import { useId } from "react";
import { COPY, t } from "@/lib/copy";
import { formatTimestampDate } from "@/lib/format";
import type { RequestView } from "@/lib/types";

export function RequestsList({ requests }: { requests: readonly RequestView[] }) {
  const headingId = useId();
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col" data-slot="saved-requests">
      <h2 id={headingId} className="mb-4 type-heading text-foreground">
        {COPY["saved.requestsH2"]}
      </h2>
      <ul className="flex flex-col border-b border-border">
        {requests.map((r) => (
          <li key={r.id} className="border-t border-border">
            <div className="flex flex-col gap-1 py-5">
              <h3 className="type-title text-foreground">{r.coveredBuilding?.name ?? r.text}</h3>
              {r.area ? <p className="text-caption text-muted-foreground">{r.area}</p> : null}
              <p className="text-caption text-muted-foreground num">
                {t("saved.requestLine", { date: formatTimestampDate(r.createdAt), n: r.othersAsked })}
              </p>
              {r.covered ? (
                <Link
                  href="/"
                  className="inline-flex min-h-11 w-fit items-center rounded-sm text-body font-medium text-foreground underline decoration-1 underline-offset-4 hover:decoration-2"
                >
                  {COPY["saved.nowCovered"]}
                </Link>
              ) : (
                <p className="text-[15px] text-foreground">{COPY["band.none"]}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
