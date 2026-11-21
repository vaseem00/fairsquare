import { cn } from "@/lib/utils"

/* A static placeholder block (docs/REDESIGN.md section 5.3: no skeleton pulse anywhere). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-sm bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
