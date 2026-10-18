// The installed (Home Screen) app's splash / status-bar colours must follow the stylesheet's design tokens, and the
// separate /gps manifest must carry the same pair. Synthetic: reads only source files, no network, no data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import manifest, { MANIFEST_BACKGROUND } from "../app/manifest.ts";
import { GET as gpsManifest } from "../app/gps/manifest.webmanifest/route.ts";
import { NAVY } from "../lib/theme.ts";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
// The first :root block is the light theme; dark overrides come later (media query / [data-theme="dark"]).
const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
// Anchored on the declaration start, so a longer custom-property name that merely ENDS in `--navy` (e.g. `--x--navy`)
// can never be read as `--navy`. (`--on-navy` was never at risk: its `-navy` has one hyphen before it.)
const readToken = (block: string, name: string) => new RegExp(`(?:^|[\\s;{])--${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(block)?.[1]?.toLowerCase() ?? null;
const token = (name: string) => readToken(rootBlock, name);

test("token reader: a longer name ending in `--navy` is not read as `--navy`; neighbouring names are unaffected", () => {
  assert.equal(readToken("--x--navy: #111111; --navy: #222222;", "navy"), "#222222");
  assert.equal(readToken("--navy: #222222; --x--navy: #111111;", "navy"), "#222222");
  assert.equal(readToken("--x--navy: #111111;", "navy"), null);
  assert.equal(readToken("--on-navy: #111111; --navy: #222222;", "navy"), "#222222");
  assert.equal(readToken("--on-navy: #111111; --navy: #222222;", "on-navy"), "#111111");
});

test("the stylesheet's light :root block defines --paper and --navy as 6-digit hex", () => {
  assert.match(token("paper") ?? "", /^#[0-9a-f]{6}$/);
  assert.match(token("navy") ?? "", /^#[0-9a-f]{6}$/);
});

test("app manifest: background = light --paper, theme colour = light --navy (= the layout's light theme-color)", () => {
  const m = manifest();
  assert.equal(m.background_color?.toLowerCase(), token("paper"));
  assert.equal(m.theme_color?.toLowerCase(), token("navy"));
  assert.equal(m.theme_color?.toLowerCase(), NAVY.light.toLowerCase());
  assert.equal(MANIFEST_BACKGROUND.toLowerCase(), token("paper"));
});

test("app manifest keeps its identity: name, start_url, standalone, one icon (colours are the only change)", () => {
  const m = manifest();
  assert.equal(m.name, "ACTGDS Instructor");
  assert.equal(m.short_name, "Instructor");
  assert.equal(m.start_url, "/");
  assert.equal(m.display, "standalone");
  assert.deepEqual(m.icons, [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }]);
});

test("the pre-redesign colours are gone", () => {
  const m = manifest();
  assert.notEqual(m.background_color?.toLowerCase(), "#f4f2ee");
  assert.notEqual(m.theme_color?.toLowerCase(), "#1d1d1f");
});

test("/gps manifest carries the same colour pair as the app manifest and stays scoped to /gps", async () => {
  const app = manifest();
  const gps = (await gpsManifest().json()) as Record<string, unknown>;
  assert.equal(String(gps.background_color).toLowerCase(), app.background_color?.toLowerCase());
  assert.equal(String(gps.theme_color).toLowerCase(), app.theme_color?.toLowerCase());
  assert.equal(gps.start_url, "/gps");
  assert.equal(gps.scope, "/gps");
});
