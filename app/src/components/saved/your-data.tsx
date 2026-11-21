"use client";

/**
 * "Your data" on /saved (DESIGN.md sections 3.6 and 6.9, A§4.3 DELETE /api/me): what Fairsquare stores
 * for this browser, the recovery link, and "Delete all my data" behind an AlertDialog, set apart
 * from the other actions. After deletion the page shows the empty state and focus goes to the h1.
 */
import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, type RefObject } from "react";
import { useAnnounce } from "@/components/a11y/live-region";
import { visualToast } from "@/components/a11y/visual-toast";
import { usePublicConfig } from "@/components/shell/config-provider";
import { useMe } from "@/components/shell/me-provider";
import { RecoveryLink } from "@/components/saved/recovery-link";
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
import { formatInt } from "@/lib/format";

export interface DataCounts {
  checks: number;
  saved: number;
  requests: number;
  leads: number;
}

export function YourData({
  counts,
  onDeleted,
  afterDeleteFocus,
}: {
  counts: DataCounts;
  onDeleted(): void;
  /** Receives focus once everything is deleted (the Saved h1). */
  afterDeleteFocus?: RefObject<HTMLElement | null>;
}) {
  const config = usePublicConfig();
  // The configured partner; without one, the partner of the person's own adviser request; with
  // neither, the wording that leaves the adviser out (REAL_DATA.md section 8).
  const { me } = useMe();
  const partnerName = config.partner?.name ?? me?.leads[0]?.partner ?? null;
  const announce = useAnnounce();
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleted = useRef(false);

  const rows: Array<[string, number]> = [
    [COPY["saved.dataChecks"], counts.checks],
    [COPY["saved.dataSaved"], counts.saved],
    [COPY["saved.dataRequests"], counts.requests],
    [COPY["saved.dataLeads"], counts.leads],
  ];

  const deleteAll = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await api.me.remove();
    setBusy(false);
    if (!res.ok) {
      // Shown in the dialog, next to the action, until the next try (never only in a toast).
      setError(res.error.message);
      return;
    }
    deleted.current = true;
    setOpen(false);
    // Spoken once, by the live region; the toast is the visual copy.
    visualToast(COPY["confirm.delete.done"]);
    announce(COPY["confirm.delete.done"]);
    onDeleted();
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4" data-slot="your-data">
      <h2 id={headingId} className="type-heading text-foreground">
        {COPY["saved.dataH2"]}
      </h2>
      <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 border-y border-border py-2 text-[15px]">
        {rows.map(([label, n]) => (
          <div key={label} className="contents">
            <dt className="py-1 text-muted-foreground">{label}</dt>
            <dd className="py-1 text-right text-foreground num">{formatInt(n)}</dd>
          </div>
        ))}
      </dl>
      <Link
        href="/privacy"
        className="inline-flex min-h-11 w-fit items-center rounded-sm text-body font-medium text-foreground underline decoration-1 underline-offset-4 hover:decoration-2"
      >
        {COPY["privacy.storesH2"]}
      </Link>
      <RecoveryLink />
      <div className="mt-6">
        <AlertDialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setError(null);
          }}
        >
          <AlertDialogTrigger render={<Button type="button" variant="destructive-outline" />}>
            {COPY["saved.deleteCta"]}
          </AlertDialogTrigger>
          <AlertDialogContent
            className="data-[size=default]:sm:max-w-md"
            finalFocus={() => (deleted.current ? (afterDeleteFocus?.current ?? true) : true)}
          >
            <AlertDialogHeader>
              <AlertDialogTitle className="type-title">{COPY["confirm.delete.title"]}</AlertDialogTitle>
              <AlertDialogDescription className="text-body text-foreground">
                {partnerName ? t("confirm.delete.body", { PARTNER_NAME: partnerName }) : COPY["confirm.delete.bodyNoPartner"]}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error ? (
              <p role="alert" className="flex items-start gap-1.5 text-body text-destructive" data-slot="delete-error">
                <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0" />
                {error}
              </p>
            ) : null}
            <AlertDialogFooter className="gap-2 sm:justify-between">
              <AlertDialogCancel>{COPY["confirm.delete.no"]}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={deleteAll} aria-disabled={busy || undefined}>
                {busy ? <Spinner /> : null}
                {COPY["confirm.delete.yes"]}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}
