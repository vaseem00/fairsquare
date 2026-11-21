import { Skeleton } from "@/components/ui/skeleton";

/** The Saved placeholder in the page's own layout: headline, intro and two rows. Still, no pulse. */
export default function SavedLoading() {
  return (
    <div className="mx-auto w-full max-w-[1264px] gutter pt-8 pb-16 md:pt-12 lg:pt-16" aria-hidden="true">
      <div className="flex max-w-[720px] flex-col gap-12 lg:ml-[calc((100%+24px)/6)]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9 w-40 lg:h-11" />
          <Skeleton className="h-5 w-full max-w-md" />
          <Skeleton className="h-5 w-2/3 max-w-sm" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-7 w-32" />
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2 border-t border-border py-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-2 h-11 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
