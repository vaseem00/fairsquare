"use client";

/**
 * The 7 / 30 / 90-day range control (DESIGN.md section 3.8), a ToggleGroup that writes `?range=` so
 * the server page re-reads the numbers. Shared by Overview and Quality.
 */
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { COPY, tList } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { ADMIN_RANGES, type AdminRange } from "@/lib/validation/admin";

const LABELS = tList("admin.range");

export function RangeToggle({ range, className }: { range: AdminRange; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return (
    <ToggleGroup
      aria-label={COPY["adminUi.rangeLabel"]}
      variant="outline"
      spacing={0}
      value={[String(range)]}
      onValueChange={(v) => {
        const next = v[0];
        if (!next || next === String(range)) return;
        startTransition(() => router.push(`${pathname}?range=${next}`, { scroll: false }));
      }}
      className={cn(pending && "opacity-70", className)}
      aria-busy={pending || undefined}
    >
      {ADMIN_RANGES.map((r, i) => (
        <ToggleGroupItem key={r} value={String(r)} className="h-10 px-3 text-sm">
          {LABELS[i]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
