// Appearance switch (System / Light / Dark; Tony 2026-10-13): the pure helpers behind app/theme-switch.tsx and the
// inline boot script in app/layout.tsx. Presentation only: a per-device choice, never data.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { metaThemeColor, NAVY, THEME_BOOT_SCRIPT, THEME_CHOICES, THEME_LABEL, THEME_STORAGE_KEY, themeAttribute, themeChoice } from "../lib/theme.ts";

test("themeChoice: only light / dark are choices; anything else (nothing, garbage, 'system') is System", () => {
  assert.equal(themeChoice("light"), "light");
  assert.equal(themeChoice("dark"), "dark");
  assert.equal(themeChoice("system"), "system");
  assert.equal(themeChoice(null), "system");
  assert.equal(themeChoice(undefined), "system");
  assert.equal(themeChoice("Dark"), "system");
  assert.equal(themeChoice(42), "system");
  assert.deepEqual(THEME_CHOICES, ["system", "light", "dark"]);
  assert.deepEqual(Object.values(THEME_LABEL), ["System", "Light", "Dark"]);
});

test("themeAttribute: System removes data-theme (the phone decides), Light / Dark force it", () => {
  assert.equal(themeAttribute("system"), null);
  assert.equal(themeAttribute("light"), "light");
  assert.equal(themeAttribute("dark"), "dark");
});

test("metaThemeColor: under System each theme-color meta keeps its own navy; a forced theme gives both metas that navy", () => {
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

test("boot script: applies a stored dark / light choice to <html> before paint, from the switch's own key", () => {
  assert.ok(THEME_BOOT_SCRIPT.includes(JSON.stringify(THEME_STORAGE_KEY)), "reads the key the switch writes");
  assert.deepEqual(boot({ getItem: (key) => (key === THEME_STORAGE_KEY ? "dark" : null) }), { "data-theme": "dark" });
  assert.deepEqual(boot({ getItem: (key) => (key === THEME_STORAGE_KEY ? "light" : null) }), { "data-theme": "light" });
});

test("boot script: nothing stored, an unknown value, or storage that throws (private window / blocked) leaves System and never throws", () => {
  assert.deepEqual(boot({ getItem: () => null }), {});
  assert.deepEqual(boot({ getItem: () => "sepia" }), {});
  assert.deepEqual(boot({ getItem: () => { throw new Error("SecurityError"); } }), {});
  const context = { document: { documentElement: { setAttribute: () => { throw new Error("must not be called"); } } } }; // no localStorage at all
  assert.doesNotThrow(() => vm.runInNewContext(THEME_BOOT_SCRIPT, context));
});
