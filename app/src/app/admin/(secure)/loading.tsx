import { Skeleton } from "@/components/ui/skeleton";

/** Admin pages while their data loads: a heading line, a KPI row and a table block. */
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
