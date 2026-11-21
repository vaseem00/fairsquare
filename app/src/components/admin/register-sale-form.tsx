"use client";

/**
 * Register a sale (DESIGN.md section 3.8). Fields start empty; there is no source picker (the server
 * stores `source: "admin"`). Completion is a ready / off-plan choice (ready
 * to start with), because ready and off-plan sales are compared separately (REAL_DATA.md sections 7
 * and 12). Once the fields are valid the impact preview appears in an Alert with
 * role=status ("The 2-bed median in {building} moves from AED {old} to AED {new} per sq ft. {n} saved
 * listings will show a new sale."). Submitting with errors focuses the first invalid field.
 * Success: toast "Sale registered" and the form empties again.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BuildingCombobox, type BuildingOption } from "@/components/admin/building-combobox";
import { BEDROOM_VALUES } from "@/components/admin/sales-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminApi } from "@/lib/api/admin-client";
import { COPY } from "@/lib/copy";
import { dubaiToday } from "@/lib/domain/dates";
import { bedsOption } from "@/lib/format";
import {
  newSaleSchema,
  SALE_COMPLETIONS,
  type AdminSale,
  type NewSaleBody,
  type SaleCompletion,
  type SalePreview,
} from "@/lib/validation/admin";
import { zodFieldErrors } from "@/lib/validation/api";
import { toNumberOrUndefined } from "@/lib/validation/fields";

type FieldName = "buildingId" | "bedrooms" | "sizeSqft" | "priceAed" | "saleDate" | "externalRef";
const ORDER: FieldName[] = ["buildingId", "bedrooms", "sizeSqft", "priceAed", "saleDate", "externalRef"];

interface FormState {
  buildingId: number | null;
  bedrooms: string;
  sizeSqft: string;
  priceAed: string;
  saleDate: string;
  externalRef: string;
  /** REAL_DATA.md section 12: admin sales carry a completion, ready or off-plan (ready to start with). */
  completion: SaleCompletion;
}

const EMPTY: FormState = {
  buildingId: null,
  bedrooms: "",
  sizeSqft: "",
  priceAed: "",
  saleDate: "",
  externalRef: "",
  completion: "ready",
};

function toBody(s: FormState): Record<string, unknown> {
  return {
    buildingId: s.buildingId ?? undefined,
    bedrooms: s.bedrooms === "" ? undefined : Number(s.bedrooms),
    sizeSqft: toNumberOrUndefined(s.sizeSqft),
    priceAed: toNumberOrUndefined(s.priceAed),
    saleDate: s.saleDate || undefined,
    externalRef: s.externalRef.trim() || undefined,
    completion: s.completion,
  };
}

