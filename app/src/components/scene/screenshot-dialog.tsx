"use client";

/**
 * The person's screenshot, small and large (docs/REDESIGN.md sections 7.5 and 8.6):
 * - `ScreenshotThumb`: a thumbnail button named "View screenshot larger" that opens the dialog.
 * - `ScreenshotDialog`: the whole screenshot, pinch zoom allowed.
 * - `ScreenshotSheet`: the screenshot as an unstamped document (radius 4, the sheet elevation), for
 *   the desktop stage beside a building question or the form.
 */
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { FlowImage } from "@/hooks/use-check-flow";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

export function ScreenshotThumb({ image, onView, className }: { image: FlowImage; onView: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onView}
      aria-label={COPY["read.view"]}
      data-slot="screenshot-thumb"
      className={cn(
        "h-24 w-14 shrink-0 overflow-hidden rounded-sm bg-muted shadow-sheet outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {/* A local object URL of the person's own screenshot; next/image cannot load it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt="" width={56} height={96} className="size-full object-cover object-top" />
    </button>
  );
}

export function ScreenshotSheet({ image, className }: { image: FlowImage; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-sm bg-[#F6F7F4] shadow-sheet", className)} data-slot="screenshot-sheet">
      {/* A local object URL of the person's own screenshot; next/image cannot load it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={COPY["read.thumb"]} className="block max-h-[calc(100dvh-160px)] w-full object-contain object-top" />
    </div>
  );
}

export function ScreenshotDialog({
  image,
  open,
  onOpenChange,
}: {
  image: FlowImage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open && image !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] max-w-none overflow-y-auto p-3 pt-14 sm:max-w-none">
        <DialogTitle className="sr-only">{COPY["read.view"]}</DialogTitle>
        {image ? (
          // A local object URL of the person's own screenshot.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url} alt={COPY["read.thumb"]} className="h-auto w-full rounded-sm" />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
