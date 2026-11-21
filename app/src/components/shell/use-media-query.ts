"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Live `matchMedia(query).matches`; `serverValue` (default false) during SSR and hydration. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : serverValue),
    [query, serverValue],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
}

/** Desktop layout (two columns, Sheet instead of Drawer, inline action bar): 1024px and up. */
export const DESKTOP_QUERY = "(min-width: 1024px)";
/** Tablet and up: toasts move from top-centre to bottom-right. */
export const TABLET_QUERY = "(min-width: 768px)";
