"use client";

/**
 * The Listings section of /saved (DESIGN.md section 3.6, A§0.2).
 * - "Open" calls POST /api/saved/[code]/seen, then goes to /c/<code> (the original code).
 * - Remove (in the overflow menu) soft-deletes on the server and collapses the item into the inline
 *   row "Removed {building}. Undo", with focus on Undo. Undo saves the same code again, which
 *   restores the original "Saved {date}" baseline exactly.
 * - The row stays for 10 seconds after the person leaves it: while the pointer is over it or focus is
 *   inside it the timer is paused, so nobody loses the Undo while reading it (WCAG 2.2.1).
 * - When the row times out, focus moves to the next item, or to the Listings h2.
 * - A failed Remove or Undo is shown on the row itself (role=alert), not only in a toast.
 */
import { useRouter } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { useAnnounce } from "@/components/a11y/live-region";
import { useMe } from "@/components/shell/me-provider";
import { SavedItem } from "@/components/saved/saved-item";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { buildingLabel, COPY, t } from "@/lib/copy";
import type { SavedItemView } from "@/lib/types";
import Link from "next/link";

/** How long the inline Undo row stays (DESIGN.md section 3.6). */
export const UNDO_MS = 10_000;

type Row = { kind: "item"; item: SavedItemView } | { kind: "removed"; item: SavedItemView };

