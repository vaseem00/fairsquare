import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/*
 * Buttons per docs/REDESIGN.md section 4 (Archivo 16/500, no icons on public pages):
 * - default (primary): ink fill; `lg` is the one primary action of a screen, 52px on phones and
 *   48px from 768px, padding 0 24px. Pressed: --primary-hover, never a scale.
 * - outline (secondary): a 1px --input outline on transparent, the same heights.
 * - link (tertiary): an underlined text button, 44px hit area, 1px underline (2px on hover), offset 4.
 * Focus is a 2px ink ring with a 2px background-coloured offset, so it shows as a separate ring even
 * on an ink (or red) fill. Control boundaries use --input (3:1 or more), never the decorative --border.
 */
const buttonCva = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-base font-medium whitespace-nowrap transition-[color,background-color,border-color,text-decoration-thickness] duration-(--dur-fast) outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:duration-(--dur-press) disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
        outline:
          "border-input bg-transparent text-foreground hover:bg-accent active:bg-accent aria-expanded:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent active:bg-accent aria-expanded:bg-accent",
        ghost: "text-foreground hover:bg-accent active:bg-accent aria-expanded:bg-accent",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive",
        "destructive-outline":
          "border-destructive bg-transparent text-destructive hover:bg-destructive/10 focus-visible:ring-destructive",
        link: "rounded-sm text-foreground underline decoration-1 underline-offset-4 hover:decoration-2",
      },
      size: {
        default:
          "h-11 gap-2 px-4 md:h-10 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-8 gap-1 px-2.5 text-sm pointer-coarse:min-h-11 [&_svg:not([class*='size-'])]:size-4",
        sm: "h-9 gap-1.5 px-3 text-sm pointer-coarse:min-h-11 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-13 gap-2 px-6 md:h-12",
        chip: "min-h-11 gap-2 rounded-full px-4",
        icon: "size-11",
        "icon-xs": "size-8 pointer-coarse:size-11 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-9 pointer-coarse:size-11 [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-12",
      },
    },
    compoundVariants: [
      // A text button keeps a 44px hit area but no box: the words and the underline are the control.
      { variant: "link", class: "h-auto min-h-11 px-0 py-0 md:h-auto whitespace-normal text-left" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * The button classes with conflicts resolved (a text button's `h-auto` over the size's `h-11`), so
 * links styled as buttons (`<Link className={buttonVariants(...)}>`) match real buttons.
 */
function buttonVariants(props?: Parameters<typeof buttonCva>[0]): string {
  return cn(buttonCva(props))
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonCva>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
