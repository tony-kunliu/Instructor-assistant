// middleware.ts returns 503 for every request in a deployed Worker whose
// APP_MODE is missing or not exactly "private"/"saas" (lib/app-mode.ts
// modeGate, fail closed). wrangler does not inherit [vars] into
// [env.<name>.vars], qa-browser stubs middleware.ts, and the release probe is
// answered by Cloudflare Access at the edge — so nothing else would catch an
// edit to wrangler.toml that drops or mistypes APP_MODE. These tests pin it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WRANGLER_TOML = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

// Splits the file into sections keyed by their header line (e.g. "[vars]",
// "[env.production.vars]"). Lines before the first header go under "".
function sections(toml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current = "";
  out.set(current, []);
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      current = trimmed.replace(/\s*#.*$/, "");
      // [[array-of-tables]] may repeat; a repeated [table] would be invalid TOML.
      if (!current.startsWith("[[")) assert.ok(!out.has(current), `duplicate section ${current} in wrangler.toml`);
      if (!out.has(current)) out.set(current, []);
      continue;
    }
    out.get(current)!.push(line);
  }
  return out;
}

function appModeLines(lines: string[]): string[] {
  return lines.filter((l) => /^\s*APP_MODE\s*=/.test(l)).map((l) => l.trim());
}

function appModeValue(line: string): string | undefined {
  return line.match(/^APP_MODE\s*=\s*"([^"]*)"\s*(#.*)?$/)?.[1];
}

const parsed = sections(WRANGLER_TOML);

for (const header of ["[vars]", "[env.production.vars]"]) {
  test(`wrangler.toml ${header} declares exactly one APP_MODE = "private"`, () => {
    const lines = parsed.get(header);
    assert.ok(lines, `wrangler.toml is missing the ${header} section`);
    const modes = appModeLines(lines);
    assert.equal(modes.length, 1, `${header} must declare APP_MODE exactly once, found: ${JSON.stringify(modes)}`);
    assert.equal(modes[0].replace(/\s*#.*$/, ""), 'APP_MODE = "private"');
  });
}

test('every [env.<name>.vars] section declares APP_MODE as "private" or "saas"', () => {
  const envVars = [...parsed.keys()].filter((h) => /^\[env\.[^.\]]+\.vars\]$/.test(h));
  assert.ok(envVars.includes("[env.production.vars]"), "expected at least [env.production.vars]");
  for (const header of envVars) {
    const modes = appModeLines(parsed.get(header)!);
    assert.equal(modes.length, 1, `${header} must declare APP_MODE exactly once, found: ${JSON.stringify(modes)}`);
    const value = appModeValue(modes[0]);
    assert.ok(value === "private" || value === "saas", `${header} APP_MODE must be "private" or "saas", got: ${modes[0]}`);
  }
});

test("every [env.<name>] in wrangler.toml has its own vars section declaring APP_MODE", () => {
  const envs = [...parsed.keys()]
    .map((h) => h.match(/^\[env\.([^.\]]+)\]$/)?.[1])
    .filter((n): n is string => Boolean(n));
  for (const name of envs) {
    assert.ok(parsed.has(`[env.${name}.vars]`), `[env.${name}] has no [env.${name}.vars] section; wrangler does not inherit APP_MODE from [vars]`);
  }
});
