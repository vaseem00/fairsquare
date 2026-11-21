"use client";

/**
 * "Paste listing text" (docs/REDESIGN.md section 8.3): an underlined text button that expands a
 * labelled textarea in place (200ms height; instant under reduced motion), then [Read text]. The
 * parent reads the text with Claude, or with the local parser (`parseFields`) when screenshot reading
 * is off. `lead` renders before the trigger in the same action row (the primary button) and `after`
 * after it ("Type the details"); the panel opens below the row.
 * After Stop on a text read (`stopped`), the box opens with the text still in it, says so, and its
 * button reads "Try again" (the focus target).
 */
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { COPY } from "@/lib/copy";
import { LIMITS } from "@/lib/validation/fields";
import { cn } from "@/lib/utils";

export interface PasteTextProps {
  onRead: (text: string) => void;
  /** Rendered before the trigger in the action row (the primary action). */
  lead?: ReactNode;
  /** Rendered after the trigger in the action row. */
  after?: ReactNode;
  /** The text of a read that was stopped: the box starts open with it, and the button says Try again. */
  stopped?: string | null;
  className?: string;
}

export function PasteText({ onRead, lead, after, stopped = null, className }: PasteTextProps) {
  const ids = { text: useId(), error: useId() };
  const [open, setOpen] = useState(stopped !== null);
  const [text, setText] = useState(stopped ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!text.trim()) {
      setError(COPY["apiError.empty_input"]);
      document.getElementById(ids.text)?.focus();
      return;
    }
    setError(null);
    onRead(text);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("flex flex-col", className)} data-slot="paste-text">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {lead}
        <CollapsibleTrigger render={<Button type="button" variant="link" />}>{COPY["home.paste"]}</CollapsibleTrigger>
        {after}
      </div>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-(--dur-base) ease-out data-ending-style:h-0 data-starting-style:h-0">
        <form noValidate onSubmit={submit} className="flex flex-col gap-3 pt-4 pb-1">
          {stopped !== null ? <p className="text-caption text-muted-foreground">{COPY["read.stoppedText"]}</p> : null}
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={ids.text} className="type-label text-foreground">
              {COPY["home.pasteLabel"]}
            </FieldLabel>
            <Textarea
              id={ids.text}
              name="listingText"
              rows={4}
              value={text}
              maxLength={LIMITS.textMax}
              placeholder={COPY["home.pastePlaceholder"]}
              onChange={(e) => {
                setText(e.target.value);
                if (error && e.target.value.trim()) setError(null);
              }}
              enterKeyHint="go"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? ids.error : undefined}
              className="min-h-28"
            />
            {error ? (
              <FieldError id={ids.error} role={undefined}>
                {error}
              </FieldError>
            ) : null}
          </Field>
          <Button type="submit" size="lg" className="w-full sm:w-fit" data-action={stopped !== null ? "retry" : undefined}>
            {stopped !== null ? COPY["alert.tryAgain"] : COPY["home.pasteRead"]}
          </Button>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
