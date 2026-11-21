import type { Metadata } from "next";
import { requestTime } from "@/components/admin/request-time";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdminPage } from "@/lib/auth/admin-page";
import { COPY } from "@/lib/copy";
import type { ReactNode } from "react";

/** Admin pages block on the session check (cookies, database, clock): no instant static shell. */
export const instant = false;

export const metadata: Metadata = {
  title: { default: COPY["admin.title"], template: `%s | ${COPY["admin.title"]}` },
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The admin shell (DESIGN.md section 3.8, A§4.5). The real session check happens here (the proxy only
 * redirects when the cookie is missing): no valid `mz_admin` session → /admin/login. Each page checks
 * again before it reads data, because a layout and its page render in parallel.
 */
export default async function AdminSecureLayout({ children }: { children: ReactNode }) {
  // Request-time only: the session check reads cookies and the clock.
  await requestTime();
  await requireAdminPage();
  return (
    <div className="mx-auto flex w-full max-w-[1264px] flex-col gap-6 gutter py-6 md:py-8">
      <AdminNav />
      {children}
    </div>
  );
}
