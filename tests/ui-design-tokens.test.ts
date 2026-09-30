// Guards the UI Foundation V1 contract (docs/UX_DESIGN_SYSTEM.md): the ACT Golden
// brand family is present and unchanged, and every text/background pair the
// stylesheet relies on meets WCAG 4.5:1 (normal text) or 3:1 (UI boundaries).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
const token = (name: string): string => {
  const match = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `token --${name} must be a literal hex in :root`);
  return match![1].toLowerCase();
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("ACT Golden brand family tokens are the canonical values", () => {
  assert.deepEqual(
    ["navy-950", "navy-900", "navy-800", "gold-500", "gold-400", "paper", "ink", "muted"].map(token),
    ["#06121f", "#0a1b2d", "#102a43", "#d8ae55", "#edca78", "#f6f3eb", "#13202c", "#64707b"],
  );
});

test("normal text pairs meet 4.5:1", () => {
  const white = "#ffffff";
  const pairs: [string, string, string][] = [
    ["ink on paper", token("ink"), token("paper")],
    ["muted on paper (tint)", token("muted"), token("paper")],
    ["muted on white card", token("muted"), white],
    ["white on navy-900 (primary actions, tabs)", white, token("navy-900")],
    ["gold-400 on navy-900 (header accent)", token("gold-400"), token("navy-900")],
    ["white on success-solid", white, token("success-solid")],
    ["success-fg on success-bg", token("success-fg"), token("success-bg")],
    ["white on error-solid", white, token("error-solid")],
    ["error-fg on error-bg", token("error-fg"), token("error-bg")],
    ["warn-fg on warn-bg", token("warn-fg"), token("warn-bg")],
  ];
  for (const [name, fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${contrast(fg, bg).toFixed(2)}:1 < 4.5:1`);
});

test("control boundaries and focus ring meet 3:1; bright gold is never text on light surfaces", () => {
  assert.ok(contrast(token("field-line"), "#ffffff") >= 3, "input border on white");
  assert.ok(contrast(token("navy-800"), token("paper")) >= 3, "focus ring on paper");
  assert.ok(contrast(token("gold-500"), token("paper")) < 3, "documents why gold-500 must not be used as text on Paper");
  assert.ok(contrast(token("gold-500"), token("navy-900")) >= 4.5, "gold-500 on navy-900 is acceptable");
  // No rule may set light-surface text to a gold token.
  assert.ok(!/(^|[^-])color:\s*var\(--gold-(400|500)\)/m.test(css.replace(/\.topbar small[^}]*}/, "").replace(/\.signout-link[^}]*}/, "")), "gold colour used as text outside the navy header");
});

test("touch-target tokens: 44px minimum, 48px comfortable, primary ≥56px", () => {
  const px = (name: string) => Number(root.match(new RegExp(`--${name}:\\s*(\\d+)px`))?.[1]);
  assert.ok(px("hit") >= 44);
  assert.ok(px("hit-comfy") >= 48);
  assert.ok(px("hit-primary") >= 56);
});

test("inputs keep ≥16px font size (prevents iOS focus zoom)", () => {
  const block = css.match(/\.field input, \.field select, \.field textarea \{[^}]*\}/)?.[0] ?? "";
  assert.match(block, /font-size:\s*1[7-9]px/);
  assert.match(css, /\.learner-search \{[^}]*font-size:\s*17px/);
});
