import type { Metadata } from "next";
import Link from "next/link";
import { MessagePage } from "@/components/shell/message-page";
import { buttonVariants } from "@/components/ui/button";
import { COPY } from "@/lib/copy";

export const metadata: Metadata = {
  title: COPY["notFound.h1"],
  robots: { index: false },
};

/** docs/REDESIGN.md section 8.11: the headline, one sentence, one action. */
export default function NotFound() {
  return (
    <MessagePage
      title={COPY["notFound.h1"]}
      body={COPY["notFound.body"]}
      actions={
        <Link href="/" className={buttonVariants({ size: "lg" })}>
          {COPY["notFound.cta"]}
        </Link>
      }
    />
  );
}
