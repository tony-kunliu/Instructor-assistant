import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/check-signature-row-limits.mjs", import.meta.url));
const remoteAck = "I_ACKNOWLEDGE_PERMANENT_SYNTHETIC_LEARNER_AND_LESSON_DATA";
const instructorId = "00000000-0000-4000-8000-000000000001";


function runAsync(baseUrl: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, BASE_URL: baseUrl, INSTRUCTOR_ID: instructorId };
    delete env.EXTRA_HEADERS;
    delete env.CONFIRM_REMOTE_WRITE;
    const child = spawn(process.execPath, [script], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function run(baseUrl: string, overrides: Record<string, string | undefined> = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BASE_URL: baseUrl,
    INSTRUCTOR_ID: instructorId,
  };
  delete env.EXTRA_HEADERS;
  delete env.CONFIRM_REMOTE_WRITE;
  Object.assign(env, overrides);
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

test("a non-exact remote-write acknowledgement is rejected", () => {
  const result = run("https://instructor-assistant.example.workers.dev", {
    CONFIRM_REMOTE_WRITE: "yes",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing remote write/i);
});

test("unsupported URL protocols are rejected", () => {
  const result = run("ftp://staging.example.workers.dev", {
    CONFIRM_REMOTE_WRITE: remoteAck,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unsupported BASE_URL protocol/i);
});

test("known Production hosts are refused even when remote-write acknowledgement is supplied", () => {
  for (const baseUrl of [
    "https://instructor-assistant-production.example.workers.dev",
    "https://actgds.com/staging",
    "https://actgds.com./staging",
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


test("redirect responses are not followed by the destructive D1 probe", { timeout: 5_000 }, async () => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(String(req.method) + " " + String(req.url));
    res.writeHead(307, { Location: "/redirected-write" });
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await runAsync("http://127.0.0.1:" + address.port);
    assert.notEqual(result.code, 0);
    assert.deepEqual(requests, ["POST /api/learners"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
