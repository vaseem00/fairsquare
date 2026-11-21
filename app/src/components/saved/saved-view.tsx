"use client";

/**
 * The /saved page body (DESIGN.md section 3.6). It reads GET /api/saved and GET /api/me (through
 * useMe); neither creates an anonymous id, so a first-time visitor sees the empty state and gets
 * no cookie.
 */
import { useEffect, useRef, useState } from "react";
import { useMe } from "@/components/shell/me-provider";
import { AdviserRequests } from "@/components/saved/adviser-requests";
import { RequestsList } from "@/components/saved/requests-list";
import { SavedList } from "@/components/saved/saved-list";
import { YourData } from "@/components/saved/your-data";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { COPY } from "@/lib/copy";
import type { SavedItemView } from "@/lib/types";

/**
 * A recovery link opened on a browser that already holds another list (GET /r/[token] never switches
 * silently): the person chooses, and only "Replace" switches, through a same-origin POST.
 */
function RecoveryConfirm({ token, onFailed }: { token: string; onFailed: () => void }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const clearQuery = () => {
    try {
      window.history.replaceState(window.history.state, "", "/saved");
    } catch {
      // not fatal: the query only re-shows this box on reload
    }
  };
  const replace = async () => {
    if (busy) return;
    setBusy(true);
    const res = await api.me.recover(token);
    if (res.ok) {
      // A full reload of /saved: the header badge, the list and every provider read the new id.
      clearQuery();
      window.location.reload();
      return;
    }
    setBusy(false);
    setOpen(false);
    clearQuery();
    onFailed();
  };
  const keep = () => {
    setOpen(false);
    clearQuery();
  };
  return (
    <div
      role="region"
      aria-labelledby="recovery-confirm-text"
      data-slot="recovery-confirm"
      className="flex flex-col gap-3 border-l-2 border-notice-foreground pl-3"
    >
      <p id="recovery-confirm-text" className="max-w-[62ch] text-[15px] leading-normal text-foreground">
        {COPY["saved.recoveryConfirm"]}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Button type="button" onClick={() => void replace()} aria-disabled={busy || undefined}>
          {COPY["saved.recoveryReplace"]}
        </Button>
        <Button type="button" variant="link" onClick={keep}>
          {COPY["saved.recoveryKeep"]}
        </Button>
      </div>
    </div>
  );
}

export function SavedView({ recoveryFailed = false, recoveryToken }: { recoveryFailed?: boolean; recoveryToken?: string }) {
  const { me, refresh } = useMe();
  const [items, setItems] = useState<SavedItemView[] | null>(null);
  const [recoverFailed, setRecoverFailed] = useState(false);
  const h1Ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    void api.saved.list().then((res) => {
      if (!live) return;
      // A failed read shows the empty list rather than a spinner forever.
      setItems(res.ok ? res.data.items : []);
    });
    return () => {
      live = false;
    };
  }, []);

  const requests = me?.requests ?? [];
  const leads = me?.leads ?? [];
  const savedCount = items?.length ?? me?.savedCount ?? 0;
  const hasData = savedCount > 0 || requests.length > 0 || leads.length > 0 || (me?.checksCount ?? 0) > 0;

  const onDeleted = () => {
    setItems([]);
    // DESIGN.md section 7.2: after "Delete all", focus goes to the Saved h1.
    setTimeout(() => h1Ref.current?.focus(), 0);
    void refresh();
  };

  return (
    <div className="mx-auto w-full max-w-[1264px] gutter pt-8 pb-16 md:pt-12 lg:pt-16">
    <div className="flex max-w-[720px] flex-col gap-12 md:gap-14 lg:ml-[calc((100%+24px)/6)]">
      <header className="flex flex-col gap-4">
        <h1 ref={h1Ref} tabIndex={-1} className="type-display-md text-foreground outline-none">
          {COPY["saved.h1"]}
        </h1>
        <p className="type-lead max-w-[52ch] text-muted-foreground">{COPY["saved.intro"]}</p>
        {recoveryToken && !recoveryFailed ? <RecoveryConfirm token={recoveryToken} onFailed={() => setRecoverFailed(true)} /> : null}
        {recoveryFailed || recoverFailed ? (
          <p role="alert" className="max-w-[62ch] border-l-2 border-notice-foreground pl-3 text-[15px] leading-normal text-foreground">
            {COPY["saved.recoveryFailed"]}
          </p>
        ) : null}
      </header>

      <SavedList items={items} />
      <RequestsList requests={requests} />
      <AdviserRequests leads={leads} />
      {hasData ? (
        <YourData
          counts={{
            checks: me?.checksCount ?? 0,
            saved: savedCount,
            requests: requests.length,
            leads: leads.length,
          }}
          onDeleted={onDeleted}
          afterDeleteFocus={h1Ref}
        />
      ) : null}
    </div>
    </div>
  );
}
