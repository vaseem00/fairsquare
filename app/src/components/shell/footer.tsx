"use client";

/**
 * The footer on all public pages (docs/REDESIGN.md section 8.2): Archivo 14 in pencil, a hairline on
 * top, 48px above and 64px below. The wordmark (English only, no Arabic name and no gloss), the
 * links (44px targets, wrapping, no separators), then four statements: the data attribution (the
 * dataset and licence names link to the loaded manifest's URLs), the independence line (REAL_DATA.md
 * section 9), "not a valuation" and the AI disclosure. From 1024px the wordmark and links take
 * columns 1 to 4 and the statements columns 7 to 12. No DLD, Government of Dubai or Data.Dubai logos.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Attribution } from "@/components/data/attribution";
import { Wordmark } from "@/components/shell/logo";
import { isAdminPath, NAV } from "@/components/shell/nav-items";
import { COPY } from "@/lib/copy";

const LINKS = [NAV.how, NAV.coverage, NAV.privacy] as const;

function FooterBody() {
  return (
    <footer className="mt-auto border-t border-border bg-background text-caption text-muted-foreground">
      <div className="mx-auto grid w-full max-w-[1264px] gap-8 gutter pt-12 pb-16 lg:grid-cols-12 lg:gap-x-6">
        <div className="flex flex-col gap-2 lg:col-span-4">
          <Wordmark className="block pt-1" />
          <ul className="-ml-1 flex flex-wrap gap-x-5">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="inline-flex min-h-11 items-center rounded-sm px-1 text-foreground underline decoration-border decoration-1 underline-offset-4 transition-colors hover:decoration-foreground"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex max-w-[60ch] flex-col gap-2 lg:col-span-6 lg:col-start-7">
          <p>
            <Attribution />
          </p>
          <p>{COPY["data.independent"]}</p>
          <p>{COPY["footer.notValuation"]}</p>
          <p>{COPY["footer.ai"]}</p>
        </div>
      </div>
    </footer>
  );
}

function FooterWithPath() {
  const pathname = usePathname();
  // Admin pages have their own shell: no public footer or its consumer disclaimers.
  if (isAdminPath(pathname)) return null;
  return <FooterBody />;
}

/** The pathname can be request-time (dynamic routes): read it inside Suspense, like the header. */
export function Footer() {
  return (
    <Suspense fallback={<FooterBody />}>
      <FooterWithPath />
    </Suspense>
  );
}
