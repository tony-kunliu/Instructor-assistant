// SaaS edition P1 (spec 2026-10-21-saas-edition-design §4, §7): sign-up accounts keyed on the verified Access e-mail,
// the welcome API, header encoding for any-Unicode names, and /api/me's saas fields. Runs on the real SaaS schema
// (openSaasTestD1: every migrations-saas file, 0 instructors).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSaasTestD1 } from "./helpers/saas-d1.ts";
import { ValidationError } from "../lib/repo.ts";
import { createSaasInstructor, findSaasInstructor, postWelcome, readAccessEmail, saasMeBody } from "../lib/saas/accounts.ts";
import { forwardHeaders } from "../lib/saas/gate.ts";

const count = async (db: ReturnType<typeof openSaasTestD1>) =>
  Number((await db.prepare("SELECT COUNT(*) AS n FROM instructors").first<{ n: number }>())!.n);

test("createSaasInstructor then findSaasInstructor is case-insensitive on the e-mail and stores it lowercased", async () => {
  const db = openSaasTestD1();
  const created = await createSaasInstructor(db, { email: "  Coach@X.test ", fullName: "  QA Coach  ", adiNumber: " ADI 123 " });
  assert.equal(created.fullName, "QA Coach");
  assert.equal(created.status, "active");
  assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const found = await findSaasInstructor(db, "COACH@X.TEST");
  assert.equal(found?.id, created.id);
  assert.deepEqual(found, created);
  const row = await db.prepare("SELECT email, adi_number FROM instructors WHERE id = ?").bind(created.id).first<{ email: string; adi_number: string }>();
  assert.deepEqual({ ...row }, { email: "coach@x.test", adi_number: "ADI 123" });
  assert.equal(await findSaasInstructor(db, "other@x.test"), null);
  assert.equal(await findSaasInstructor(db, "   "), null);
});

test("createSaasInstructor is idempotent: a second create with the same e-mail (any case) returns the same row", async () => {
  const db = openSaasTestD1();
  const first = await createSaasInstructor(db, { email: "coach@x.test", fullName: "QA Coach", adiNumber: "1" });
  const second = await createSaasInstructor(db, { email: "COACH@X.TEST", fullName: "QA Other Name", adiNumber: "2" });
  assert.equal(second.id, first.id);
  assert.equal(second.fullName, "QA Coach", "the existing row is returned unchanged");
  assert.equal(await count(db), 1);
  // A concurrent double submit also yields one row.
  const [x, y] = await Promise.all([
    createSaasInstructor(db, { email: "race@x.test", fullName: "QA Race", adiNumber: "3" }),
    createSaasInstructor(db, { email: "race@x.test", fullName: "QA Race", adiNumber: "3" }),
  ]);
  assert.equal(x.id, y.id);
  assert.equal(await count(db), 2);
});

test("createSaasInstructor: two instructors may share a name (the unique-name index is gone in saas)", async () => {
  const db = openSaasTestD1();
  const a = await createSaasInstructor(db, { email: "a@x.test", fullName: "QA Same", adiNumber: "1" });
  const b = await createSaasInstructor(db, { email: "b@x.test", fullName: "QA Same", adiNumber: "2" });
  assert.notEqual(a.id, b.id);
});

test("createSaasInstructor validates e-mail, full name (1-80) and ADI number (1-20)", async () => {
  const db = openSaasTestD1();
  const ok = { email: "v@x.test", fullName: "QA V", adiNumber: "1" };
  for (const bad of [
    { ...ok, email: "" }, { ...ok, email: "   " }, { ...ok, email: undefined },
    { ...ok, fullName: "" }, { ...ok, fullName: "   " }, { ...ok, fullName: "x".repeat(81) }, { ...ok, fullName: undefined },
    { ...ok, adiNumber: "" }, { ...ok, adiNumber: " " }, { ...ok, adiNumber: "1".repeat(21) }, { ...ok, adiNumber: null },
  ]) {
    await assert.rejects(createSaasInstructor(db, bad as never), ValidationError, JSON.stringify(bad));
  }
  assert.equal(await count(db), 0);
  const edge = await createSaasInstructor(db, { email: "v@x.test", fullName: "刘".repeat(80), adiNumber: "1".repeat(20) });
  assert.equal(edge.fullName, "刘".repeat(80));
});

test("a Chinese name round-trips through forwardHeaders and the saas /api/me decoding", async () => {
  const db = openSaasTestD1();
  const created = await createSaasInstructor(db, { email: "liu@x.test", fullName: "刘坤", adiNumber: "ADI1" });
  const headers = forwardHeaders(new Request("https://saas.example/api/me"), { id: created.id, fullName: created.fullName }, null);
  assert.equal(headers.get("x-instructor-name"), encodeURIComponent("刘坤"), "header values must be Latin-1");
  const body = await saasMeBody(db, headers, 30);
  assert.deepEqual(body.instructor, { id: created.id, fullName: "刘坤" });
  assert.equal(body.mode, "saas");
});

test("saasMeBody: trialEndsAt is created_at + trial days x 24 h; no instructor gives instructor null", async () => {
  const db = openSaasTestD1();
  const a = await createSaasInstructor(db, { email: "a@x.test", fullName: "QA A", adiNumber: "1" });
  await db.prepare("UPDATE instructors SET created_at = ? WHERE id = ?").bind("2026-01-01T00:00:00.000Z", a.id).run();
  const headers = forwardHeaders(new Request("https://saas.example/api/me"), { id: a.id, fullName: a.fullName }, null);
  assert.deepEqual(await saasMeBody(db, headers, 30), { instructor: { id: a.id, fullName: "QA A" }, mode: "saas", trialEndsAt: "2026-01-31T00:00:00.000Z" });
  assert.equal((await saasMeBody(db, headers, 7)).trialEndsAt, "2026-01-08T00:00:00.000Z");
  const onboarding = forwardHeaders(new Request("https://saas.example/api/me"), null, "new@x.test");
  assert.deepEqual(await saasMeBody(db, onboarding, 30), { instructor: null, mode: "saas", trialEndsAt: null });
});

