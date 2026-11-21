"use client";

/**
 * A short sheet for the result's second level (RESULT_SPEC sections 3.1, 6.4 and 7): a bottom Drawer
 * on phones and a Dialog from 1024px, with its title (the focus lands in it) and Close. Esc closes it.
 * Used by "How to check", "Wrong building?" and the evidence definitions on phones.
 */
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { COPY } from "@/lib/copy";

export function InfoSheet({
  open,
  onOpenChange,
  title,
  children,
  slot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  slot?: string;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-4 p-6 sm:max-w-md">
          <DialogHeader className="pr-10">
            <DialogTitle className="type-title">{title}</DialogTitle>
          </DialogHeader>
          <div data-slot={slot}>{open ? children : null}</div>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent>
        <DrawerHeader className="relative px-4 pt-2 pb-3 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <DrawerTitle className="pr-12 type-title">{title}</DrawerTitle>
          <DrawerClose render={<Button variant="ghost" size="icon" className="absolute top-0 right-2" aria-label={COPY["ui.close"]} />}>
            <XIcon aria-hidden="true" strokeWidth={1.75} />
          </DrawerClose>
        </DrawerHeader>
        <div className="max-h-[70dvh] overflow-y-auto px-4 pb-[calc(24px+env(safe-area-inset-bottom))]" data-slot={slot}>{open ? children : null}</div>
      </DrawerContent>
    </Drawer>
  );
}
