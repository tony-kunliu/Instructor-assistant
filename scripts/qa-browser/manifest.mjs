// Real-browser QA of the two web app manifests AS SERVED by the compiled app, and of the pages that reference them, at
// phone and iPad widths in light and dark. SYNTHETIC / local only: no data is read or written beyond loading two pages.
// Why: the unit test (tests/manifest-colours.test.ts) reads source files; this proves the built routes serve the same
// values, with the right content type, that the stylesheet's light tokens agree, that the icon resolves, that every page
// links its manifest and carries the two theme-color metas, and that nothing scrolls sideways or logs an error.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)(`${process.env.NPM_GLOBAL}/playwright`);
const B = process.env.QA_BASE;
const OUT = process.env.QA_OUT;
const CHROMIUM = process.env.QA_CHROMIUM || `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium-1194/chrome-linux/chrome`;
const results = [];
const check = (name, ok, extra = "") => results.push({ ok: Boolean(ok), line: `${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}` });
const browser = await chromium.launch({ executablePath: CHROMIUM });

try {
  // Light tokens as the browser computes them (the first :root block; no dark override applies under light).
  const lightCtx = await browser.newContext({ colorScheme: "light" });
  const tokenPage = await lightCtx.newPage();
  await tokenPage.goto(`${B}/gps`, { waitUntil: "networkidle" });
  const tokens = await tokenPage.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { paper: s.getPropertyValue("--paper").trim().toLowerCase(), navy: s.getPropertyValue("--navy").trim().toLowerCase() };
  });
  await lightCtx.close();
  check("light tokens read from the served stylesheet: --paper and --navy are 6-digit hex", /^#[0-9a-f]{6}$/.test(tokens.paper) && /^#[0-9a-f]{6}$/.test(tokens.navy), JSON.stringify(tokens));

  const served = {};
  for (const [path, start, scope] of [["/manifest.webmanifest", "/", undefined], ["/gps/manifest.webmanifest", "/gps", "/gps"]]) {
    const r = await fetch(B + path);
    let json = null;
    try { json = await r.json(); } catch { /* reported below */ }
    served[path] = json;
    check(`${path}: HTTP 200, content-type application/manifest+json, valid JSON`, r.status === 200 && (r.headers.get("content-type") ?? "").startsWith("application/manifest+json") && json !== null, `${r.status} ${r.headers.get("content-type")}`);
    check(`${path}: colours equal the light tokens (background = --paper, theme = --navy); the pre-redesign pair is gone`, json?.background_color?.toLowerCase() === tokens.paper && json?.theme_color?.toLowerCase() === tokens.navy && json?.background_color?.toLowerCase() !== "#f4f2ee" && json?.theme_color?.toLowerCase() !== "#1d1d1f", `${json?.background_color} / ${json?.theme_color}`);
    check(`${path}: standalone, start_url ${start}${scope ? `, scope ${scope}` : ""}, one SVG icon`, json?.display === "standalone" && json?.start_url === start && (scope === undefined || json?.scope === scope) && Array.isArray(json?.icons) && json.icons.length === 1);
    for (const icon of json?.icons ?? []) {
      const ir = await fetch(B + icon.src);
      const body = await ir.text();
      check(`${path}: icon ${icon.src} resolves (200, image/svg+xml, an <svg>)`, ir.status === 200 && (ir.headers.get("content-type") ?? "").startsWith("image/svg+xml") && /<svg/.test(body), `${ir.status} ${ir.headers.get("content-type")}`);
    }
  }
  check("the two manifests carry the same colour pair", served["/manifest.webmanifest"]?.background_color === served["/gps/manifest.webmanifest"]?.background_color && served["/manifest.webmanifest"]?.theme_color === served["/gps/manifest.webmanifest"]?.theme_color);

  for (const [name, width, height] of [["iPhone 375", 375, 812], ["iPhone 390", 390, 844], ["iPad 820", 820, 1180], ["iPad 1024", 1024, 768]]) {
    for (const scheme of ["light", "dark"]) {
      for (const [path, link] of [["/", "/manifest.webmanifest"], ["/gps", "/gps/manifest.webmanifest"]]) {
        const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: true });
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
        page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 140)}`); });
        const resp = await page.goto(B + path, { waitUntil: "networkidle" });
        const info = await page.evaluate(() => ({
          link: document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null,
          metas: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content")?.toLowerCase()),
          noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
        }));
        check(`[${name}, ${scheme}] ${path}: loads, links ${link}, two theme-color metas incl. the light navy, no horizontal scroll, no console errors`, resp.status() === 200 && info.link === link && info.metas.length === 2 && info.metas.includes(tokens.navy) && info.noHScroll && errors.length === 0, JSON.stringify({ status: resp.status(), link: info.link, metas: info.metas, noHScroll: info.noHScroll, errors }));
        await ctx.close();
      }
    }
  }
} catch (error) {
  check(`script aborted: ${String(error.stack || error.message).split("\n").slice(0, 4).join(" / ")}`, false);
}

await browser.close();
writeFileSync(`${OUT}/manifest-results.txt`, results.map((r) => r.line).join("\n"));
console.log(results.map((r) => r.line).join("\n"));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS${failed ? `  (${failed} FAIL)` : ""}`);
process.exit(failed ? 1 : 0);
