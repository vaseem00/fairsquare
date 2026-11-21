"use client";

/**
 * "Save and track" (DESIGN.md sections 3.4 and 6.6, A§0.2).
 * Tap: POST /api/saved, then the button becomes "Tracking" with a check and the polite
 * region announces `save.announce`. Once saved it is a link to /saved of the same size, so tapping
 * it again never removes anything (removal lives on the Saved page only). It refreshes useMe().
 * Not rendered for not-covered comparisons. A failed save shows its message under
 * the button (role=alert, described-by) until the next try.
 */
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useAnnounce } from "@/components/a11y/live-region";
import { useMe } from "@/components/shell/me-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/client";
import { buildingLabel, COPY, plainNotCovered, t } from "@/lib/copy";
import type { CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Codes saved in this tab, so a result reopened in the same session shows "Tracking" at once. */
const savedCodes = new Set<string>();

export function SaveButton({
  check,
  variant = "outline",
  className,
}: {
  check: CheckView;
  variant?: "default" | "outline";
  className?: string;
}) {
  const { me, refresh } = useMe();
  const announce = useAnnounce();
  const [saved, setSaved] = useState(() => savedCodes.has(check.code));
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const linkRef = useRef<HTMLAnchorElement>(null);
  const hidden = plainNotCovered(check);
  const hasSaved = (me?.savedCount ?? 0) > 0;

  // A result opened again (for example /c from Saved) may already be tracked.
  useEffect(() => {
    if (hidden || saved || !hasSaved) return;
    let live = true;
    void api.saved.list().then((res) => {
      if (live && res.ok && res.data.items.some((i) => i.code === check.code)) {
        savedCodes.add(check.code);
        setSaved(true);
      }
    });
    return () => {
      live = false;
    };
  }, [hidden, saved, hasSaved, check.code]);

  // Saving swaps the button for a link: keep keyboard focus on it.
  useEffect(() => {
    if (justSaved) linkRef.current?.focus();
  }, [justSaved]);

  if (hidden) return null;

  const classes = cn(buttonVariants({ variant }), "gap-2", className);

  if (saved) {
    return (
      <Link ref={linkRef} href="/saved" className={classes} data-slot="save-button" data-state="saved">
        <CheckIcon aria-hidden="true" strokeWidth={1.75} />
        {COPY["save.done"]}
      </Link>
    );
  }

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await api.saved.add(check.code);
    setBusy(false);
    if (!res.ok) {
      // Next to the button until the next try, never only in a 4-second toast (D§7.1).
      setError(res.error.message);
      return;
    }
    savedCodes.add(check.code);
    setSaved(true);
    setJustSaved(true);
    announce(t("save.announce", { building: buildingLabel(check) }));
    void refresh();
  };

  const button = (
    <Button
      type="button"
      variant={variant}
      className={cn("gap-2", error && "w-full", className)}
      onClick={save}
      aria-disabled={busy || undefined}
      aria-describedby={error ? errorId : undefined}
      data-slot="save-button"
    >
      {busy ? <Spinner className="size-5" /> : null}
      {COPY["save.cta"]}
    </Button>
  );
  if (!error) return button;
  return (
    <div className="flex flex-col gap-1" data-slot="save-button-wrap">
      {button}
      <p id={errorId} role="alert" className="flex items-start gap-1.5 text-caption text-destructive">
        <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
        {error}
      </p>
    </div>
  );
}

/** Tests: forget codes saved in this tab. */
export function __resetSavedCodesForTests(): void {
  savedCodes.clear();
}
