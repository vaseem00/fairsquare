import type { Metadata } from "next";
import { SavedView } from "@/components/saved/saved-view";
import { COPY } from "@/lib/copy";

export const metadata: Metadata = {
  title: COPY["saved.h1"],
  robots: { index: false, follow: false },
};

/**
 * /saved (DESIGN.md section 3.6). `?recovery=failed` comes from an invalid recovery link (A§4.3);
 * `?recovery=confirm&token=…` from a valid one opened on a browser that already has a list.
 */
export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { recovery, token } = await searchParams;
  const confirmToken = recovery === "confirm" && typeof token === "string" && token ? token : undefined;
  return <SavedView recoveryFailed={recovery === "failed"} recoveryToken={confirmToken} />;
}
