"use client";

/**
 * The admin shell header (DESIGN.md section 3.8): "Fairsquare admin", section tabs as links with
 * `aria-current="page"`, and "Sign out" on the right, 24px apart. Below 768px the tabs become a Select.
 * It is the whole admin chrome: the public header and footer are not shown on /admin (isAdminPath).
 */
import { LogOutIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { LogoMark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminApi } from "@/lib/api/admin-client";
import { COPY, tList } from "@/lib/copy";
import { cn } from "@/lib/utils";

const HREFS = ["/admin", "/admin/leads", "/admin/requests", "/admin/sales", "/admin/quality"] as const;

export const ADMIN_SECTIONS: ReadonlyArray<{ href: string; label: string }> = tList("admin.tabs").map((label, i) => ({
  href: HREFS[i],
  label,
}));

/** The section a path belongs to ("/admin/leads?x" → "/admin/leads"). */
export function sectionFor(pathname: string | null): string {
  if (!pathname) return "/admin";
  const hit = [...HREFS].reverse().find((h) => h !== "/admin" && (pathname === h || pathname.startsWith(`${h}/`)));
  return hit ?? "/admin";
}

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const current = sectionFor(pathname);
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const res = await adminApi.logout();
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-center md:gap-6">
      <p className="flex items-center gap-2 text-title font-semibold wdth-title">
        <LogoMark className="size-7" />
        {COPY["admin.title"]}
      </p>
      <nav aria-label={COPY["adminUi.navLabel"]} className="hidden md:block">
        <ul className="flex flex-wrap items-center gap-1">
          {ADMIN_SECTIONS.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={current === s.href ? "page" : undefined}
                className={cn(
                  "relative inline-flex min-h-10 items-center rounded-md px-3 text-sm text-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring",
                  "aria-[current=page]:font-semibold aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:bottom-1 aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-primary",
                )}
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex items-center gap-6 md:ml-auto">
        <div className="flex-1 md:hidden">
          <Select
            value={current}
            onValueChange={(v) => {
              if (typeof v === "string" && v !== current) router.push(v);
            }}
            items={ADMIN_SECTIONS.map((s) => ({ value: s.href, label: s.label }))}
          >
            <SelectTrigger aria-label={COPY["adminUi.sectionSelect"]} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADMIN_SECTIONS.map((s) => (
                <SelectItem key={s.href} value={s.href}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={signOut} disabled={busy}>
          <LogOutIcon aria-hidden="true" />
          {COPY["admin.signOut"]}
        </Button>
      </div>
    </div>
  );
}
