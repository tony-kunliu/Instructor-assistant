// Appearance (System / Light / Dark), asked for by Tony after testing the dark theme on Staging (2026-10-13).
//
// The CSS tokens in app/globals.css already switch on `prefers-color-scheme` and on `data-theme` on <html>
// (`:root[data-theme="dark"]`, `:root:not([data-theme="light"])`). This module only decides WHICH value that
// attribute gets: "system" = no attribute (the phone decides), "light" / "dark" = forced. The choice is a
// per-device convenience kept in localStorage (never in the database); nothing here touches lesson data.
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];
export const THEME_STORAGE_KEY = "actgds-driver:theme";
export const THEME_LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

/** Whatever storage or the <html> attribute holds, as a choice; anything unknown (or nothing) is "system". */
export function themeChoice(raw: unknown): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "system";
}

/** The `data-theme` value for a choice; null = remove the attribute (follow the phone). */
export function themeAttribute(choice: ThemeChoice): "light" | "dark" | null {
  return choice === "system" ? null : choice;
}

/** The navy top bar colour the browser chrome shows — the same values as `--navy` in app/globals.css and the
 *  `themeColor` entries in app/layout.tsx. */
export const NAVY: Record<"light" | "dark", string> = { light: "#0b1b2b", dark: "#050d14" };

/**
 * The content of one `<meta name="theme-color">` for a choice. Next renders two metas, one per
 * `(prefers-color-scheme: …)` media query: under "system" each keeps its own colour; under a forced theme both get
 * that theme's navy, so whichever one the phone picks shows the right colour.
 */
export function metaThemeColor(choice: ThemeChoice, media: string | null): string {
  if (choice !== "system") return NAVY[choice];
  return media && /dark/.test(media) ? NAVY.dark : NAVY.light;
}

/**
 * Runs inline in <head> before the first paint (app/layout.tsx), so a page opened with "Dark" stored never flashes
 * light first. Plain ES5, no imports; storage blocked or absent just leaves "system". The same key as the switch.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
