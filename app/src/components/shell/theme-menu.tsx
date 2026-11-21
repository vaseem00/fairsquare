"use client";

/**
 * Theme switch (DESIGN.md sections 2.7 and 4.1): Light, Dark, System.
 * `ThemeMenu` is the desktop header DropdownMenu; `ThemeChoice` is the inline version in the menu Sheet.
 */
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useId, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COPY, tList } from "@/lib/copy";
import { cn } from "@/lib/utils";

export type ThemeValue = "light" | "dark" | "system";

const [LIGHT, DARK, SYSTEM] = tList("theme.options");
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemeValue; label: string; Icon: LucideIcon }> = [
  { value: "light", label: LIGHT, Icon: SunIcon },
  { value: "dark", label: DARK, Icon: MoonIcon },
  { value: "system", label: SYSTEM, Icon: MonitorIcon },
];

const noopSubscribe = () => () => undefined;
/** False during SSR and hydration, true after: the stored theme is only known in the browser. */
function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function useThemeValue(): { value: ThemeValue | null; setTheme: (t: ThemeValue) => void } {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const value = mounted && (theme === "light" || theme === "dark" || theme === "system") ? theme : null;
  return { value, setTheme };
}

export function ThemeMenu({ className }: { className?: string }) {
  const { value, setTheme } = useThemeValue();
  const current = THEME_OPTIONS.find((o) => o.value === value) ?? THEME_OPTIONS[2];
  const Icon = current.Icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className={className} aria-label={COPY["theme.label"]} />}
      >
        <Icon aria-hidden="true" strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{COPY["theme.label"]}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value ?? "system"} onValueChange={(v) => setTheme(v as ThemeValue)}>
            {THEME_OPTIONS.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={o.value} className="min-h-10 pointer-coarse:min-h-11">
                <o.Icon aria-hidden="true" strokeWidth={1.75} />
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Three pressed-state buttons under a visible "Theme" label, for the mobile menu Sheet. */
export function ThemeChoice({ className }: { className?: string }) {
  const { value, setTheme } = useThemeValue();
  const labelId = useId();
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p id={labelId} className="type-label text-muted-foreground">
        {COPY["theme.label"]}
      </p>
      <div role="group" aria-labelledby={labelId} className="grid grid-cols-3 gap-2">
        {THEME_OPTIONS.map((o) => (
          <Button
            key={o.value}
            type="button"
            variant="outline"
            aria-pressed={value === o.value}
            onClick={() => setTheme(o.value)}
            className="h-11 gap-1.5 px-2 text-sm aria-pressed:border-foreground aria-pressed:bg-accent aria-pressed:shadow-[inset_0_0_0_1px_var(--foreground)]"
          >
            <o.Icon aria-hidden="true" strokeWidth={1.75} className="size-4" />
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
