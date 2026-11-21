"use client";

/**
 * "Talk to a mortgage adviser" (DESIGN.md sections 3.4 and 6.8, A§6.7, REAL_DATA.md section 8).
 * - Only with a configured partner (`config.leadsEnabled`: PARTNER_NAME, PARTNER_REGULATOR and
 *   PARTNER_LICENCE all set). Otherwise one line: `lead.unavailable` ("Talking to a mortgage adviser
 *   through Fairsquare isn't available yet."); the estimator above stays.
 * - Partner card: the name, the licence line and the promise when it is set.
 * - Consent: an unticked Checkbox whose label is `config.consent.text` (16px), the whole row clickable.
 * - Name and mobile mount only after the tick (autoComplete name / tel, inputMode tel, help line,
 *   errors on blur), one column below `sm`.
 * - Send mounts with the fields after the tick (never a disabled Send button, D§3.4), then shows
 *   "Sending..." while the request runs.
 * - Success replaces the form with the plain LeadReceipt. API field errors map onto the fields.
 */
import { useId, useRef, useState, type FormEvent } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-region";
import type { MortgageChoice } from "@/components/money/cost-store";
import { LeadReceipt } from "@/components/money/lead-receipt";
import { usePublicConfig } from "@/components/shell/config-provider";
import { useMe } from "@/components/shell/me-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/client";
import { COPY, t } from "@/lib/copy";
import type { CheckView, LeadView, PublicConfig } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LeadRequestSchema } from "@/lib/validation/api";

type FieldName = "name" | "phone";
type FieldErrors = Partial<Record<FieldName, string>>;

function validateField(field: FieldName, value: string): string | undefined {
  const r = LeadRequestSchema.shape[field].safeParse(value);
  return r.success ? undefined : r.error.issues[0]?.message;
}

/** API `fields` keys ("phone", "fields.phone", "name") onto the form's fields. */
export function mapApiFieldErrors(fields: Record<string, string> | undefined): FieldErrors {
  const out: FieldErrors = {};
  for (const [key, message] of Object.entries(fields ?? {})) {
    const last = key.split(".").pop();
    if (last === "name" || last === "phone") out[last] ??= message;
  }
  return out;
}

/** Sent requests per comparison, so reopening the panel shows the receipt again (memory only). */
const sentByCode = new Map<string, { lead: LeadView; name: string }>();

const SHOWN_AS_IS = new Set(["consent_required", "consent_version_mismatch", "leads_unavailable", "rate_limited"]);

interface LeadFormProps {
  check: CheckView;
  mortgage: MortgageChoice;
  className?: string;
}

export function LeadForm(props: LeadFormProps) {
  const { leadsEnabled, partner, consent } = usePublicConfig();
  if (!leadsEnabled || !partner || !consent) {
    return (
      <p className={cn("text-body text-foreground", props.className)} data-slot="lead-unavailable">
        {COPY["lead.unavailable"]}
      </p>
    );
  }
  return <PartnerLeadForm {...props} partner={partner} consent={consent} />;
}

