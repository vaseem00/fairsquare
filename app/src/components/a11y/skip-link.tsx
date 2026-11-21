import { COPY } from "@/lib/copy";

/** "Skip to content", visible on focus, targets `<main id="main" tabIndex={-1}>` (DESIGN.md section 3.0). */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-70 rounded-md bg-primary px-4 py-3 text-body font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      {COPY["nav.skip"]}
    </a>
  );
}
