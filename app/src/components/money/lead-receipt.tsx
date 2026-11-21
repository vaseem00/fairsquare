"use client";

/**
 * The plain receipt after an adviser request (DESIGN.md sections 3.4 and 6.8), never JSON:
 * "Sent to {partner}", name, mobile ending, listing, sent date and time, and
 * "Withdraw this request" behind an AlertDialog (section 6.9). Focus moves to its heading on mount.
 */
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useAnnounce } from "@/components/a11y/live-region";
import { visualToast } from "@/components/a11y/visual-toast";
import { useMe } from "@/components/shell/me-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/client";
import { COPY, t } from "@/lib/copy";
import { bedsLabel, formatInt, formatTime, formatTimestampDate } from "@/lib/format";
import type { LeadView } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The last four digits of a masked phone ("+971 •• ••• 4567" → "4567"). */
export function last4(phoneMasked: string | null): string {
  return (phoneMasked ?? "").replace(/\D/g, "").slice(-4);
}

/**
 * "Withdraw this request" with its confirmation. Calls POST /api/leads/[id]/withdraw, then
 * `onWithdrawn(lead)`; `focusAfter` receives focus when the button itself goes away.
 */
export function WithdrawLeadButton({
  lead,
  onWithdrawn,
  focusAfter,
  label = COPY["lead.withdraw"],
  className,
}: {
  lead: LeadView;
  onWithdrawn(lead: LeadView): void;
  focusAfter?: RefObject<HTMLElement | null>;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const announce = useAnnounce();
  const { refresh } = useMe();

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await api.leads.withdraw(lead.id);
    setBusy(false);
    if (!res.ok) {
      // Shown in the dialog, next to the action, until the next try (never only in a toast).
      setError(res.error.message);
      return;
    }
    setOpen(false);
    // Spoken once, by the live region; the toast is the visual copy.
    visualToast(COPY["confirm.withdraw.done"]);
    announce(COPY["confirm.withdraw.done"]);
    onWithdrawn(res.data.lead);
    void refresh();
    // The trigger disappears once withdrawn; keep focus somewhere meaningful.
    setTimeout(() => focusAfter?.current?.focus(), 0);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <AlertDialogTrigger render={<Button type="button" variant="outline" className={className} />}>
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-title font-[640] wdth-title">
            {COPY["confirm.withdraw.title"]}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-body text-foreground">
            {t("confirm.withdraw.body", { PARTNER_NAME: lead.partner })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="flex items-start gap-1.5 text-body text-destructive" data-slot="withdraw-error">
            <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0" />
            {error}
          </p>
        ) : null}
        <AlertDialogFooter className="gap-2 sm:justify-between">
          <AlertDialogCancel>{COPY["confirm.withdraw.no"]}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm} aria-disabled={busy || undefined}>
            {busy ? <Spinner /> : null}
            {COPY["confirm.withdraw.yes"]}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function LeadReceipt({
  lead: initial,
  name,
  focusOnMount = true,
  className,
}: {
  lead: LeadView;
  /** The name as typed (the API never returns it). */
  name: string;
  focusOnMount?: boolean;
  className?: string;
}) {
  const [lead, setLead] = useState(initial);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);

  const withdrawn = lead.status === "withdrawn";
  return (
    <div
      data-slot="lead-receipt"
      className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-input bg-card p-4 text-body", className)}
    >
      <CircleCheckIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 text-primary" />
      <h4 ref={headingRef} tabIndex={-1} className="font-semibold text-foreground outline-none">
        {t("lead.sentTitle", { PARTNER_NAME: lead.partner })}
      </h4>
      <div className="col-start-2 flex flex-col gap-1 text-foreground">
        {name && !withdrawn ? <p>{t("lead.sentName", { name })}</p> : null}
        {last4(lead.phoneMasked) ? <p className="num">{t("lead.sentMobile", { last4: last4(lead.phoneMasked) })}</p> : null}
        <p>
          {t("lead.sentListing", {
            building: lead.buildingName,
            bedType: bedsLabel(lead.bedrooms),
            price: formatInt(lead.priceAed),
          })}
        </p>
        <p className="text-muted-foreground num">
          {t("lead.sentAt", { date: formatTimestampDate(lead.createdAt), time: formatTime(lead.createdAt) })}
        </p>
        {withdrawn && lead.withdrawnAt ? (
          <p className="text-muted-foreground">
            {t("saved.adviserWithdrawn", {
              date: formatTimestampDate(lead.withdrawnAt),
              PARTNER_NAME: lead.partner,
            })}
          </p>
        ) : (
          <WithdrawLeadButton lead={lead} onWithdrawn={setLead} focusAfter={headingRef} className="mt-2 w-fit" />
        )}
      </div>
    </div>
  );
}
