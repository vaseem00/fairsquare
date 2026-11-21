import { Skeleton } from "@/components/ui/skeleton";

/** The Coverage placeholder in the page's own layout: headline, lead, search and three rows. Still, no pulse. */
export default function CoverageLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1264px] flex-col gap-10 gutter pt-8 pb-16 md:pt-12 lg:pt-16" aria-hidden="true">
      <div className="flex flex-col gap-4 lg:max-w-[58%]">
        <Skeleton className="h-9 w-3/4 max-w-md lg:h-11" />
        <Skeleton className="h-5 w-full max-w-xl" />
        <Skeleton className="h-4 w-1/2 max-w-xs" />
      </div>
      <Skeleton className="h-12 w-full max-w-md" />
      <div className="flex flex-col">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2 border-t border-border py-5">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
