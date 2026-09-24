import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTheme, THEME_STORAGE_KEY, themeInitScript } from "./theme";

describe("resolveTheme", () => {
  it.each([
    ["light", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["system", true, "dark"],
    ["system", false, "light"],
  ] as const)("%s with system dark=%s → %s", (preference, systemDark, expected) => {
    expect(resolveTheme(preference, systemDark)).toBe(expected);
  });
});

describe("themeInitScript", () => {
  const run = (stored: string | null, systemDark: boolean) => {
    localStorage.clear();
    if (stored !== null) localStorage.setItem(THEME_STORAGE_KEY, stored);
    vi.stubGlobal("matchMedia", () => ({ matches: systemDark }));
    new Function(themeInitScript)();
    const root = document.documentElement;
    return [root.getAttribute("data-theme"), root.getAttribute("data-theme-preference")];
  };

  afterEach(() => vi.unstubAllGlobals());

  it("matches resolveTheme for every stored value", () => {
    expect(run("dark", false)).toEqual(["dark", "dark"]);
    expect(run("light", true)).toEqual(["light", "light"]);
    expect(run(null, true)).toEqual(["dark", "system"]);
  });

  it("treats unknown stored values as system", () => {
    expect(run("purple", false)).toEqual(["light", "system"]);
  });
});
