"use client";

/**
 * "More ways to share" (RESULT_SPEC section 8.2): a bottom Drawer on phones and a Dialog from 1024px.
 *
 *   [ the card image, full width, 4:5 ]
 *   [ Send the card image ]          Web Share with the PNG file; left out where the browser can't
 *   Download card_
 *   Copy link_
 *   Copy text_                       the WhatsApp text (section 8.2)
 *
 * The card is a local PNG (never uploaded); until it is rendered its 4:5 box stays empty (no
 * placeholder, no skeleton). A not-covered comparison has no card: only the link and the text. A
 * cancelled share sheet shows nothing; other failures show the error toast. If copying is blocked, a
 * note says to press and hold the link, which is shown under it. Every action is recorded with
 * `api.track` (copying the text has no event of its own).
 */
import { XIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { canShareFiles, copyText, downloadFile, shareCardFile } from "@/components/share/share";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { api } from "@/lib/api/client";
import { cardAlt, COPY, plainNotCovered, shareText } from "@/lib/copy";
import type { CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

const TEXT_BUTTON =
  "inline-flex min-h-11 items-center self-start rounded-sm text-base font-medium text-foreground underline decoration-1 underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:no-underline disabled:opacity-50";

/** An object URL for the card file, revoked when the file changes or the view goes. */
export function useObjectUrl(file: Blob | null): string | null {
  const url = useMemo(() => (file && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

function MoreShareBody({ check, file }: { check: CheckView; file: File | null }) {
  const url = useObjectUrl(file);
  const [copyFailed, setCopyFailed] = useState(false);
  const none = plainNotCovered(check);
  const alt = cardAlt(check);
  const text = shareText(check);

  const onSendImage = () => {
    if (!canShareFiles(file)) return;
    // Called synchronously in the tap (iOS needs the user activation): the file is already built.
    void shareCardFile(file, text, check.url).then((outcome) => {
      if (outcome === "shared") api.track("share_native", check.code);
      else if (outcome === "failed") toast.error(COPY["error.shareFailed"]);
    });
  };

  const onDownload = () => {
    if (!file) return;
    downloadFile(file);
    toast.success(COPY["share.downloaded"]);
    api.track("card_downloaded", check.code);
  };

  const onCopy = async (what: "link" | "text") => {
    const ok = await copyText(what === "link" ? check.url : text);
    setCopyFailed(!ok);
    if (!ok) return;
    toast.success(COPY[what === "link" ? "share.copied" : "share.textCopied"]);
    if (what === "link") api.track("link_copied", check.code);
  };

  return (
    <div className="flex flex-col gap-4 px-4 pb-[calc(24px+env(safe-area-inset-bottom))] lg:px-0 lg:pb-0" data-slot="more-share">
      {none ? null : (
        <div className="aspect-[4/5] w-full overflow-hidden rounded-sm bg-[#f6f7f4] shadow-sheet" data-slot="more-share-card">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL of the card PNG
            <img src={url} alt={alt ?? ""} className="size-full animate-[mz-fade_200ms_var(--ease-out)_both] object-contain" />
          ) : null}
        </div>
      )}
      {canShareFiles(file) ? (
        <Button type="button" size="lg" className="w-full" onClick={onSendImage} data-slot="share-image">
          {COPY["share.image"]}
        </Button>
      ) : null}
      <div className="flex flex-col">
        {none ? null : (
          <button type="button" className={TEXT_BUTTON} onClick={onDownload} disabled={!file} data-slot="share-download">
            {COPY["share.download"]}
          </button>
        )}
        <button type="button" className={TEXT_BUTTON} onClick={() => void onCopy("link")} data-slot="share-copy-link">
          {COPY["share.copy"]}
        </button>
        <button type="button" className={TEXT_BUTTON} onClick={() => void onCopy("text")} data-slot="share-copy-text">
          {COPY["share.copyText"]}
        </button>
      </div>
      {copyFailed ? (
        <p role="status" className="text-caption text-muted-foreground" data-slot="share-copy-failed">
          {COPY["error.clipboard"]}{" "}
          <span className="break-all text-foreground select-all num">{check.url}</span>
        </p>
      ) : null}
    </div>
  );
}

export function MoreShareSheet({
  open,
  onOpenChange,
  check,
  file,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  check: CheckView;
  file: File | null;
}): ReactNode {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const title = COPY["share.more"];

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-6 sm:max-w-sm">
          <DialogHeader className="pr-10">
            <DialogTitle className="type-title">{title}</DialogTitle>
          </DialogHeader>
          {open ? <MoreShareBody check={check} file={file} /> : null}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent>
        <DrawerHeader className="relative px-4 pt-2 pb-4 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <DrawerTitle className="pr-12 type-title">{title}</DrawerTitle>
          <DrawerClose render={<Button variant="ghost" size="icon" className="absolute top-0 right-2" aria-label={COPY["ui.close"]} />}>
            <XIcon aria-hidden="true" strokeWidth={1.75} />
          </DrawerClose>
        </DrawerHeader>
        <div className={cn("max-h-[78dvh] overflow-y-auto")}>{open ? <MoreShareBody check={check} file={file} /> : null}</div>
      </DrawerContent>
    </Drawer>
  );
}
