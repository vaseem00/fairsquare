/**
 * Root layout (DESIGN.md section 3.0, A§6.6).
 * The nonce CSP (WP1's proxy) needs every page rendered per request: the layout reads the nonce
 * with headers() and passes it to next-themes, so this segment is allowed to block
 * (`instant = false`) and no static shell is prerendered without the nonce.
 */
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { RouteFocus } from "@/components/a11y/route-focus";
import { SkipLink } from "@/components/a11y/skip-link";
import { Footer } from "@/components/shell/footer";
import { Header } from "@/components/shell/header";
import { Providers } from "@/components/shell/providers";
import { getPublicConfig } from "@/lib/config";
import { COPY } from "@/lib/copy";
import { getEnv } from "@/lib/env";
import { archivo, newsreader } from "./fonts";
import "./globals.css";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  // APP_URL comes from the environment (A§0.2), so metadata is request-time only: connection()
  // first keeps `next build` from reading the environment (it needs no secrets, A§7.1).
  await connection();
  return {
    metadataBase: new URL(getEnv().APP_URL),
    title: { default: COPY["app.name"], template: `%s | ${COPY["app.name"]}` },
    description: COPY["app.description"],
    applicationName: COPY["app.name"],
    openGraph: { siteName: COPY["app.name"], type: "website", locale: "en_AE" },
    formatDetection: { telephone: false },
  };
}

// No maximum-scale and no user-scalable=no: people must be able to zoom (DESIGN.md section 7.1).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F4F0" },
    { media: "(prefers-color-scheme: dark)", color: "#121317" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // getPublicConfig() reads the extraction circuit breaker (the clock) and the loaded data's status
  // (database): request time only.
  await connection();
  const config = await getPublicConfig();
  return (
    <html lang="en" className={`${archivo.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col bg-background pb-[calc(var(--action-bar-h)+env(safe-area-inset-bottom))] font-sans text-foreground antialiased">
        <SkipLink />
        <Providers config={config} nonce={nonce}>
          <Header />
          <main id="main" tabIndex={-1} className="flex w-full flex-1 flex-col outline-none">
            {children}
          </main>
          <Footer />
          {/* D§7.2: a client route change moves focus to the new page's h1. */}
          <RouteFocus />
        </Providers>
      </body>
    </html>
  );
}
