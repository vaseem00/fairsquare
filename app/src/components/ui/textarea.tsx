import * as React from "react"
import { cn } from "@/lib/utils"

/* The same field as Input (docs/REDESIGN.md section 4): --card fill, 1px --input, 16px text, 2px ink focus ring. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base text-foreground transition-colors duration-(--dur-fast) outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
