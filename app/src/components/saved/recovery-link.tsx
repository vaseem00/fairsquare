"use client";

/**
 * "Copy recovery link" (DESIGN.md section 3.6, A§4.3): POST /api/me/recovery-link, then copy the
 * signed link, for people moving from WhatsApp's in-app browser to Safari or Chrome.
 * If the clipboard is blocked, the link stays visible in a read-only field with `error.clipboard`.
 */
import { useId, useState } from "react";
import { useAnnounce } from "@/components/a11y/live-region";
import { visualToast } from "@/components/a11y/visual-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/client";
import { COPY } from "@/lib/copy";

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function RecoveryLink() {
  const announce = useAnnounce();
  const [busy, setBusy] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = { field: useId(), err: useId() };

  const copy = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await api.me.recoveryLink();
    if (!res.ok) {
      setBusy(false);
      // Next to the button until the next try, not only in a toast (D§7.1).
      setError(res.error.message);
      return;
    }
    const ok = await copyText(res.data.url);
    setBusy(false);
    if (ok) {
      setFallbackUrl(null);
      visualToast(COPY["saved.recoveryDone"]);
      announce(COPY["saved.recoveryDone"]);
      api.track("recovery_link_copied");
    } else {
      setFallbackUrl(res.data.url);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-slot="recovery-link">
      <p className="max-w-[62ch] text-body text-foreground">{COPY["saved.recoveryIntro"]}</p>
      <Button type="button" variant="outline" onClick={copy} aria-disabled={busy || undefined} className="w-fit">
        {busy ? <Spinner /> : null}
        {COPY["saved.recoveryCta"]}
      </Button>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
      {fallbackUrl ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={ids.field} className="sr-only">
            {COPY["saved.recoveryCta"]}
          </label>
          <Input
            id={ids.field}
            readOnly
            value={fallbackUrl}
            onFocus={(e) => e.currentTarget.select()}
            aria-describedby={ids.err}
          />
          <p id={ids.err} role="alert" className="text-caption text-foreground">
            {COPY["error.clipboard"]}
          </p>
        </div>
      ) : null}
    </div>
  );
}
