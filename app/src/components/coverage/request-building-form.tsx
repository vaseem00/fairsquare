"use client";

/**
 * "Don't see your building?" (DESIGN.md section 3.7): a form with a visible label, an inline error,
 * `enterKeyHint="send"`, and POST /api/requests without a code (A§0.2). Success clears the field,
 * shows `coverage.requestDone` (toast plus a persistent status line) and refreshes the Saved data.
 */
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import { useAnnounce } from "@/components/a11y/live-region";
import { visualToast } from "@/components/a11y/visual-toast";
import { useMe } from "@/components/shell/me-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api/client";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { BuildingRequestSchema } from "@/lib/validation/api";

export type RequestResult = { ok: true } | { ok: false; message: string };

/** Validates and sends a building request; shared by the form and the "Request "{q}"" button. */
export function useBuildingRequest() {
  const { refresh } = useMe();
  const announce = useAnnounce();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = useCallback(
    async (text: string): Promise<RequestResult> => {
      const parsed = BuildingRequestSchema.shape.text.safeParse(text);
      if (!parsed.success) return { ok: false, message: COPY["coverage.requestErr"] };
      setBusy(true);
      setDone(false);
      const res = await api.requests.create({ text: parsed.data });
      setBusy(false);
      if (!res.ok) return { ok: false, message: res.error.fields?.text ?? res.error.message };
      setDone(true);
      // Announced once, by the live region; the toast is the visual copy (D§7.1).
      visualToast(COPY["coverage.requestDone"]);
      announce(COPY["coverage.requestDone"]);
      void refresh();
      return { ok: true };
    },
    [announce, refresh],
  );

  return { submit, busy, done };
}

export type BuildingRequest = ReturnType<typeof useBuildingRequest>;

export function RequestBuildingForm({
  request,
  className,
}: {
  request: BuildingRequest;
  className?: string;
}) {
  const ids = { heading: useId(), input: useId(), err: useId() };
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ownRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (request.busy) return;
    const res = await request.submit(text);
    if (res.ok) {
      setText("");
      setError(null);
    } else {
      setError(res.message);
      ownRef.current?.focus();
    }
  };

  return (
    <section aria-labelledby={ids.heading} className={cn("flex flex-col gap-4", className)} data-slot="request-building">
      <h2 id={ids.heading} className="type-heading text-foreground">
        {COPY["coverage.requestH2"]}
      </h2>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
        <Label htmlFor={ids.input} className="type-label text-foreground">
          {COPY["coverage.requestLabel"]}
        </Label>
        <Input
          ref={ownRef}
          id={ids.input}
          name="text"
          enterKeyHint="send"
          autoComplete="off"
          maxLength={120}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.err : undefined}
        />
        {error ? (
          <p id={ids.err} className="flex items-start gap-1.5 text-caption text-destructive">
            <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" aria-disabled={request.busy || undefined} className="w-full sm:w-fit">
          {COPY["coverage.requestCta"]}
        </Button>
        <p className="min-h-6 text-caption text-foreground">
          {request.done ? (
            <span className="inline-flex items-center gap-1.5">
              <CheckIcon aria-hidden="true" strokeWidth={1.75} className="size-4" />
              {COPY["coverage.requestDone"]}
            </span>
          ) : null}
        </p>
      </form>
    </section>
  );
}
