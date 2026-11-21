"use client";

/**
 * One channel per message (DESIGN.md section 7.1). Sonner's toaster is an aria-live region, so a
 * toast plus `announce()` of the same text is spoken twice. These confirmations are announced once
 * through the app's own live region (`useAnnounce`); the toast is the visual copy only.
 */
import { toast } from "sonner";

/** A success toast for sighted people; pair it with `announce(message)` for screen readers. */
export function visualToast(message: string): void {
  toast.success(
    <span aria-hidden="true" data-slot="visual-toast">
      {message}
    </span>,
  );
}
