// SaaS edition (spec 2026-10-21-saas-edition-design §8): the installed app is named after the product, not the school.
// The private edition's manifest is pinned by tests/manifest-colours.test.ts and stays unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import manifest from "../app/manifest.ts";

test("app manifest in the SaaS edition: named \"Instructor Assistant\", no school wording; the rest is the private manifest", () => {
  const before = process.env.APP_MODE;
  try {
    delete process.env.APP_MODE;
    const priv = manifest();
    process.env.APP_MODE = "saas";
    const saas = manifest();
    assert.equal(saas.name, "Instructor Assistant");
    assert.ok(!JSON.stringify(saas).includes("ACTGDS") && !JSON.stringify(saas).includes("Golden Driving School"));
    assert.equal(priv.name, "ACTGDS Instructor");
    const { name: _a, description: _b, ...sharedSaas } = saas;
    const { name: _c, description: _d, ...sharedPrivate } = priv;
    assert.deepEqual(sharedSaas, sharedPrivate);
  } finally {
    if (before === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = before;
  }
});
