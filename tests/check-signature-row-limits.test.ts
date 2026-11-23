import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/check-signature-row-limits.mjs", import.meta.url));
const remoteAck = "I_ACKNOWLEDGE_PERMANENT_SYNTHETIC_LEARNER_AND_LESSON_DATA";
const instructorId = "00000000-0000-4000-8000-000000000001";

function run(baseUrl, overrides = {}) {
  const env = {
    ...process.env,
    BASE_URL: baseUrl,
    INSTRUCTOR_ID: instructorId,
    ...overrides,
  };
  delete env.EXTRA_HEADERS;
  return spawnSync(process.execPath, [script], {
    env,
    encoding: "utf8",
    timeout: 5_000,
  });
}

test("remote targets fail closed without an explicit permanent-write acknowledgement", () => {
  const result = run("https://instructor-assistant.example.workers.dev");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /permanently creates a synthetic learner and lesson/i);
  assert.match(result.stderr, new RegExp(remoteAck));
});

test("known Production hosts are refused even when remote-write acknowledgement is supplied", () => {
  for (const baseUrl of [
    "https://instructor-assistant-production.example.workers.dev",
    "https://actgds.com/staging",
    "https://www.actgds.com/",
  ]) {
    const result = run(baseUrl, { CONFIRM_REMOTE_WRITE: remoteAck });
    assert.equal(result.status, 2, baseUrl);
    assert.match(result.stderr, /known Production host/i, baseUrl);
  }
});

test("remote HTTP targets are refused even when acknowledged", () => {
  const result = run("http://instructor-assistant-staging.example.workers.dev", {
    CONFIRM_REMOTE_WRITE: remoteAck,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /remote HTTP/i);
});

test("BASE_URL credentials, query strings and fragments are rejected before any request", () => {
  for (const baseUrl of [
    "https://user:password@staging.example.workers.dev",
    "https://staging.example.workers.dev?token=secret",
    "https://staging.example.workers.dev#fragment",
  ]) {
    const result = run(baseUrl, { CONFIRM_REMOTE_WRITE: remoteAck });
    assert.equal(result.status, 2, baseUrl);
    assert.match(result.stderr, /credentials, query strings or fragments/i, baseUrl);
  }
});

test("malformed BASE_URL is rejected before any request", () => {
  const result = run("not-a-url");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid BASE_URL/i);
});
