import { test } from "node:test";
import assert from "node:assert/strict";
import { currentAppMode, modeGate, resolveAppMode } from "../lib/app-mode.ts";
import { requestScope, scopeFor } from "../lib/scope.ts";

test("resolveAppMode accepts exactly \"private\" and \"saas\" when D1 is bound", () => {
  assert.equal(resolveAppMode("saas", true), "saas");
  assert.equal(resolveAppMode("private", true), "private");
});

test("resolveAppMode fails closed on a missing or unknown mode when D1 is bound (deployed Worker)", () => {
  assert.equal(resolveAppMode(undefined, true), "invalid");
  assert.equal(resolveAppMode("SAAS", true), "invalid");
  assert.equal(resolveAppMode("prod", true), "invalid");
  assert.equal(resolveAppMode("", true), "invalid");
});

test("resolveAppMode defaults to private only without a D1 binding (local dev, tests)", () => {
  assert.equal(resolveAppMode(undefined, false), "private");
  assert.equal(resolveAppMode("prod", false), "private");
  assert.equal(resolveAppMode("saas", false), "saas");
});

test("scopeFor private mode always sees everything", () => {
  assert.deepEqual(scopeFor("private", "i1"), { kind: "all" });
  assert.deepEqual(scopeFor("private", null), { kind: "all" });
});

test("scopeFor saas mode is limited to the verified instructor", () => {
  assert.deepEqual(scopeFor("saas", "i1"), { kind: "instructor", instructorId: "i1" });
});

test("scopeFor saas mode without an instructor id throws instead of widening the scope", () => {
  assert.throws(() => scopeFor("saas", null));
  assert.throws(() => scopeFor("saas", ""));
});

test("modeGate returns 503 for an invalid mode and for saas without D1", () => {
  assert.equal(modeGate(undefined, true)?.status, 503);
  assert.equal(modeGate("SAAS", true)?.status, 503);
  assert.equal(modeGate("prod", true)?.status, 503);
  assert.equal(modeGate("saas", false)?.status, 503);
});

test("modeGate lets private mode continue with or without D1, and saas with D1", () => {
  assert.equal(modeGate("private", false), null);
  assert.equal(modeGate("private", true), null);
  assert.equal(modeGate(undefined, false), null);
  assert.equal(modeGate("saas", true), null);
});

test("currentAppMode outside a Worker follows process.env.APP_MODE, defaulting to private", () => {
  const saved = process.env.APP_MODE;
  try {
    delete process.env.APP_MODE;
    assert.equal(currentAppMode(), "private");
    process.env.APP_MODE = "saas";
    assert.equal(currentAppMode(), "saas");
    process.env.APP_MODE = "SAAS";
    assert.equal(currentAppMode(), "private");
  } finally {
    if (saved === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = saved;
  }
});

test("requestScope combines the current mode with the trusted x-instructor-id header", () => {
  const saved = process.env.APP_MODE;
  try {
    delete process.env.APP_MODE;
    assert.deepEqual(requestScope(new Request("https://ia.example/x", { headers: { "x-instructor-id": "i1" } })), { kind: "all" });
    process.env.APP_MODE = "saas";
    assert.deepEqual(requestScope(new Request("https://ia.example/x", { headers: { "x-instructor-id": "i1" } })), { kind: "instructor", instructorId: "i1" });
    assert.throws(() => requestScope(new Request("https://ia.example/x")));
  } finally {
    if (saved === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = saved;
  }
});
