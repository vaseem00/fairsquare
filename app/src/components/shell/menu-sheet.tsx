"use client";

/**
 * The phone menu (docs/REDESIGN.md section 8.1): a 44px Menu button that opens a right-side Sheet
 * with Compare a listing, Saved, Coverage, How Fairsquare compares, Privacy and Theme. Rows are separated
 * by hairlines, with no boxes or icons. Focus is trapped inside and returns to the trigger on close
 * (base-ui Dialog), except after a link to another page, when RouteFocus moves it to that page's h1.
 */
import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { isCurrent, NAV } from "@/components/shell/nav-items";
import { ThemeChoice } from "@/components/shell/theme-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: NAV.compare.href, label: NAV.compare.longLabel },
  NAV.saved,
  NAV.coverage,
  NAV.how,
  NAV.privacy,
] as const;

export function MenuSheet({ pathname, className }: { pathname: string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  // A link to another page closes the sheet: focus then goes to the new page's h1 (RouteFocus),
  // not back to the Menu button in the header.
  const navigating = useRef(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className={cn("-mr-2", className)} aria-label={COPY["nav.menu"]} />}
      >
        <MenuIcon aria-hidden="true" strokeWidth={1.75} />
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[min(20rem,85vw)] gap-0 pb-[env(safe-area-inset-bottom)]"
        finalFocus={() => {
          const toPage = navigating.current;
          navigating.current = false;
          return !toPage;
        }}
      >
        <SheetHeader className="min-h-(--header-h) justify-center px-5 py-2">
          <SheetTitle className="type-title text-foreground">{COPY["nav.menu"]}</SheetTitle>
        </SheetHeader>
        <ul className="flex flex-col border-t border-border px-5">
          {ITEMS.map((item) => {
            const current = isCurrent(pathname, item.href);
            return (
              <li key={item.href} className="border-b border-border">
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  onClick={() => {
                    navigating.current = !current;
                    setOpen(false);
                  }}
                  className={cn(
                    "-mx-2 flex min-h-13 items-center rounded-sm px-2 text-[17px] font-medium text-foreground hover:bg-accent",
                    current && "underline decoration-[1.5px] underline-offset-[6px]",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <ThemeChoice className="px-5 py-6" />
      </SheetContent>
    </Sheet>
  );
}