function RemovedRow({
  item,
  undoRef,
  busy,
  error,
  onUndo,
  onHold,
}: {
  item: SavedItemView;
  undoRef: (el: HTMLButtonElement | null) => void;
  busy: boolean;
  /** A failed Undo, shown here (never only in a toast, D§7.1). */
  error?: string | null;
  onUndo(): void;
  /** Pointer over or focus inside the row pauses the Undo timer; leaving it restarts it (WCAG 2.2.1). */
  onHold(kind: "hover" | "focus", on: boolean): void;
}) {
  return (
    <div
      className="flex flex-col gap-2 py-3 text-body"
      data-slot="saved-removed"
      data-code={item.code}
      onMouseEnter={() => onHold("hover", true)}
      onMouseLeave={() => onHold("hover", false)}
      onFocus={() => onHold("focus", true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHold("focus", false);
      }}
    >
      <div className="flex min-h-10 items-center gap-3">
        <p className="flex-1 text-foreground">{t("saved.removed", { building: buildingLabel(item) })}</p>
        <Button ref={undoRef} type="button" variant="link" onClick={onUndo} aria-disabled={busy || undefined}>
          {COPY["saved.undo"]}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-caption text-destructive" data-slot="saved-item-error">
          <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SavedEmpty() {
  return (
    <div className="flex flex-col items-start gap-5 border-t border-border pt-6" data-slot="saved-empty">
      <div className="flex flex-col gap-2">
        <h3 className="type-title text-foreground">{COPY["saved.emptyH"]}</h3>
        <p className="type-lead max-w-[44ch] text-muted-foreground">{COPY["saved.emptyBody"]}</p>
      </div>
      <Link href="/" className={buttonVariants({ size: "lg" })}>
        {COPY["saved.emptyCta"]}
      </Link>
    </div>
  );
}

export function SavedList({
  items: initialItems,
  loading,
  headingRef,
}: {
  /** null while loading. */
  items: SavedItemView[] | null;
  loading?: boolean;
  headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const { refresh } = useMe();
  const headingId = useId();
  const ownHeading = useRef<HTMLHeadingElement>(null);
  const h2 = headingRef ?? ownHeading;
  const [rows, setRows] = useState<Row[]>(() => (initialItems ?? []).map((item) => ({ kind: "item", item })));
  const [syncedFrom, setSyncedFrom] = useState(initialItems);
  const [opening, setOpening] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Removed rows whose removal the server confirmed (their Undo timer may run). */
  const confirmed = useRef(new Set<string>());
  /** Why a row's timer is paused: the pointer is over it, or focus is inside it. */
  const holds = useRef(new Map<string, { hover: boolean; focus: boolean }>());
  const setError = (code: string, message: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[code] = message;
      else delete next[code];
      return next;
    });
  const openRefs = useRef(new Map<string, HTMLButtonElement>());
  const undoRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);

  // New data from the page (first load, or after Delete all): adopt it.
  if (initialItems !== syncedFrom) {
    setSyncedFrom(initialItems);
    setRows((initialItems ?? []).map((item) => ({ kind: "item", item })));
  }

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const id of all.values()) clearTimeout(id);
      all.clear();
    };
  }, []);

  // Focus the Undo button of a row that was just collapsed.
  useEffect(() => {
    const code = pendingFocus.current;
    if (!code) return;
    pendingFocus.current = null;
    undoRefs.current.get(code)?.focus();
  });

  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });

  const expire = useCallback(
    (code: string) => {
      timers.current.delete(code);
      confirmed.current.delete(code);
      holds.current.delete(code);
      const prev = rowsRef.current;
      const idx = prev.findIndex((r) => r.item.code === code && r.kind === "removed");
      if (idx < 0) return;
      const next = prev.filter((_, i) => i !== idx);
      const undoButton = undoRefs.current.get(code);
      const active = document.activeElement;
      const hadFocus = !active || active === document.body || active === undoButton;
      setRows((p) => p.filter((r) => !(r.item.code === code && r.kind === "removed")));
      if (!hadFocus) return;
      const following = next.slice(idx).find((r) => r.kind === "item");
      setTimeout(() => {
        const target = following ? openRefs.current.get(following.item.code) : null;
        (target ?? h2.current)?.focus();
      }, 0);
    },
    [h2],
  );

  const startTimer = (code: string) => {
    const old = timers.current.get(code);
    if (old) clearTimeout(old);
    timers.current.set(
      code,
      setTimeout(() => expire(code), UNDO_MS),
    );
  };
  const stopTimer = (code: string) => {
    const old = timers.current.get(code);
    if (old) clearTimeout(old);
    timers.current.delete(code);
  };
  const isHeld = (code: string) => {
    const h = holds.current.get(code);
    return Boolean(h && (h.hover || h.focus));
  };
  /** The Undo row waits while the person is on it, and gets its full time again once they leave. */
  const hold = (code: string, kind: "hover" | "focus", on: boolean) => {
    const h = holds.current.get(code) ?? { hover: false, focus: false };
    h[kind] = on;
    holds.current.set(code, h);
    if (!confirmed.current.has(code)) return;
    if (isHeld(code)) stopTimer(code);
    else if (!timers.current.has(code)) startTimer(code);
  };

  const remove = async (item: SavedItemView) => {
    setError(item.code, null);
    setRows((prev) => prev.map((r) => (r.item.code === item.code ? { kind: "removed", item } : r)));
    pendingFocus.current = item.code;
    announce(t("saved.removed", { building: buildingLabel(item) }));
    const res = await api.saved.remove(item.code);
    if (!res.ok) {
      setRows((prev) => prev.map((r) => (r.item.code === item.code ? { kind: "item", item } : r)));
      // Shown on the item itself (role=alert), not only in a 4-second toast.
      setError(item.code, res.error.message);
      setTimeout(() => openRefs.current.get(item.code)?.focus(), 0);
      return;
    }
    confirmed.current.add(item.code);
    if (!isHeld(item.code)) startTimer(item.code);
    void refresh();
  };

  const undo = async (item: SavedItemView) => {
    if (undoing) return;
    setUndoing(item.code);
    const res = await api.saved.add(item.code);
    setUndoing(null);
    if (!res.ok) {
      setError(item.code, res.error.message);
      return;
    }
    setError(item.code, null);
    stopTimer(item.code);
    confirmed.current.delete(item.code);
    holds.current.delete(item.code);
    const restored = res.data.item;
    setRows((prev) => prev.map((r) => (r.item.code === item.code ? { kind: "item", item: restored } : r)));
    setTimeout(() => openRefs.current.get(item.code)?.focus(), 0);
    void refresh();
  };

  const open = async (item: SavedItemView) => {
    if (opening) return;
    setOpening(item.code);
    // Clear the header badge for this listing first; navigate even if that fails.
    await api.saved.markSeen(item.code);
    void refresh();
    router.push(`/c/${item.code}`);
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <h2 id={headingId} ref={h2} tabIndex={-1} className="mb-4 type-heading text-foreground outline-none">
        {COPY["saved.listingsH2"]}
      </h2>
      {loading || initialItems === null ? (
        <div className="flex flex-col gap-3 border-t border-border py-6" aria-hidden="true">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : rows.length === 0 ? (
        <SavedEmpty />
      ) : (
        <ul className="flex flex-col border-b border-border">
          {rows.map((row) => (
            <li key={row.item.code} className="border-t border-border">
              {row.kind === "item" ? (
                <SavedItem
                  item={row.item}
                  opening={opening === row.item.code}
                  onOpen={open}
                  onRemove={remove}
                  error={errors[row.item.code] ?? null}
                  openRef={(el) => {
                    if (el) openRefs.current.set(row.item.code, el);
                    else openRefs.current.delete(row.item.code);
                  }}
                />
              ) : (
                <RemovedRow
                  item={row.item}
                  busy={undoing === row.item.code}
                  error={errors[row.item.code] ?? null}
                  onUndo={() => undo(row.item)}
                  onHold={(kind, on) => hold(row.item.code, kind, on)}
                  undoRef={(el) => {
                    if (el) undoRefs.current.set(row.item.code, el);
                    else undoRefs.current.delete(row.item.code);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
