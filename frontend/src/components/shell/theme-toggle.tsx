"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { THEME_PREFERENCES, type ThemePreference } from "@/lib/theme/theme";
import { useTheme } from "@/lib/theme/use-theme";

const LABEL: Record<ThemePreference, string> = { system: "System", light: "Light", dark: "Dark" };
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

/** Cycles System → Light → Dark. The label says the current choice and the next one. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const next =
    THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(preference) + 1) % THEME_PREFERENCES.length];
  const Icon = ICON[preference];

  return (
    <IconButton
      label={`Theme: ${LABEL[preference]}. Switch to ${LABEL[next]}`}
      onClick={() => setPreference(next)}
    >
      <Icon className="size-[18px]" aria-hidden />
    </IconButton>
  );
}
