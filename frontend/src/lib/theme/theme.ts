export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "sb-theme";
export const THEME_PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * Runs in <head> before first paint (see the Next.js "preventing flash before
 * hydration" guide). Mirrors resolveTheme(); kept dependency-free and tiny.
 */
export const themeInitScript = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.setAttribute("data-theme",d?"dark":"light");r.setAttribute("data-theme-preference",p)}catch(e){}})()`;
