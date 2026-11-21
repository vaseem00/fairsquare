import { COPY, t } from "@/lib/copy";

/** Public navigation (DESIGN.md section 3.0). Admin never appears here. */
export const NAV = {
  compare: { href: "/", label: COPY["nav.compare"], longLabel: COPY["nav.compareLong"] },
  saved: { href: "/saved", label: COPY["nav.saved"] },
  coverage: { href: "/coverage", label: COPY["nav.coverage"] },
  how: { href: "/how-it-works", label: COPY["nav.how"] },
  privacy: { href: "/privacy", label: COPY["nav.privacy"] },
} as const;

/** True when `href` is the current page (the home link matches "/" only). */
export function isCurrent(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The Saved link's accessible name: "Saved, 2 listings have new sales" when there are new sales. */
export function savedLinkName(newSales: number): string {
  return newSales > 0 ? t("nav.savedSr", { n: newSales }) : COPY["nav.saved"];
}

/** Admin pages (/admin, /admin/login, /admin/...) have their own shell: no public header or footer. */
export function isAdminPath(pathname: string | null): boolean {
  return pathname === "/admin" || (pathname?.startsWith("/admin/") ?? false);
}
