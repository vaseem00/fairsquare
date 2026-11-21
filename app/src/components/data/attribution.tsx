"use client";

/**
 * The data attribution (REAL_DATA.md section 9): "Source: Dubai Land Department sales transactions,
 * published as open data on Data.Dubai and used under the Dubai Open Data Licence." The dataset and
 * licence names link to the loaded manifest's `datasetUrl` and `licenceUrl`. Before any data is
 * loaded there is no manifest, so both names are plain text. Text only: no logos anywhere.
 * - `AttributionText` takes the source as a prop (server pages pass `config.data.source`).
 * - `Attribution` reads it from the public config (client trees, the footer, provenance).
 */
import { usePublicConfig } from "@/components/shell/config-provider";
import { attributionParts } from "@/lib/copy";
import type { DataStatusView } from "@/lib/types";
import { cn } from "@/lib/utils";

const LINK = "font-medium text-primary underline underline-offset-4";

function SourceLink({ href, children }: { href: string | null; children: string }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} rel="noopener noreferrer" className={LINK}>
      {children}
    </a>
  );
}

export function AttributionText({
  source,
  className,
}: {
  source: DataStatusView["source"];
  className?: string;
}) {
  const p = attributionParts();
  return (
    <span data-slot="attribution" className={cn(className)}>
      {p.before}
      <SourceLink href={source?.url ?? null}>{p.dataset}</SourceLink>
      {p.between}
      <SourceLink href={source?.licenceUrl ?? null}>{p.licence}</SourceLink>
      {p.after}
    </span>
  );
}

export function Attribution({ className }: { className?: string }) {
  const { data } = usePublicConfig();
  return <AttributionText source={data.source} className={className} />;
}
