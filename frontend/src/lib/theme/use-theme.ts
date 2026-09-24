"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  const value = document.documentElement.getAttribute("data-theme-preference");
  return isThemePreference(value) ? value : "system";
}

function apply(preference: ThemePreference) {
  const root = document.documentElement;
  const resolved = resolveTheme(preference, window.matchMedia(DARK_QUERY).matches);
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-preference", preference);
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/**
 * Theme state lives on <html> (set before paint by themeInitScript), so this
 * hook reads it with useSyncExternalStore instead of copying it into state.
 */
export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as const);
  const resolved = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"),
    () => "light" as const,
  );

  // Follow the OS setting live while the preference is "system".
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked (private mode); the choice still applies for this visit.
    }
    apply(next);
  }, []);

  return { preference, resolved, setPreference };
}
