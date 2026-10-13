// Appearance toggle (one icon button Light <-> Dark in the top bar; Tony 2026-10-13): the pure helpers behind
// app/theme-switch.tsx and the inline boot script in app/layout.tsx. Presentation only: a per-device choice, never data.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { effectiveTheme, metaThemeColor, NAVY, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY, themeAttribute, themeChoice, toggledTheme, toggleLabel } from "../lib/theme.ts";

test("themeChoice: only light / dark are explicit choices; nothing, garbage, or the former 'system' value follow the phone", () => {
  assert.equal(themeChoice("light"), "light");
  assert.equal(themeChoice("dark"), "dark");
  assert.equal(themeChoice("system"), "system", "old 3-state value still read");
  assert.equal(themeChoice(null), "system");
  assert.equal(themeChoice(undefined), "system");
  assert.equal(themeChoice("Dark"), "system");
  assert.equal(themeChoice(42), "system");
});

test("themeAttribute: following the phone removes data-theme, an explicit choice forces it", () => {
  assert.equal(themeAttribute("system"), null);
  assert.equal(themeAttribute("light"), "light");
  assert.equal(themeAttribute("dark"), "dark");
});

test("effectiveTheme: the first state is the phone's appearance; an explicit choice wins over the phone", () => {
  assert.equal(effectiveTheme("system", false), "light");
  assert.equal(effectiveTheme("system", true), "dark");
  assert.equal(effectiveTheme("light", true), "light");
  assert.equal(effectiveTheme("dark", false), "dark");
});

test("toggledTheme / toggleLabel: one tap goes to the opposite of what is on screen; the name states that action", () => {
  assert.equal(toggledTheme("light"), "dark");
  assert.equal(toggledTheme("dark"), "light");
  assert.equal(toggleLabel("light"), "Switch to dark theme");
  assert.equal(toggleLabel("dark"), "Switch to light theme");
  for (const t of ["light", "dark"] as const) assert.equal(toggledTheme(toggledTheme(t)), t, "two taps are back where they started");
});

test("metaThemeColor: following the phone each theme-color meta keeps its own navy; an explicit theme gives both metas that navy", () => {
  assert.equal(metaThemeColor("system", "(prefers-color-scheme: light)"), NAVY.light);
  assert.equal(metaThemeColor("system", "(prefers-color-scheme: dark)"), NAVY.dark);
  assert.equal(metaThemeColor("system", null), NAVY.light);
  for (const media of ["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)", null]) {
    assert.equal(metaThemeColor("dark", media), NAVY.dark);
    assert.equal(metaThemeColor("light", media), NAVY.light);
  }
  assert.equal(NAVY.light, "#0b1b2b", "same as --navy (light) in app/globals.css");
  assert.equal(NAVY.dark, "#050d14", "same as --navy (dark) in app/globals.css");
});

/** Runs the inline boot script against a fake document + localStorage, as the browser does before the first paint. */
function boot(storage: { getItem(key: string): string | null }) {
  const attrs: Record<string, string> = {};
  const context = { localStorage: storage, document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } } };
  vm.runInNewContext(THEME_BOOT_SCRIPT, context);
  return attrs;
}

test("boot script: applies a stored dark / light choice to <html> before paint, from the toggle's own key", () => {
  assert.ok(THEME_BOOT_SCRIPT.includes(JSON.stringify(THEME_STORAGE_KEY)), "reads the key the toggle writes");
  assert.deepEqual(boot({ getItem: (key) => (key === THEME_STORAGE_KEY ? "dark" : null) }), { "data-theme": "dark" });
  assert.deepEqual(boot({ getItem: (key) => (key === THEME_STORAGE_KEY ? "light" : null) }), { "data-theme": "light" });
});

test("boot script: nothing stored, the old 'system' value, an unknown value, or storage that throws (private window / blocked) follow the phone and never throw", () => {
  assert.deepEqual(boot({ getItem: () => null }), {});
  assert.deepEqual(boot({ getItem: () => "system" }), {});
  assert.deepEqual(boot({ getItem: () => "sepia" }), {});
  assert.deepEqual(boot({ getItem: () => { throw new Error("SecurityError"); } }), {});
  const context = { document: { documentElement: { setAttribute: () => { throw new Error("must not be called"); } } } }; // no localStorage at all
  assert.doesNotThrow(() => vm.runInNewContext(THEME_BOOT_SCRIPT, context));
});
