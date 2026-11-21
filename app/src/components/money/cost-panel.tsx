"use client";

/**
 * Monthly cost estimate and the adviser opt-in (DESIGN.md section 3.4): a bottom Drawer below
 * 1024px and a 440px right Sheet from 1024px. Opening it records `cost_opened`. The person's
 * choice is committed for the CostRow when the panel closes.
 */
import { XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getChoice, setChoice, defaultChoice, type MortgageChoice } from "@/components/money/cost-store";
import { Estimator } from "@/components/money/estimator";
import { LeadForm } from "@/components/money/lead-form";
import { usePublicConfig } from "@/components/shell/config-provider";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api/client";
import { COPY, t } from "@/lib/copy";
import { formatInt } from "@/lib/format";
import type { CheckView } from "@/lib/types";

export interface CostPanelProps {
  check: CheckView;
  open: boolean;
  onOpenChange(open: boolean): void;
}

/** The panel's content. It mounts when the panel opens, starting from the committed choice. */
function CostPanelBody({
  check,
  draftRef,
}: {
  check: CheckView;
  draftRef: { current: MortgageChoice | null };
}) {
  const { mortgage } = usePublicConfig();
  const [choice, setLocal] = useState<MortgageChoice>(
    () => getChoice(check.code) ?? defaultChoice(check.priceAed, mortgage),
  );
  useEffect(() => {
    draftRef.current = choice;
  }, [choice, draftRef]);

  return (
    <div className="flex flex-col gap-8 px-4 pb-[calc(24px+env(safe-area-inset-bottom))] lg:px-6">
      <Estimator priceAed={check.priceAed} value={choice} onChange={setLocal} />
      <Separator />
      <LeadForm check={check} mortgage={choice} />
    </div>
  );
}

export function CostPanel({ check, open, onOpenChange }: CostPanelProps) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const draftRef = useRef<MortgageChoice | null>(null);
  const code = check.code;

  useEffect(() => {
    if (open) {
      api.track("cost_opened", code);
      return;
    }
    // Closed (by the panel or by the parent): the result's cost row now shows this choice.
    if (draftRef.current) {
      setChoice(code, draftRef.current);
      draftRef.current = null;
    }
  }, [open, code]);

  const title = COPY["cost.title"];
  const description = t("cost.for", { price: formatInt(check.priceAed) });

  if (desktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[440px] max-w-[100vw] gap-0 overflow-y-auto data-[side=right]:sm:max-w-[440px]">
          <SheetHeader className="gap-1 px-6 pt-6 pb-4">
            <SheetTitle className="pr-10 text-title font-[640] wdth-title">{title}</SheetTitle>
            <SheetDescription className="text-body text-muted-foreground num">{description}</SheetDescription>
          </SheetHeader>
          {open ? <CostPanelBody check={check} draftRef={draftRef} /> : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="max-h-[calc(100dvh-24px)]">
        <DrawerHeader className="relative gap-1 px-4 pt-2 pb-4 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <DrawerTitle className="pr-12 text-title font-[640] wdth-title">{title}</DrawerTitle>
          <DrawerDescription className="text-body text-muted-foreground num">{description}</DrawerDescription>
          <DrawerClose
            render={<Button variant="ghost" size="icon" className="absolute top-0 right-2" aria-label={COPY["ui.close"]} />}
          >
            <XIcon aria-hidden="true" strokeWidth={1.75} />
          </DrawerClose>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {open ? <CostPanelBody check={check} draftRef={draftRef} /> : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
