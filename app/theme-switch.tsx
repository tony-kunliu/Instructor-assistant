"use client";

import { useEffect, useState } from "react";
import { metaThemeColor, THEME_CHOICES, THEME_LABEL, THEME_STORAGE_KEY, themeAttribute, themeChoice, type ThemeChoice } from "@/lib/theme.ts";

/**
 * Appearance control (System / Light / Dark). Writes `data-theme` on <html> (the CSS tokens do the rest), remembers
 * the choice on this device, and keeps the `theme-color` metas in step. The inline boot script in app/layout.tsx has
 * already applied the stored choice before paint; on mount the control reads it back from the attribute, so it also
 * agrees with it when storage is blocked (nothing persists then, the choice still works for this page).
 */
export default function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    setChoice(themeChoice(document.documentElement.getAttribute("data-theme")));
  }, []);

  const choose = (next: ThemeChoice) => {
    setChoice(next);
    const attribute = themeAttribute(next);
    if (attribute) document.documentElement.setAttribute("data-theme", attribute);
    else document.documentElement.removeAttribute("data-theme");
    try {
      if (attribute) window.localStorage.setItem(THEME_STORAGE_KEY, attribute);
      else window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch { /* private window / blocked storage: the choice still applies to this page */ }
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.setAttribute("content", metaThemeColor(next, meta.getAttribute("media")));
    }
  };

  return (
    <div className="theme-switch" role="group" aria-label="Appearance" data-testid="theme-switch">
      <span className="theme-switch-label">Appearance</span>
      {THEME_CHOICES.map((c) => (
        <button key={c} type="button" className={`theme-opt${choice === c ? " active" : ""}`} aria-pressed={choice === c} onClick={() => choose(c)} data-testid={`theme-${c}`}>
          {THEME_LABEL[c]}
        </button>
      ))}
    </div>
  );
}
