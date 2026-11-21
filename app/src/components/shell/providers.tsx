"use client";

/**
 * Client providers mounted once by the root layout (DESIGN.md section 3.0):
 * next-themes (class attribute, system default, CSP nonce), PublicConfig, MotionConfig with
 * reduced motion from the OS, MeProvider, the live regions and the responsive Sonner toaster.
 */
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { LiveRegion } from "@/components/a11y/live-region";
import { ConfigProvider } from "@/components/shell/config-provider";
import { MeProvider } from "@/components/shell/me-provider";
import { TABLET_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { Toaster } from "@/components/ui/sonner";
import type { PublicConfig } from "@/lib/types";

/** Toasts sit top-centre below 768px (never over the action bar) and bottom-right above; 4 s. */
export function AppToaster() {
  const wide = useMediaQuery(TABLET_QUERY);
  return <Toaster position={wide ? "bottom-right" : "top-center"} duration={4000} richColors={false} />;
}

export function Providers({
  config,
  nonce,
  children,
}: {
  config: PublicConfig;
  nonce?: string;
  children: ReactNode;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      <ConfigProvider value={config}>
        <MotionConfig reducedMotion="user">
          <MeProvider>
            {children}
            <LiveRegion />
            <AppToaster />
          </MeProvider>
        </MotionConfig>
      </ConfigProvider>
    </ThemeProvider>
  );
}
