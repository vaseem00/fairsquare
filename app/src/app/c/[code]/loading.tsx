import { Skeleton } from "@/components/ui/skeleton";

/** The /c placeholder in the page's own layout: the caption, the headline, the plate, three lines. Still, no pulse. */
export default function SharePageLoading() {
  return (
    <div className="mx-auto w-full max-w-[1264px] gutter pt-6 pb-12 md:pt-10 lg:pt-14" aria-hidden="true">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-x-6">
        <div className="flex flex-col gap-4 lg:col-span-6">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="h-10 w-3/4 max-w-sm lg:h-16" />
          <div className="mt-4 flex flex-col gap-3 max-lg:hidden">
            <Skeleton className="h-5 w-full max-w-[52ch]" />
            <Skeleton className="h-5 w-5/6 max-w-[48ch]" />
            <Skeleton className="h-5 w-2/3 max-w-[40ch]" />
          </div>
        </div>
        <div className="lg:col-span-6 lg:col-start-7">
          <Skeleton className="aspect-[1080/1000] w-full rounded-sm lg:mx-auto lg:max-w-[480px]" />
        </div>
        <div className="flex flex-col gap-3 lg:hidden">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      </div>
    </div>
  );
}