test("forwardHeaders drops client-supplied identity headers and sets only trusted values", () => {
  const spoofed = new Request("https://saas.example/api/learners", {
    headers: { "x-instructor-id": "victim", "x-instructor-name": "Victim", "x-access-email": "victim@x.test", "x-other": "kept" },
  });
  const withInstructor = forwardHeaders(spoofed, { id: "me", fullName: "QA Me" }, "me@x.test");
  assert.equal(withInstructor.get("x-instructor-id"), "me");
  assert.equal(withInstructor.get("x-instructor-name"), "QA%20Me");
  assert.equal(withInstructor.get("x-access-email"), null, "x-access-email only when there is no instructor yet");
  assert.equal(withInstructor.get("x-other"), "kept");

  const onboarding = forwardHeaders(spoofed, null, "New@X.test");
  assert.equal(onboarding.get("x-instructor-id"), null);
  assert.equal(onboarding.get("x-instructor-name"), null);
  assert.equal(readAccessEmail(onboarding), "New@X.test");

  const nothing = forwardHeaders(spoofed, null, null);
  for (const name of ["x-instructor-id", "x-instructor-name", "x-access-email"]) assert.equal(nothing.get(name), null, name);
});

test("forwardHeaders percent-encodes a non-Latin-1 e-mail; readAccessEmail decodes it and rejects malformed values", () => {
  const headers = forwardHeaders(new Request("https://saas.example/welcome"), null, "教练@例子.test");
  assert.equal(readAccessEmail(headers), "教练@例子.test");
  assert.equal(readAccessEmail(new Headers({ "x-access-email": "%E0%A4%A" })), null);
  assert.equal(readAccessEmail(new Headers()), null);
});

const welcome = (email: string | null, body: unknown) => {
  const headers = forwardHeaders(new Request("https://saas.example/api/welcome"), null, email);
  headers.set("content-type", "application/json");
  return new Request("https://saas.example/api/welcome", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
};

test("POST /api/welcome: identity only from x-access-email; 201 with the instructor; a repeated submit returns the same one (201)", async () => {
  const db = openSaasTestD1();
  const first = await postWelcome(db, welcome("coach@x.test", { fullName: "刘坤", adiNumber: "ADI 9", email: "attacker@x.test" }));
  assert.equal(first.status, 201);
  const { instructor } = (await first.json()) as { instructor: { id: string; fullName: string } };
  assert.equal(instructor.fullName, "刘坤");
  assert.deepEqual(Object.keys(instructor).sort(), ["fullName", "id"]);
  assert.equal((await findSaasInstructor(db, "coach@x.test"))?.id, instructor.id, "the body e-mail is ignored");
  assert.equal(await findSaasInstructor(db, "attacker@x.test"), null);

  const again = await postWelcome(db, welcome("COACH@x.test", { fullName: "QA Again", adiNumber: "1" }));
  assert.equal(again.status, 201);
  assert.equal(((await again.json()) as { instructor: { id: string } }).instructor.id, instructor.id);
  assert.equal(await count(db), 1);
});

test("POST /api/welcome by an already onboarded instructor: 200 with that instructor, body ignored, nothing changed", async () => {
  const db = openSaasTestD1();
  const existing = await createSaasInstructor(db, { email: "coach@x.test", fullName: "刘坤", adiNumber: "ADI 9" });
  const headers = forwardHeaders(new Request("https://saas.example/api/welcome", { headers: { "x-access-email": "spoof@x.test" } }), { id: existing.id, fullName: existing.fullName }, "coach@x.test");
  headers.set("content-type", "application/json");
  const response = await postWelcome(db, new Request("https://saas.example/api/welcome", { method: "POST", headers, body: JSON.stringify({ fullName: "QA Changed", adiNumber: "X" }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { instructor: { id: existing.id, fullName: "刘坤" } });
  assert.equal(await count(db), 1);
  const row = await db.prepare("SELECT full_name, adi_number FROM instructors WHERE id = ?").bind(existing.id).first<{ full_name: string; adi_number: string }>();
  assert.deepEqual({ ...row }, { full_name: "刘坤", adi_number: "ADI 9" });
  assert.equal(await findSaasInstructor(db, "spoof@x.test"), null);
  // A trusted id with no (active) row fails closed.
  const ghost = new Request("https://saas.example/api/welcome", { method: "POST", headers: { "x-instructor-id": "missing", "content-type": "application/json" }, body: "{}" });
  assert.equal((await postWelcome(db, ghost)).status, 403);
});

test("POST /api/welcome: 403 without x-instructor-id and x-access-email; 400 on validation errors or a bad body", async () => {
  const db = openSaasTestD1();
  const noEmail = await postWelcome(db, welcome(null, { fullName: "QA", adiNumber: "1" }));
  assert.equal(noEmail.status, 403);
  const bare = new Request("https://saas.example/api/welcome", { method: "POST", body: JSON.stringify({ fullName: "QA", adiNumber: "1" }) });
  assert.equal((await postWelcome(db, bare)).status, 403);
  assert.equal((await postWelcome(db, welcome("c@x.test", { fullName: "", adiNumber: "1" }))).status, 400);
  assert.equal((await postWelcome(db, welcome("c@x.test", { fullName: "QA", adiNumber: "" }))).status, 400);
  assert.equal((await postWelcome(db, welcome("c@x.test", "{not json"))).status, 400);
  assert.equal(await count(db), 0);
});
