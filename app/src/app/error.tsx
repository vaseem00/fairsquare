"use client";

/** docs/REDESIGN.md section 8.11: "Something went wrong on our side", with Try again and the home page. */
import Link from "next/link";
import { useEffect, useRef } from "react";
import { MessagePage } from "@/components/shell/message-page";
import { Button, buttonVariants } from "@/components/ui/button";
import { COPY } from "@/lib/copy";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    h1.current?.focus();
  }, []);

  return (
    <MessagePage
      headingRef={h1}
      title={COPY["error.h1"]}
      body={COPY["error.body"]}
      actions={
        <>
          <Button type="button" size="lg" onClick={() => retry()}>
            {COPY["error.retry"]}
          </Button>
          <Link href="/" className={buttonVariants({ variant: "link" })}>
            {COPY["error.home"]}
          </Link>
        </>
      }
    />
  );
}