function PartnerLeadForm({
  check,
  mortgage,
  className,
  partner,
  consent,
}: LeadFormProps & {
  partner: NonNullable<PublicConfig["partner"]>;
  consent: NonNullable<PublicConfig["consent"]>;
}) {
  const { refresh } = useMe();
  const announce = useAnnounce();
  const ids = {
    heading: useId(),
    consent: useId(),
    name: useId(),
    nameErr: useId(),
    phone: useId(),
    phoneHelp: useId(),
    phoneErr: useId(),
    sendErr: useId(),
  };
  const [ticked, setTicked] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ lead: LeadView; name: string } | null>(() => sentByCode.get(check.code) ?? null);
  const [justSent, setJustSent] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const partnerName = partner.name;

  const onBlur = (field: FieldName, value: string) => {
    setErrors((e) => ({ ...e, [field]: validateField(field, value) }));
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ticked || sending) return;
    const next: FieldErrors = { name: validateField("name", name), phone: validateField("phone", phone) };
    setErrors(next);
    setSendError(null);
    if (next.name || next.phone) {
      (next.name ? nameRef : phoneRef).current?.focus();
      return;
    }
    setSending(true);
    const res = await api.leads.create({
      code: check.code,
      name: name.trim(),
      phone: phone.trim(),
      consent: true,
      consentVersion: consent.version,
      downPct: mortgage.downPct,
      ratePct: mortgage.ratePct,
      years: mortgage.years,
    });
    setSending(false);
    if (res.ok) {
      const receipt = { lead: res.data.lead, name: name.trim() };
      sentByCode.set(check.code, receipt);
      setSent(receipt);
      setJustSent(true);
      announce(t("lead.sentTitle", { PARTNER_NAME: res.data.lead.partner }));
      void refresh();
      return;
    }
    const fieldErrors = mapApiFieldErrors(res.error.fields);
    if (fieldErrors.name || fieldErrors.phone) {
      setErrors(fieldErrors);
      (fieldErrors.name ? nameRef : phoneRef).current?.focus();
      return;
    }
    setSendError(SHOWN_AS_IS.has(res.error.code) ? res.error.message : COPY["lead.errSend"]);
  };

  return (
    <section aria-labelledby={ids.heading} className={cn("flex flex-col gap-4", className)} data-slot="lead-form">
      <h3 id={ids.heading} className="text-title font-[640] text-foreground wdth-title">
        {COPY["lead.h3"]}
      </h3>

      <div className="rounded-lg border border-input bg-card p-4 text-body">
        <p className="font-semibold text-foreground">{partnerName}</p>
        <p className="text-muted-foreground">
          {t("lead.partnerLive", { PARTNER_REGULATOR: partner.regulator, PARTNER_LICENCE: partner.licence })}
        </p>
        {partner.promise ? (
          <p className="text-muted-foreground">{t("lead.promiseLive", { PARTNER_PROMISE: partner.promise })}</p>
        ) : null}
      </div>

      {sent ? (
        <LeadReceipt lead={sent.lead} name={sent.name} focusOnMount={justSent} />
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <label htmlFor={ids.consent} className="flex cursor-pointer items-start gap-3 py-3">
            <Checkbox
              id={ids.consent}
              checked={ticked}
              onCheckedChange={(c) => setTicked(c === true)}
              aria-labelledby={`${ids.consent}-text`}
              className="mt-0.5 size-5 [&_[data-slot=checkbox-indicator]>svg]:size-4"
            />
            <span id={`${ids.consent}-text`} className="text-body text-foreground">
              {consent.text}
            </span>
          </label>

          {ticked ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor={ids.name} className="text-caption">
                  {COPY["lead.name"]}
                </Label>
                <Input
                  ref={nameRef}
                  id={ids.name}
                  name="name"
                  autoComplete="name"
                  enterKeyHint="next"
                  maxLength={80}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.name) setErrors((x) => ({ ...x, name: validateField("name", e.target.value) }));
                  }}
                  onBlur={(e) => onBlur("name", e.target.value)}
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? ids.nameErr : undefined}
                />
                {errors.name ? (
                  <p id={ids.nameErr} className="flex items-start gap-1.5 text-caption text-destructive">
                    <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
                    {errors.name}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={ids.phone} className="text-caption">
                  {COPY["lead.mobile"]}
                </Label>
                <Input
                  ref={phoneRef}
                  id={ids.phone}
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="send"
                  maxLength={32}
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (errors.phone) setErrors((x) => ({ ...x, phone: validateField("phone", e.target.value) }));
                  }}
                  onBlur={(e) => onBlur("phone", e.target.value)}
                  aria-invalid={errors.phone ? true : undefined}
                  aria-describedby={errors.phone ? `${ids.phoneErr} ${ids.phoneHelp}` : ids.phoneHelp}
                  className="num"
                />
                <p id={ids.phoneHelp} className="text-caption text-muted-foreground">
                  {COPY["lead.mobileHelp"]}
                </p>
                {errors.phone ? (
                  <p id={ids.phoneErr} className="flex items-start gap-1.5 text-caption text-destructive">
                    <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
                    {errors.phone}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {sendError ? (
            <div
              id={ids.sendErr}
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive bg-card p-3 text-body text-destructive"
            >
              <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0" />
              <p>{sendError}</p>
            </div>
          ) : null}

          {/* D§3.4: Send appears with the fields, after the tick, so there is never a disabled Send button. */}
          {ticked ? (
            <Button
              type="submit"
              aria-disabled={sending || undefined}
              className="h-auto min-h-11 w-full text-wrap sm:w-fit md:h-auto"
            >
              {sending ? <Spinner /> : null}
              {sending ? COPY["lead.sending"] : t("lead.send", { PARTNER_NAME: partnerName })}
            </Button>
          ) : null}
          <p className="text-caption text-muted-foreground">{COPY["lead.nothingShared"]}</p>
        </form>
      )}
    </section>
  );
}
