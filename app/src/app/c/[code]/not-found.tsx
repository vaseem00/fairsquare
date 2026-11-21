import Link from "next/link";
import { MessagePage } from "@/components/shell/message-page";
import { buttonVariants } from "@/components/ui/button";
import { COPY } from "@/lib/copy";

/** An unknown or deleted /c code (docs/REDESIGN.md section 8.11): the headline, one sentence, one action. */
export default function ShareNotFound() {
  return (
    <MessagePage
      title={COPY["cNotFound.h1"]}
      body={COPY["cNotFound.body"]}
      actions={
        <Link href="/" className={buttonVariants({ size: "lg" })}>
          {COPY["notFound.cta"]}
        </Link>
      }
    />
  );
}
