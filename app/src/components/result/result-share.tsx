"use client";

/**
 * The result's share pieces (RESULT_SPEC sections 3.2 and 8):
 * - `useCardGetter`: the card PNG, rendered once per comparison as soon as the result is in (not in
 *   idle time, so the desktop preview is usually ready at the handover). Not covered: no card.
 * - `useCardFile`: that file once rendered (null while rendering, or when it failed).
 * - `MoreWaysToShare`: the "More ways to share" text button and its drawer.
 * - `CardPreview`: desktop, the card PNG at 384px in the stage cell, a button named "Open the share
 *   card" that opens the same drawer. It fades in when the PNG is ready, with no placeholder; its box
 *   is reserved, so nothing under it moves. Its stamp is printed in the PNG: only the scale's stamp
 *   animates.
 * The card carries no listing screenshot (owner decision, 18 Nov 2026).
 */
import { useEffect, useMemo, useState } from "react";
import { MoreShareSheet, useObjectUrl } from "@/components/share/more-share";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { log } from "@/lib/log";
import { COPY, plainNotCovered } from "@/lib/copy";
import { renderCard } from "@/lib/stamp/card-canvas";
import type { CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The share card PNG for a comparison, rendered at most once (null for not covered or on failure). */
export function useCardGetter(check: CheckView | null): () => Promise<File | null> {
  return useMemo(() => {
    let card: Promise<File | null> | null = null;
    return () => {
      if (!check || plainNotCovered(check)) return Promise.resolve(null);
      card ??= renderCard({ check }).catch((err: unknown) => {
        log.warn("card_render_failed", { err });
        return null;
      });
      return card;
    };
  }, [check]);
}

/** The card file once rendered (null while rendering, or when it failed). */
export function useCardFile(getCard: () => Promise<File | null>, enabled = true): { file: File | null; ready: boolean } {
  const [card, setCard] = useState<{ getCard: typeof getCard; file: File | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    getCard().then(
      (file) => live && setCard({ getCard, file }),
      () => live && setCard({ getCard, file: null }),
    );
    return () => {
      live = false;
    };
  }, [getCard, enabled]);
  const mine = card && card.getCard === getCard ? card : null;
  return { file: mine?.file ?? null, ready: mine !== null };
}

const TEXT_BUTTON =
  "inline-flex min-h-11 items-center self-start rounded-sm text-base font-medium text-foreground underline decoration-1 underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function MoreWaysToShare({ check, file, className }: { check: CheckView; file: File | null; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={cn(TEXT_BUTTON, className)} data-slot="share-more">
        {COPY["share.more"]}
      </button>
      <MoreShareSheet open={open} onOpenChange={setOpen} check={check} file={file} />
    </>
  );
}

/**
 * The /c page's card preview (section 6.10): desktop only, as on the result; the card is rendered in
 * the viewer's browser from the stored comparison. Phones and not-covered comparisons get nothing.
 */
export function SharePageCard({ check }: { check: CheckView }) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const getCard = useCardGetter(desktop ? check : null);
  const { file } = useCardFile(getCard, desktop);
  if (!desktop || plainNotCovered(check)) return null;
  return <CardPreview check={check} file={file} />;
}

/** The card preview (desktop, section 3.2): 384px wide, 4:5, the PNG once rendered. */
export function CardPreview({ check, file, className }: { check: CheckView; file: File | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const url = useObjectUrl(file);
  return (
    <div className={cn("mx-auto aspect-[4/5] w-full max-w-96", className)} data-slot="card-preview">
      {url ? (
        <>
          <button
            type="button"
            aria-label={COPY["share.openCard"]}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
            className="block size-full animate-[mz-fade_200ms_var(--ease-out)_both] overflow-hidden rounded-sm bg-[#f6f7f4] shadow-sheet outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            data-slot="card-preview-button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of the card PNG */}
            <img src={url} alt="" className="size-full object-contain object-top" />
          </button>
          <MoreShareSheet open={open} onOpenChange={setOpen} check={check} file={file} />
        </>
      ) : null}
    </div>
  );
}
