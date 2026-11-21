/**
 * The Fairsquare mark and wordmark (docs/REDESIGN.md section 2.5).
 * - Mark: unchanged, the indigo stamp miniature with the balance inside (1.75px strokes on a 32 grid).
 * - "Fairsquare": Newsreader 600, 22px, line-height 1, -0.01em, in ink. English only: there is no
 *   Arabic name next to it.
 */
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

/** The balance-scale mark in `--stamp` ink. Decorative: the brand link carries the name. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0 text-stamp", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1" y="1" width="30" height="30" rx="6" strokeWidth="2" />
      <rect x="4" y="4" width="24" height="24" rx="4" strokeWidth="1" />
      <g strokeWidth="1.75">
        <path d="M16 8.5v14" />
        <path d="M12 22.5h8" />
        <path d="M9 11h14" />
        <path d="M9 11l-2.5 6M9 11l2.5 6M23 11l-2.5 6M23 11l2.5 6" />
        <path d="M6 17a3 3 0 0 0 6 0zM20 17a3 3 0 0 0 6 0z" />
      </g>
    </svg>
  );
}

/** "Fairsquare" in Newsreader 600, 22px. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-[22px] leading-none font-semibold tracking-[-0.01em] text-foreground", className)}>
      {COPY["app.name"]}
    </span>
  );
}
