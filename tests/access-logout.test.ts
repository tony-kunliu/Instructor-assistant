import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCESS_LOGOUT_PATH, accessLogoutUrl } from "../lib/access-logout.ts";

test("logout goes through the app's own origin (deletes this app's Access cookie) and returns to it", () => {
  const url = accessLogoutUrl("https://instructor-assistant-production.kunliu-work.workers.dev");
  assert.equal(
    url,
    "/cdn-cgi/access/logout?returnTo=https%3A%2F%2Finstructor-assistant-production.kunliu-work.workers.dev%2F",
  );
  assert.ok(url.startsWith(ACCESS_LOGOUT_PATH), "logout stays a same-origin relative path, never the team-domain URL");
});

test("returnTo is always the app's own origin root, never a foreign or relative target", () => {
  for (const origin of ["https://a.example", "http://localhost:3000"]) {
    const returnTo = new URL(accessLogoutUrl(origin), origin).searchParams.get("returnTo");
    assert.equal(returnTo, `${origin}/`);
  }
});

test("without a usable origin (server render, malformed input) it falls back to plain logout, still logging out", () => {
  for (const bad of [null, undefined, "", "null", "https://a.example/path", "javascript:alert(1)", "//evil.example"]) {
    assert.equal(accessLogoutUrl(bad), ACCESS_LOGOUT_PATH);
  }
});
