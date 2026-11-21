"use client";

/**
 * Admin sign-in (DESIGN.md section 3.8): one password field with a show/hide button (paste allowed,
 * autocomplete current-password). Errors: "That password is wrong." and, after 5 tries in 15 minutes,
 * "Too many tries. Wait 15 minutes." (the server's message). Focus returns to the field on error.
 */
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminApi } from "@/lib/api/admin-client";
import { COPY } from "@/lib/copy";

export function LoginForm() {
  const router = useRouter();
  const id = useId();
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!password) {
      setError(COPY["admin.wrong"]);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await adminApi.login(password);
    if (res.ok) {
      router.replace("/admin");
      router.refresh();
      return;
    }
    setBusy(false);
    setError(res.error.message);
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-pw`}>{COPY["admin.password"]}</Label>
        <div className="relative">
          <Input
            ref={inputRef}
            id={`${id}-pw`}
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="pr-12"
            required
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            aria-label={show ? COPY["adminUi.hidePassword"] : COPY["adminUi.showPassword"]}
            aria-pressed={show}
            onClick={() => setShow((s) => !s)}
          >
            {show ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {error ? (
        <Alert variant="destructive" id={errorId} role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" size="lg" disabled={busy} aria-disabled={busy || undefined}>
        {busy ? COPY["adminUi.signingIn"] : COPY["admin.signIn"]}
      </Button>
    </form>
  );
}
