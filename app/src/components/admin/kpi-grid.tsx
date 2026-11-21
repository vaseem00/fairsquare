"use client";

/**
 * Overview KPIs (DESIGN.md section 3.8): a definition-list grid separated by hairlines, not boxed
 * cards. Each value runs the number-ticker once on load; under reduced motion it shows the final
 * value at once. Screen readers get the final value, never the counting.
 */
import { useReducedMotion } from "motion/react";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { formatInt } from "@/lib/format";

export interface Kpi {
  label: string;
  value: number;
}

function KpiValue({ value }: { value: number }) {
  const reduce = useReducedMotion();
  return (
    <>
      <span className="sr-only">{formatInt(value)}</span>
      {reduce || value === 0 ? (
        <span aria-hidden="true">{formatInt(value)}</span>
      ) : (
        <NumberTicker aria-hidden="true" value={value} className="tracking-normal text-foreground dark:text-foreground" />
      )}
    </>
  );
}

export function KpiGrid({ items, label }: { items: Kpi[]; label: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
    <dl
      aria-label={label}
      className="-mr-px -mb-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
    >
      {items.map((k) => (
        <div key={k.label} className="flex flex-col gap-1 border-r border-b border-border px-4 py-3">
          <dt className="text-caption text-muted-foreground">{k.label}</dt>
          <dd className="num text-heading font-semibold wdth-figure">
            <KpiValue value={k.value} />
          </dd>
        </div>
      ))}
    </dl>
    </div>
  );
}
