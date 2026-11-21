"use client";

/**
 * The home page's screenshot entry points (docs/REDESIGN.md sections 8.3 and 7.6).
 * - `useScreenshotDrop`: dragging an image anywhere over the window sets `dragging` (enter and leave
 *   are counted, so it does not flicker); dropping anywhere reads the file; pasting an image anywhere
 *   outside a field reads it too. Only drags that carry files count.
 * - `ChooseButton`: "Add a screenshot", the one primary action. The parent owns the visually hidden
 *   `<input type="file" accept="image/*">` it opens. Choosing a file starts reading at once.
 * - `KeptScreenshot`: after Stop, the screenshot is kept: a 64 x 112 thumbnail (phones; on desktop
 *   the screenshot stands on the balance's left pan instead), "Reading stopped. Your screenshot is
 *   still here.", then [Try again], Replace_ and Remove screenshot_.
 * No icons in buttons, no Kbd chips.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { FlowImage } from "@/hooks/use-check-flow";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

/** The first image file in a DataTransfer (drop or paste), if any. */
export function imageFromTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** True when a drag carries files (a text selection dragged inside the page does not count). */
function carriesFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = dt.types as ArrayLike<string> | undefined;
  return !types || Array.from(types).includes("Files");
}

export function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/**
 * Window-level drop and document-level paste of a screenshot while `enabled`. Returns whether an
 * image is being dragged over the page.
 */
export function useScreenshotDrop(onFile: (file: File) => void, enabled: boolean): boolean {
  const [dragging, setDragging] = useState(false);
  const onFileRef = useRef(onFile);
  useEffect(() => {
    onFileRef.current = onFile;
  });

  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      const file = imageFromTransfer(e.dataTransfer);
      if (!file) return;
      e.preventDefault();
      onFileRef.current(file);
    };
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromTransfer(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      onFileRef.current(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      document.removeEventListener("paste", onPaste);
      setDragging(false);
    };
  }, [enabled]);

  return enabled && dragging;
}

export function ChooseButton({ onChoose, className }: { onChoose: () => void; className?: string }) {
  return (
    <Button type="button" size="lg" onClick={onChoose} className={cn("w-full sm:w-auto", className)} data-slot="choose-screenshot">
      {COPY["home.choose"]}
    </Button>
  );
}

export interface KeptScreenshotProps {
  /** The kept screenshot; null for pasted text that was read (Continue only). */
  image: FlowImage | null;
  /**
   * Back left the scene after the read had finished: "Your screenshot is still here." and [Continue]
   * (back to the question or the comparison, nothing read again), instead of "Reading stopped." and
   * [Try again] (read it again).
   */
  resumable?: boolean;
  /** Opens the parent's file input. */
  onChoose?: () => void;
  onRetry: () => void;
  onRemove: () => void;
  className?: string;
}

export function KeptScreenshot({ image, resumable = false, onChoose, onRetry, onRemove, className }: KeptScreenshotProps) {
  const note = resumable ? COPY[image ? "scene.kept" : "scene.keptText"] : COPY["read.stopped"];
  return (
    <div data-slot="kept-screenshot" data-resumable={resumable || undefined} className={cn("flex items-start gap-4", className)}>
      {image ? (
        <>
          {/* A local object URL of the person's own screenshot; next/image cannot load it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={COPY["read.thumb"]}
            width={64}
            height={112}
            className="h-28 w-16 shrink-0 rounded-sm object-cover object-top shadow-sheet lg:hidden"
          />
        </>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="text-caption text-muted-foreground">{note}</p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <Button type="button" size="lg" onClick={onRetry} className="w-full sm:w-auto" data-action="retry">
            {resumable ? COPY["ask.continue"] : COPY["alert.tryAgain"]}
          </Button>
          {image && onChoose ? (
            <Button type="button" variant="link" onClick={onChoose}>
              {COPY["read.replace"]}
            </Button>
          ) : null}
          {image ? (
            <Button type="button" variant="link" onClick={onRemove}>
              {COPY["read.remove"]}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
