"use client";

/**
 * The person's MeView (GET /api/me) for the header badge, Saved and the money UI.
 * GET /api/me never creates an anonymous id, so mounting this on every page is safe (A§4.3).
 * It loads on mount and again when the tab becomes visible; `refresh()` reloads it after a change.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api/client";
import type { MeView } from "@/lib/types";

export interface MeContextValue {
  me: MeView | null;
  refresh(): Promise<void>;
}

const NOOP: MeContextValue = { me: null, refresh: async () => undefined };
const MeContext = createContext<MeContextValue | null>(null);

export function MeProvider({ children, initial = null }: { children: ReactNode; initial?: MeView | null }) {
  const [me, setMe] = useState<MeView | null>(initial);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    const res = await api.me.get();
    // A slower, older response never overwrites a newer one.
    if (mine === seq.current && res.ok) setMe(res.data);
  }, []);

  useEffect(() => {
    // Initial load after mount (external data), then reload when the tab comes back into view.
    void Promise.resolve().then(refresh);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const value = useMemo(() => ({ me, refresh }), [me, refresh]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

/** `{ me, refresh }`. Outside a MeProvider it returns `{ me: null }` and a no-op refresh. */
export function useMe(): MeContextValue {
  return useContext(MeContext) ?? NOOP;
}
