"use client";

/**
 * PublicConfig from the server (`getPublicConfig()`, A§7.1) for every client component.
 * The root layout provides it; it is the only way configuration reaches the browser.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { PublicConfig } from "@/lib/types";

const ConfigContext = createContext<PublicConfig | null>(null);

export function ConfigProvider({ value, children }: { value: PublicConfig; children: ReactNode }) {
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function usePublicConfig(): PublicConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error("usePublicConfig() needs a <ConfigProvider> (the root layout mounts one).");
  return config;
}
