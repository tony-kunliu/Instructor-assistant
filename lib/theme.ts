// Appearance toggle (Tony's decision 2026-10-13 after testing on Staging: ONE small icon button in the top bar that
// switches Light <-> Dark; the first state follows the phone).
//
// The CSS tokens in app/globals.css already switch on `prefers-color-scheme` and on `data-theme` on <html>
// (`:root[data-theme="dark"]`, `:root:not([data-theme="light"])`). This module only decides WHICH value that
// attribute gets: no attribute = the phone decides, "light" / "dark" = the instructor's explicit choice after a tap.
// The choice is a per-device convenience kept in localStorage (never in the database); nothing here touches lesson
// data. Older stored values from the former 3-state control ("system" / "light" / "dark") still read correctly.
export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "actgds-driver:theme";

/** Whatever storage or the <html> attribute holds, as a choice; anything unknown (or nothing) is "system". */
export function themeChoice(raw: unknown): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "system";
}

/** The `data-theme` value for a choice; null = remove the attribute (follow the phone). */
export function themeAttribute(choice: ThemeChoice): Theme | null {
  return choice === "system" ? null : choice;
}

/** What is actually on screen: the explicit choice, else the phone's appearance. */
export function effectiveTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
  return choice === "system" ? (prefersDark ? "dark" : "light") : choice;
}

/** One tap always goes to the opposite of what is on screen (and that becomes the explicit choice). */
export function toggledTheme(effective: Theme): Theme {
  return effective === "dark" ? "light" : "dark";
}

/** The button's accessible name states the action, not the state. */
export function toggleLabel(effective: Theme): string {
  return effective === "dark" ? "Switch to light theme" : "Switch to dark theme";
}

/** The navy top bar colour the browser chrome shows — the same values as `--navy` in app/globals.css and the
 *  `themeColor` entries in app/layout.tsx. */
export const NAVY: Record<Theme, string> = { light: "#0b1b2b", dark: "#050d14" };

/**
 * The content of one `<meta name="theme-color">` for a choice. Next renders two metas, one per
 * `(prefers-color-scheme: …)` media query: under "system" each keeps its own colour; under an explicit theme both get
 * that theme's navy, so whichever one the phone picks shows the right colour.
 */
export function metaThemeColor(choice: ThemeChoice, media: string | null): string {
  if (choice !== "system") return NAVY[choice];
  return media && /dark/.test(media) ? NAVY.dark : NAVY.light;
}

/**
 * Runs inline in <head> before the first paint (app/layout.tsx), so a page opened with "dark" stored never flashes
 * light first. Plain ES5, no imports; storage blocked or absent (or the old "system" value) just follows the phone.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
