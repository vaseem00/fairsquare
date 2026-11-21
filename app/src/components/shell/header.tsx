"use client";

/**
 * The sticky app header (docs/REDESIGN.md section 8.1): paper, no shadow, and a hairline that appears
 * only once the page has scrolled 8px (an IntersectionObserver sentinel, no scroll handler).
 * - Phones: 56px, one row at 360px: mark, wordmark, "Saved" with its new-sales count as plain text,
 *   and the 44px Menu that opens the right-side Sheet. No bottom tab bar.
 * - From 1024px: 64px, the same mark and wordmark (English only), links in Archivo 15/500 (muted; the
 *   current page in ink with a 1.5px underline 6px below the baseline and aria-current), How
 *   Fairsquare compares and the theme menu.
 * The Saved count is `me.savedWithNewSales` (listings with sales since they were last opened); the
 * link's accessible name says it in words (`nav.savedSr`). No Bookmark icon and no badge.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { LogoMark, Wordmark } from "@/components/shell/logo";
import { useMe } from "@/components/shell/me-provider";
import { MenuSheet } from "@/components/shell/menu-sheet";
import { isAdminPath, isCurrent, NAV, savedLinkName } from "@/components/shell/nav-items";
import { ThemeMenu } from "@/components/shell/theme-menu";
import { COPY } from "@/lib/copy";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The count of saved listings with new sales, as plain tabular text (the link's name says it in words). */
function SavedCount({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span aria-hidden="true" className="font-medium text-foreground num">
      {formatInt(n)}
    </span>
  );
}

const navLink =
  "inline-flex min-h-11 items-center gap-1.5 rounded-sm px-2.5 text-[15px] font-medium text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:decoration-[1.5px] aria-[current=page]:underline-offset-[6px]";

/** True once the page has scrolled past the 8px sentinel at its top. */
function useScrolled(): [boolean, RefObject<HTMLDivElement | null>] {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [scrolled, sentinel];
}

/** The header bar; `pathname` is null while the route is not known yet. */
export function HeaderBar({ pathname }: { pathname: string | null }) {
  const { me } = useMe();
  const newSales = me?.savedWithNewSales ?? 0;
  const savedName = savedLinkName(newSales);
  const cur = (href: string) => (isCurrent(pathname, href) ? ("page" as const) : undefined);
  const [scrolled, sentinel] = useScrolled();

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="pointer-events-none absolute top-0 left-0 h-2 w-px" />
      <header
        data-scrolled={scrolled || undefined}
        className="sticky top-0 z-30 border-b border-transparent bg-background pt-[env(safe-area-inset-top)] transition-colors duration-(--dur-fast) data-scrolled:border-border"
      >
        <div className="mx-auto flex h-(--header-h) w-full max-w-[1264px] flex-nowrap items-center gap-1 gutter lg:gap-2">
          <Link
            href="/"
            aria-label={COPY["nav.home"]}
            className="-ml-1 inline-flex min-h-11 shrink-0 items-center gap-2 rounded-sm px-1"
          >
            <LogoMark className="size-7" />
            <Wordmark />
          </Link>

          <nav className="ml-8 hidden items-center gap-1 lg:flex">
            <Link href={NAV.compare.href} aria-current={cur(NAV.compare.href)} className={navLink}>
              {NAV.compare.label}
            </Link>
            <Link
              href={NAV.saved.href}
              aria-current={cur(NAV.saved.href)}
              aria-label={newSales > 0 ? savedName : undefined}
              className={navLink}
            >
              {NAV.saved.label}
              <SavedCount n={newSales} />
            </Link>
            <Link href={NAV.coverage.href} aria-current={cur(NAV.coverage.href)} className={navLink}>
              {NAV.coverage.label}
            </Link>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1 lg:gap-2">
            <Link href={NAV.how.href} aria-current={cur(NAV.how.href)} className={cn(navLink, "hidden lg:inline-flex")}>
              {NAV.how.label}
            </Link>
            <ThemeMenu className="hidden lg:inline-flex" />

            <Link
              href={NAV.saved.href}
              aria-current={cur(NAV.saved.href)}
              aria-label={newSales > 0 ? savedName : undefined}
              data-testid="header-saved-mobile"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-sm px-3 text-[15px] font-medium text-foreground aria-[current=page]:underline aria-[current=page]:decoration-[1.5px] aria-[current=page]:underline-offset-[6px] lg:hidden"
            >
              <span>{NAV.saved.label}</span>
              <SavedCount n={newSales} />
            </Link>
            <MenuSheet pathname={pathname} className="lg:hidden" />
          </div>
        </div>
      </header>
    </>
  );
}

function HeaderWithPath() {
  const pathname = usePathname();
  // Admin has its own shell (AdminNav, the login card), not the public navigation.
  if (isAdminPath(pathname)) return null;
  return <HeaderBar pathname={pathname} />;
}

export function Header() {
  return (
    <Suspense fallback={<HeaderBar pathname={null} />}>
      <HeaderWithPath />
    </Suspense>
  );
}
