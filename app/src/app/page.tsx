/**
 * "/" — the compare flow (DESIGN.md sections 3.1–3.4, A§4.5). The flow itself is a client component;
 * steps 2 and 3 live in the URL (`?step=details`, `?step=result&code=`), pushed on the client.
 * A request for a result URL is always a reload or a shared link, so the screenshot cannot be in
 * memory: it goes straight to the stored comparison at `/c/<code>`. `?ref=CODE` (from a share page)
 * is handed to the flow, which keeps it and sends it with the comparison.
 * The "From the data" panel (REAL_DATA.md section 10) is computed here on the server (kept for an
 * hour) and streams into the flow's step 1 slot, so the hero never waits for it.
 */
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CompareFlow } from "@/components/check/compare-flow";
import { FromTheDataPanel, FromTheDataSkeleton } from "@/components/home/from-the-data";
import { getDataStatus } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { dubaiToday } from "@/lib/domain/dates";
import { normaliseCode } from "@/lib/domain/share-code";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { getFromTheData } from "@/lib/services/from-the-data";

/**
 * The page reads the search params per request (redirect or `ref`), like the root layout reads the
 * CSP nonce, so it is allowed to block: there is no static shell to validate here.
 */
export const instant = false;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** The panel's numbers from the loaded sales. A database error shows the panel without them. */
async function FromTheDataSlot() {
  const db = getDb();
  const today = dubaiToday();
  const [status, data] = await Promise.all([
    getDataStatus(db, today),
    getFromTheData(db, today, getEnv().rules).catch((err: unknown) => {
      log.warn("from_the_data_failed", { err });
      return null;
    }),
  ]);
  return <FromTheDataPanel data={data} status={status} />;
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  // Per request: the search params decide between the flow and a redirect.
  await connection();
  const sp = await searchParams;
  const code = normaliseCode(first(sp.code));
  if (first(sp.step) === "result" && code) redirect(`/c/${code}`);
  return (
    <CompareFlow
      initialRef={normaliseCode(first(sp.ref))}
      fromTheData={
        <Suspense fallback={<FromTheDataSkeleton />}>
          <FromTheDataSlot />
        </Suspense>
      }
    />
  );
}