export function RegisterSaleForm({
  buildings,
  onRegistered,
}: {
  buildings: readonly BuildingOption[];
  onRegistered?: (sale: AdminSale) => void;
}) {
  const id = useId();
  const today = dubaiToday();
  const [state, setState] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [preview, setPreview] = useState<SalePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<Partial<Record<FieldName, HTMLElement | null>>>({});

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setState((s) => ({ ...s, [k]: v }));
    if (k in errors) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  // Impact preview once every field is valid (debounced).
  useEffect(() => {
    const parsed = newSaleSchema(today).safeParse(toBody(state));
    if (!parsed.success) {
      const clear = setTimeout(() => setPreview(null), 0);
      return () => clearTimeout(clear);
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await adminApi.sales.preview(toBody(state) as NewSaleBody);
      if (!cancelled) setPreview(res.ok ? res.data : null);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, today]);

  function focusFirst(fields: Partial<Record<FieldName, string>>) {
    const first = ORDER.find((f) => fields[f]);
    if (first) refs.current[first]?.focus();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = newSaleSchema(today).safeParse(toBody(state));
    if (!parsed.success) {
      const fields = zodFieldErrors(parsed.error) as Partial<Record<FieldName, string>>;
      setErrors(fields);
      focusFirst(fields);
      return;
    }
    setBusy(true);
    const res = await adminApi.sales.create(toBody(state) as NewSaleBody);
    setBusy(false);
    if (!res.ok) {
      if (res.error.fields) {
        const fields = res.error.fields as Partial<Record<FieldName, string>>;
        setErrors(fields);
        focusFirst(fields);
      } else toast.error(res.error.message);
      return;
    }
    toast.success(COPY["admin.registered"]);
    setState(EMPTY);
    setErrors({});
    setPreview(null);
    onRegistered?.(res.data.sale);
  }

  const err = (f: FieldName) =>
    errors[f] ? (
      <p id={`${id}-${f}-err`} className="text-sm text-destructive">
        {errors[f]}
      </p>
    ) : null;
  const a11y = (f: FieldName) => ({
    "aria-invalid": errors[f] ? true : undefined,
    "aria-describedby": errors[f] ? `${id}-${f}-err` : undefined,
  });
  const bedItems = BEDROOM_VALUES.map((b) => ({ value: String(b), label: bedsOption(b) }));
  const row = "grid gap-1.5 md:grid-cols-[11rem_minmax(0,22rem)] md:items-center md:gap-x-4";

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
      <div className={row}>
        <Label htmlFor={`${id}-building`}>{COPY["field.building"]}</Label>
        <div ref={(el) => void (refs.current.buildingId = el?.querySelector("button") ?? null)}>
          <BuildingCombobox
            id={`${id}-building`}
            buildings={buildings}
            value={state.buildingId}
            onChange={(v) => set("buildingId", v)}
            invalid={Boolean(errors.buildingId)}
            describedBy={errors.buildingId ? `${id}-buildingId-err` : undefined}
          />
        </div>
        <div className="md:col-start-2">{err("buildingId")}</div>
      </div>

      <div className={row}>
        <Label htmlFor={`${id}-beds`}>{COPY["field.bedrooms"]}</Label>
        <Select value={state.bedrooms || null} items={bedItems} onValueChange={(v) => set("bedrooms", typeof v === "string" ? v : "")}>
          <SelectTrigger
            id={`${id}-beds`}
            ref={(el) => void (refs.current.bedrooms = el)}
            className="w-full"
            {...a11y("bedrooms")}
          >
            <SelectValue placeholder={COPY["adminUi.chooseBedrooms"]} />
          </SelectTrigger>
          <SelectContent>
            {bedItems.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="md:col-start-2">{err("bedrooms")}</div>
      </div>

      <div className={row}>
        <Label htmlFor={`${id}-size`}>{COPY["field.size"]}</Label>
        <Input
          id={`${id}-size`}
          ref={(el) => void (refs.current.sizeSqft = el)}
          inputMode="decimal"
          autoComplete="off"
          value={state.sizeSqft}
          onChange={(e) => set("sizeSqft", e.target.value)}
          {...a11y("sizeSqft")}
        />
        <div className="md:col-start-2">{err("sizeSqft")}</div>
      </div>

      <div className={row}>
        <Label htmlFor={`${id}-price`}>{COPY["result.colPrice"]}</Label>
        <InputGroup className="h-11 bg-card md:h-10">
          <InputGroupAddon align="inline-start">
            <InputGroupText>{COPY["adminUi.aed"]}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id={`${id}-price`}
            ref={(el) => void (refs.current.priceAed = el)}
            inputMode="numeric"
            autoComplete="off"
            value={state.priceAed}
            onChange={(e) => set("priceAed", e.target.value)}
            {...a11y("priceAed")}
          />
        </InputGroup>
        <div className="md:col-start-2">{err("priceAed")}</div>
      </div>

      <div className={row}>
        <Label htmlFor={`${id}-date`}>{COPY["result.colDate"]}</Label>
        <Input
          id={`${id}-date`}
          ref={(el) => void (refs.current.saleDate = el)}
          type="date"
          max={today}
          value={state.saleDate}
          onChange={(e) => set("saleDate", e.target.value)}
          {...a11y("saleDate")}
        />
        <div className="md:col-start-2">{err("saleDate")}</div>
      </div>

      <div className={row}>
        <Label htmlFor={`${id}-ref`}>{COPY["admin.reference"]}</Label>
        <Input
          id={`${id}-ref`}
          ref={(el) => void (refs.current.externalRef = el)}
          autoComplete="off"
          value={state.externalRef}
          onChange={(e) => set("externalRef", e.target.value)}
          {...a11y("externalRef")}
        />
        <div className="md:col-start-2">{err("externalRef")}</div>
      </div>

      <div className={row}>
        <span id={`${id}-completion`} className="text-sm leading-none font-medium select-none">
          {COPY["adminUi.colCompletion"]}
        </span>
        <RadioGroup
          value={state.completion}
          onValueChange={(v) => {
            if (v === "ready" || v === "off_plan") set("completion", v);
          }}
          aria-labelledby={`${id}-completion`}
          className="flex flex-wrap gap-x-6 gap-y-2"
          data-slot="sale-completion"
        >
          {SALE_COMPLETIONS.map((c) => (
            <label key={c} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
              <RadioGroupItem value={c} aria-labelledby={`${id}-completion-${c}`} />
              <span id={`${id}-completion-${c}`}>{COPY[`adminUi.completion.${c}`]}</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      <div role="status" aria-live="polite" className="md:pl-[calc(11rem+1rem)]">
        {preview ? (
          <Alert role="none">
            <AlertDescription className="text-body text-foreground">{preview.impact}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div className="md:pl-[calc(11rem+1rem)]">
        <Button type="submit" disabled={busy}>
          {busy ? COPY["adminUi.registering"] : COPY["admin.registerCta"]}
        </Button>
      </div>
    </form>
  );
}
