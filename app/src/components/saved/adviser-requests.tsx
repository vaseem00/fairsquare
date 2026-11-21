"use client";

/**
 * "Adviser request" (DESIGN.md section 3.6): `MeView.leads`, newest first, with Withdraw
 * (AlertDialog) on active ones and the withdrawn line on the others. Hidden when there are none.
 */
import { useId, useRef, useState } from "react";
import { WithdrawLeadButton } from "@/components/money/lead-receipt";
import { COPY, t } from "@/lib/copy";
import { bedsLabel, formatInt, formatTimestampDate } from "@/lib/format";
import type { LeadView } from "@/lib/types";

function LeadRow({ lead: initial }: { lead: LeadView }) {
  const [lead, setLead] = useState(initial);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const withdrawn = lead.status === "withdrawn";
  return (
    <div className="flex flex-col gap-1 py-5" data-slot="adviser-request" data-status={lead.status}>
      <p ref={lineRef} tabIndex={-1} className="text-body text-foreground outline-none">
        {withdrawn && lead.withdrawnAt
          ? t("saved.adviserWithdrawn", { date: formatTimestampDate(lead.withdrawnAt), PARTNER_NAME: lead.partner })
          : t("saved.adviserLine", { PARTNER_NAME: lead.partner, date: formatTimestampDate(lead.createdAt) })}
      </p>
      <p className="text-caption text-muted-foreground num">
        {t("lead.sentListing", {
          building: lead.buildingName,
          bedType: bedsLabel(lead.bedrooms),
          price: formatInt(lead.priceAed),
        })}
      </p>
      {withdrawn ? null : (
        <WithdrawLeadButton lead={lead} onWithdrawn={setLead} focusAfter={lineRef} className="mt-2 w-fit" />
      )}
    </div>
  );
}

export function AdviserRequests({ leads }: { leads: readonly LeadView[] }) {
  const headingId = useId();
  if (leads.length === 0) return null;
  const sorted = [...leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section aria-labelledby={headingId} className="flex flex-col" data-slot="saved-leads">
      <h2 id={headingId} className="mb-4 type-heading text-foreground">
        {COPY["saved.adviserH2"]}
      </h2>
      <ul className="flex flex-col border-b border-border">
        {sorted.map((lead) => (
          <li key={`${lead.id}-${lead.status}`} className="border-t border-border">
            <LeadRow lead={lead} />
          </li>
        ))}
      </ul>
    </section>
  );
}
