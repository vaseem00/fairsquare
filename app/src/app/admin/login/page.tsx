import type { Metadata } from "next";
import { requestTime } from "@/components/admin/request-time";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/login-form";
import { LogoMark } from "@/components/shell/logo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasAdminSession } from "@/lib/auth/admin-page";
import { COPY } from "@/lib/copy";

/** Admin pages block on the session check (cookies, database, clock): no instant static shell. */
export const instant = false;

export const metadata: Metadata = {
  title: COPY["admin.signIn"],
  robots: { index: false, follow: false, nocache: true },
};

/** /admin/login (DESIGN.md section 3.8): a centred card, max-width 400px. Signed in → /admin. */
export default async function AdminLoginPage() {
  await requestTime();
  if (await hasAdminSession()) redirect("/admin");
  return (
    <div className="mx-auto flex w-full max-w-[400px] flex-col items-center gap-6 gutter py-12 md:py-20">
      <p className="flex items-center gap-2 text-title font-semibold wdth-title">
        <LogoMark className="size-8" />
        {COPY["admin.title"]}
      </p>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <h1 className="text-heading font-[720] wdth-heading">{COPY["admin.signIn"]}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
