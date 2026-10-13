"use client";

import { useEffect, useState } from "react";
import { effectiveTheme, metaThemeColor, THEME_STORAGE_KEY, themeChoice, toggledTheme, toggleLabel, type Theme } from "@/lib/theme.ts";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * One small icon button in the top bar: shows a moon on the light theme ("Switch to dark theme") and a sun on the dark
 * theme ("Switch to light theme"). The first state is whatever is on screen (the phone's appearance, or the choice the
 * boot script in app/layout.tsx already applied before paint); a tap writes `data-theme` on <html> (the CSS tokens do
 * the rest), remembers the explicit choice on this device and keeps the `theme-color` metas in step. With storage
 * blocked the tap still works for this page; nothing persists then.
 */
export default function ThemeToggle() {
  // Rendered as "light" on the server and until mounted (same markup on both sides, no hydration mismatch); the real
  // state is read in the effect below before the user can tap.
  const [effective, setEffective] = useState<Theme>("light");

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const read = () => setEffective(effectiveTheme(themeChoice(document.documentElement.getAttribute("data-theme")), media.matches));
    read();
    // While no explicit choice is set, follow the phone when it switches (e.g. sunset); an explicit choice ignores it.
    media.addEventListener("change", read);
    return () => media.removeEventListener("change", read);
  }, []);

  const toggle = () => {
    const next = toggledTheme(effective);
    setEffective(next);
    document.documentElement.setAttribute("data-theme", next);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* private window / blocked storage: the choice still applies to this page */ }
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.setAttribute("content", metaThemeColor(next, meta.getAttribute("media")));
    }
  };

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={toggleLabel(effective)} title={toggleLabel(effective)} data-testid="theme-toggle" data-effective={effective}>
      {effective === "dark" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon="sun">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon="moon">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
