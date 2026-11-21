"use client";

/**
 * The share actions (RESULT_SPEC section 8.2), WhatsApp first:
 * - `WhatsAppButton`: [Send on WhatsApp], the primary on a verdict. It opens
 *   `https://wa.me/?text={share text}`; WhatsApp unfurls the OG card from the /c link in the text.
 * - `ShareButton`: [Share], outline, beside Save and track on the too-few result. It opens the "More
 *   ways to share" drawer (the card image, Download card, Copy link, Copy text).
 * Text only, no icon (docs/REDESIGN.md section 4). A not-covered comparison has no card and no share
 * button (it shares the link only, from its own page).
 */
import { useState } from "react";
import { MoreShareSheet } from "@/components/share/more-share";
import { whatsappUrl } from "@/components/share/share";
import { Button, buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { COPY, plainNotCovered, shareText } from "@/lib/copy";
import type { CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

export function WhatsAppButton({ check, className }: { check: CheckView; className?: string }) {
  return (
    <a
      href={whatsappUrl(shareText(check))}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: "default", size: "lg" }), className)}
      onClick={() => api.track("share_whatsapp", check.code)}
      data-slot="share-whatsapp"
    >
      {COPY["share.whatsapp"]}
    </a>
  );
}

export function ShareButton({
  check,
  file,
  variant = "outline",
  className,
}: {
  check: CheckView;
  /** The card PNG once rendered (null while it renders). */
  file: File | null;
  variant?: "default" | "outline";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (plainNotCovered(check)) return null;
  return (
    <>
      <Button type="button" variant={variant} size="lg" aria-haspopup="dialog" className={className} onClick={() => setOpen(true)} data-slot="share-card">
        {COPY["share.cta"]}
      </Button>
      <MoreShareSheet open={open} onOpenChange={setOpen} check={check} file={file} />
    </>
  );
}
