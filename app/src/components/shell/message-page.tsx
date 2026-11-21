/**
 * Not found and error pages (docs/REDESIGN.md section 8.11): an h1 in `type-display-md`, one
 * `type-lead` sentence and one primary action (plus, at most, a text button). Left-aligned, no icons,
 * no box. No hooks: server pages and the client error boundary both use it.
 */
import type { ReactNode, Ref } from "react";

export function MessagePage({
  title,
  body,
  actions,
  headingRef,
}: {
  title: string;
  body: string;
  actions: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1264px] flex-1 flex-col gutter pt-14 pb-20 md:pt-20 lg:pt-24">
      <div className="flex max-w-[40rem] flex-col items-start gap-5">
        <h1 ref={headingRef} tabIndex={-1} className="type-display-md text-foreground outline-none">
          {title}
        </h1>
        <p className="type-lead max-w-[48ch] text-muted-foreground">{body}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">{actions}</div>
      </div>
    </div>
  );
}
